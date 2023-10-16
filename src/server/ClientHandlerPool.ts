import {SocketHandler} from "../util/SocketHandler";
import {CtrlCmd, CtrlPacket, OpenOpt} from "../commons/CtrlPacket";
import Dequeue from "../util/Dequeue";
import {DataHandlerState, TunnelControlHandler, TunnelDataHandler} from "../types/TunnelHandler";
import {Buffer} from "buffer";
import {logger} from "../commons/Logger";


interface OnSessionCloseCallback {
    (id: number, endLength: number) : void;
}

interface OnDataReceiveCallback {
    (sessionID: number,data: Buffer) : void;
}


class ClientHandlerPool {


    private static LAST_DATA_HANDLER_ID : number = 10000;
    private readonly _createTime : number = Date.now();
    private readonly _remoteAddress : string = '';

    private readonly _id : number;
    private readonly _controlHandler: TunnelControlHandler;
    private _name : string = '';

    // 열린 핸들러 맵. 세션ID를 키로 사용한다.

    private _activatedSessionHandlerMap_ : Map<number, TunnelDataHandler> = new Map<number, TunnelDataHandler>();


    private _waitingDataBufferQueueMap : Map<number,{send: Dequeue<Buffer>, receive: Dequeue<Buffer>}> = new Map<number, {send: Dequeue<Buffer>, receive: Dequeue<Buffer>}>();



    private _dataHandlerMap : Map<number,TunnelDataHandler> = new Map<number,TunnelDataHandler>();
    private _bufferSize : number = 0;

    private _pendingDataHandlerIDMap : Map<number, number> = new Map<number, number>();

    private _onSessionCloseCallback? : OnSessionCloseCallback;
    private _onDataReceiveCallback? : OnDataReceiveCallback;


    public static create(id : number, controlHandler: SocketHandler) : ClientHandlerPool {

        return new ClientHandlerPool(id, controlHandler);
    }

    private constructor(id : number, controlHandler: SocketHandler) {
        this._id = id;
        this._remoteAddress = controlHandler.remoteAddress + ':' + controlHandler.remotePort;
        this._controlHandler = controlHandler;
    }

    public endDataHandler(handler: TunnelDataHandler) : void {
        let sessionID = this.findSessionIDByDataHandler(handler);
        if(sessionID == undefined) {
            sessionID = -1;
        }
        this.releaseSession_(handler.handlerID!,sessionID);
        handler.dataHandlerState = DataHandlerState.Terminated;
        handler.end_();
    }


    public set onSessionCloseCallback(callback: OnSessionCloseCallback) {
        this._onSessionCloseCallback = callback;
    }

    public set onReceiveDataCallback(callback: OnDataReceiveCallback) {
        this._onDataReceiveCallback = callback;
    }

    public get createTime() : number {
        return this._createTime;
    }

    public get address () : string {
        return this._remoteAddress;
    }

    public get activatedSessionCount() : number {
        return this._activatedSessionHandlerMap_.size;
    }

    public get pendingSessionCount() : number {
        return this._pendingDataHandlerIDMap.size;
    }

    public get dataHandlerCount() : number {
        return this._dataHandlerMap.size;
    }


    /**
     * 데이터 핸들러가 세션을 닫으라는 명령을 받았을때 호출된다.
     * @param sessionID
     * @private
     */
    private closeSessionAndCallback(sessionID: number, endLength: number) : void {
        this._onSessionCloseCallback?.(sessionID,endLength);
    }

    public putNewDataHandler(handler: TunnelDataHandler) : void {
        if(!this._pendingDataHandlerIDMap.has(handler.handlerID!)) {
            logger.error(`ClientHandlerPool::putNewDataHandler: invalid handlerID: ${handler.handlerID}`);
            handler.endImmediate();
            return;
        }
        handler.dataHandlerState = DataHandlerState.Initializing;
        this._pendingDataHandlerIDMap.delete(handler.handlerID!);
        this._dataHandlerMap.set(handler.handlerID!, handler);
    }

    public isSessionOpened(sessionID: number) : boolean {
        return this._activatedSessionHandlerMap_.has(sessionID);
    }


    /**
     * 세션이 열린직후 호출된다.
     * End point server 에 연결 직전까지 External port server 에서 받은 데이터를 버퍼에 저장했다가,
     * 세션이 열리면 일괄 전송한다.
     * @param sessionID
     * @private
     */
    private flushWaitBuffer(sessionID: number) : void {
        let handler = this._activatedSessionHandlerMap_.get(sessionID)!;
        if(handler == undefined || handler.dataHandlerState != DataHandlerState.OnlineSession) {
            logger.error(`ClientHandlerPool::flushWaitBuffer: invalid sessionID: ${sessionID}`);
            if(handler) {
                handler.dataHandlerState = DataHandlerState.Wait;
            }
            return;
        }
        let waitQueue = this._waitingDataBufferQueueMap.get(sessionID);
        if(waitQueue == undefined) {
            return;
        }
        let sendWaitPacketQueue = waitQueue.send;
        let receiveWaitPacketQueue = waitQueue.receive;
        let sendData = sendWaitPacketQueue.popFront();
        if(sendData == undefined) {
            console.log('오잉?! 왜 sendData 가 undefined 이지?!');
        }
        while(sendData != undefined) {
            handler.sendData(sendData);
            this._bufferSize -= sendData.length;
            sendData = sendWaitPacketQueue.popFront();
        }
        let receiveData = receiveWaitPacketQueue.popFront();
        while(receiveData != undefined) {
            this._onDataReceiveCallback?.(sessionID, receiveData);
            this._bufferSize -= receiveData.length;
            receiveData = receiveWaitPacketQueue.popFront();
        }

        this._waitingDataBufferQueueMap.delete(sessionID);
    }

    public pushReceiveBuffer(sessionID: number, data: Buffer) : boolean {
        let handler = this._activatedSessionHandlerMap_.get(sessionID);
        if(handler != undefined && handler.dataHandlerState == DataHandlerState.OnlineSession) {
            this._onDataReceiveCallback?.(sessionID, data);
            return true;
        }
        if(handler?.dataHandlerState != DataHandlerState.OnlineSession) {
            console.log("[server]",`세션제거 요청을 클라이언트로 전송 id: ${sessionID}`);
        }
        let queue = this._waitingDataBufferQueueMap.get(sessionID);
        if(queue == undefined) {
            logger.error(`ClientHandlerPool::pushReceiveBuffer: invalid sessionID: ${sessionID}`);
            return false;
        }
        this._bufferSize += data.length;
        queue.receive.pushBack(data);
        return true;
    }


    private findSessionIDByDataHandler(handler: TunnelDataHandler) : number | undefined {
        for(let [key, value] of this._activatedSessionHandlerMap_) {
            if(value == handler) {
                return key;
            }
        }
        return undefined;
    }


    public set name(name: string) {
        this._name = name;
    }

    public get id() : number {
        return this._id;
    }

    public get name() : string {
        return this._name;
    }

    public sendConnectEndPoint(sessionID: number, opt : OpenOpt) : void {
        if(this._waitingDataBufferQueueMap.has(sessionID)) {
            return;
        }
        this._waitingDataBufferQueueMap.set(sessionID,{send: new Dequeue<Buffer>(), receive: new Dequeue<Buffer>()});
        let dataHandler = this.obtainHandler();
        if(dataHandler == undefined) {
            this.sendNewDataHandlerAndConnectEndPoint(++ClientHandlerPool.LAST_DATA_HANDLER_ID, sessionID, opt);
        } else {
            dataHandler.sessionID = sessionID;
            dataHandler.dataHandlerState = DataHandlerState.ConnectingEndPoint;
            this.sendConnectEndPointPacket(dataHandler.handlerID!, sessionID, opt);
        }
    }

    /**
     * TunnelServer 에서 CtrlHandler 에 대한 데이터 이벤트를 받아서 처리한다.
     * @param handler
     * @param data
     */
    public delegateReceivePacketOfControlHandler(handler: TunnelControlHandler, packet: CtrlPacket) : void {
        if(packet.cmd == CtrlCmd.SuccessOfOpenSession || packet.cmd == CtrlCmd.FailOfOpenSession) {
            let handlerID = packet.ID;
            let sessionID = packet.sessionID;
            console.log("[server]",`데이터 핸들러 연결 세션ID: ${packet.sessionID}  ${packet.cmd == CtrlCmd.SuccessOfOpenSession ? '성공' : '실패'}`);
            let connected = packet.cmd == CtrlCmd.SuccessOfOpenSession;
            if(!this.promoteDataHandler(handlerID,sessionID, connected)) {
                console.log("[server]",`데이터 핸들러 연결 실패: ${handlerID}`);
                // todo : 데이터 핸들러 연결 실패시 처리
                return;
            }
            if(!connected) {
                let queue = this._waitingDataBufferQueueMap.get(sessionID);
                if(queue) {
                    this._waitingDataBufferQueueMap.delete(sessionID);
                    let data = queue.receive.popFront();
                    while(data != undefined) {
                        this._bufferSize -= data.length;
                        data = queue.receive.popFront();
                    }
                    data = queue.send.popFront();
                    while(data != undefined) {
                        this._bufferSize -= data.length;
                        data = queue.send.popFront();
                    }
                }
                this.closeSessionAndCallback(sessionID, 0);
            } else {
                this.flushWaitBuffer(sessionID);
            }
        } else if(packet.cmd == CtrlCmd.CloseSession) {
            let handlerID = packet.ID;
            let sessionID = packet.sessionID;
            let endLength = packet.waitReceiveLength;
            if(endLength == 0) {
                console.log("[server]",`세션제거 요청 받음 id: ${sessionID} 그런데 endLength 가 0 이다. 뭐지?!.  `);
            }
            console.log("[server]",`세션제거 요청 받음 id: ${sessionID}`);
            this.releaseSession_(handlerID,sessionID,endLength);

        }
    }

    public onReceiveDataOnDataHandler(handler: TunnelDataHandler) : void {
        let sessionID = this.findSessionIDByDataHandler(handler);
        if(sessionID == undefined) {
            sessionID =  this._pendingDataHandlerIDMap.get(handler.handlerID ?? 0);
            if(sessionID == undefined) {
                return;
            }
        }
        if(handler.dataHandlerState != DataHandlerState.OnlineSession) {
            logger.error(`ClientHandlerPool::onReceiveDataOnDataHandler: invalid dataHandlerState: ${handler.dataHandlerState}`);
            return;
        }

    }


    /**
     * 데이터 핸들러 상태를 'OnlineSession' 또는 'Wait' 으로 변경한다.
     * 만약 세션 연결에 성공하면 'OnlineSession' 으로 변경하고, 실패하면 'Wait' 으로 변경한다.
     * @param handlerID
     * @param sessionID
     * @param connected
     * @private
     */
    private promoteDataHandler(handlerID : number,sessionID: number, connected: boolean) : boolean  {
        let dataHandler = this._dataHandlerMap.get(handlerID);
        if(!dataHandler ||
            (dataHandler.dataHandlerState != DataHandlerState.ConnectingEndPoint && dataHandler.dataHandlerState != DataHandlerState.Initializing)) return false;
        if(connected) {
            dataHandler.sessionID = sessionID;
            this._activatedSessionHandlerMap_.set(sessionID, dataHandler);
            dataHandler.dataHandlerState = DataHandlerState.OnlineSession;
        } else {
            dataHandler.dataHandlerState = DataHandlerState.Wait;
        }
        return true;
    }


    /**
     * 데이터를 전송한다. 만약 세션이 존재하지 않으면 false를 반환한다.
     * @param sessionID
     * @param data
     */
    public sendBuffer(sessionID: number, data: Buffer) : boolean  {
        if(this._waitingDataBufferQueueMap.has(sessionID)) {
            this._waitingDataBufferQueueMap.get(sessionID)!.send.pushBack(data);
            this._bufferSize += data.length;
        }
        else {
            let handler = this._activatedSessionHandlerMap_.get(sessionID);
            if(handler == undefined) {
                this.sendCloseSession(sessionID, 0);
                this.closeSessionAndCallback(sessionID, 0);
                return false;
            }
            handler.sendData(data);
        }
        return true;
    }


    /**
     * ExternalPortServer 로부터 세션을 닫으라는 명령을 받았을때 호출된다. (ExternalPortServer 의 핸들러가 close 될 때)
     * @param sessionID
     */
    public sendCloseSession(sessionID: number, waitForLength: number) : void {
        let handler = this._activatedSessionHandlerMap_.get(sessionID);
        if(handler == undefined) {
            return;
        }
        //this._activatedSessionHandlerMap_.delete(sessionID);
        console.log("[server]",`세션제거 요청을 클라이언트로 전송 id: ${sessionID}`);
        this._controlHandler.sendData(CtrlPacket.closeSession(handler!.handlerID!, sessionID, waitForLength).toBuffer(), (socketHandler, success, err) => {
            if(!success) {
                console.log('[ClientHandlerPool]', `closeSession: fail: ${err}`);
                return;
            }
            console.log("[server]",`세션제거 요청 전송 완료 id: ${sessionID}`);
            //handler!.dataHandlerState = DataHandlerState.Wait;
        });

    }

    private deleteActivatedSessionHandler(sessionID: number) : void {
        let handler = this._activatedSessionHandlerMap_.get(sessionID);
        this._activatedSessionHandlerMap_.delete(sessionID);
        if(handler) {
            handler.dataHandlerState = DataHandlerState.Wait;
        }
    }

    /**
     * 컨트롤 핸들러로부터 세션을 닫으라는 명령을 받았을때 호출된다.
     * @param handlerID
     * @param sessionID
     * @param endLength
     */
    private releaseSession_(handlerID: number,sessionID: number, endLength: number =0) : void {
        let handler = this._activatedSessionHandlerMap_.get(sessionID);
        //this._activatedSessionHandlerMap_.delete(sessionID);
        if(handler == undefined) {
            handler = this._dataHandlerMap.get(handlerID);
            if(handler != undefined) {
                //handler.dataHandlerState = DataHandlerState.Wait;
            }
            this.closeSessionAndCallback(sessionID, endLength);
            return;
        }
        //this.deleteActivatedSessionHandler(sessionID);
        this.closeSessionAndCallback(sessionID,endLength );


    }


    /**
     * 핸들러풀에서 핸들러를 꺼내온다. 만약 핸들러풀에 핸들러가 없으면 undefined를 반환한다.
     * @private
     */
    private obtainHandler() : TunnelDataHandler | undefined {
        let handlers = Array.from(this._dataHandlerMap.values());
        for(let handler of handlers) {
            if(handler.dataHandlerState == DataHandlerState.Wait) {
                handler.dataHandlerState = DataHandlerState.ConnectingEndPoint;
                return handler;
            }
        }
        return undefined;
    }


    /**
     * 새로운 데이터 핸들러를 만들고, 컨트롤러 핸들러에게 세션을 열라는 명령을 보낸다.
     * @param dataHandlerID 새로운 데이터 핸들러의 ID
     * @param sessionId 세션 ID
     * @param opt 세션 옵션
     * @private
     */
    private sendNewDataHandlerAndConnectEndPoint(dataHandlerID: number, sessionId: number,  opt : OpenOpt) : void {
        this._pendingDataHandlerIDMap.set(dataHandlerID,sessionId);
        let packet = CtrlPacket.newDataHandlerAndOpenSession(dataHandlerID, sessionId, opt).toBuffer();
        this._controlHandler.sendData(packet, (handler, success, err) => {
            if(!success) {
                this.sendCloseSession(sessionId, 0);
                this._pendingDataHandlerIDMap.delete(dataHandlerID);
                console.log('[ClientHandlerPool]', `sendNewDataHandlerAndOpen: fail: ${err}`);
                return;
            }
        });
    }



    /**
     * 사용 가능한 데이터 핸들러가 있는 상황에서, 컨트롤러 핸들러에게 세션을 열라는 명령을 보낸다.=
     * @param dataHandlerID 데이터 핸들러 ID
     * @param sessionId 세션 ID
     * @param opt 세션 옵션
     * @private
     */
    private sendConnectEndPointPacket(dataHandlerID: number, sessionId: number, opt : OpenOpt) : void {
        let packet = CtrlPacket.connectEndPoint(dataHandlerID, sessionId, opt).toBuffer();
        this._controlHandler.sendData(packet, (socketHandler, success, err) => {
            if(!success) {
                let dataHandler = this._dataHandlerMap.get(dataHandlerID);
                if(!dataHandler) return;
                dataHandler.dataHandlerState = DataHandlerState.Terminated;
                this.sendCloseSession(sessionId,0 );
                console.log('[ClientHandlerPool]', `sendOpen: fail: ${err}`);
                return;
            }
        });
    }


    public end() : void {
        for(let [key, value] of this._dataHandlerMap) {
            value.onSocketEvent = function () {};
            value.endImmediate();
        }
        this._activatedSessionHandlerMap_.clear();
        this._dataHandlerMap.clear();
        this._controlHandler.onSocketEvent = function () {};
        this._controlHandler.endImmediate();
        this._onSessionCloseCallback = undefined;
    }

}

export {ClientHandlerPool}