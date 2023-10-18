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
    private _pendingSessionIDMap : Map<number, {handlerID: number, sessionID: number, openOpt: OpenOpt, available: boolean }> = new Map<number, {handlerID: number, sessionID: number, openOpt: OpenOpt,available: boolean }>();
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
        return this._pendingSessionIDMap.size;
    }

    public get dataHandlerCount() : number {
        return this._dataHandlerMap.size;
    }


    /**
     * 데이터 핸들러가 세션을 닫으라는 명령을 받았을때 호출된다.
     * @param sessionID
     * @param endLength
     * @private
     */
    private closeSessionAndCallback(sessionID: number, endLength: number) : void {
        this._onSessionCloseCallback?.(sessionID,endLength);
    }

    public putNewDataHandler(dataHandler: TunnelDataHandler) : void {
        let pendingDataState = Array.from(this._pendingSessionIDMap.values()).find((value) => {
          return value.handlerID == dataHandler.handlerID;
        });

        if(!pendingDataState) {
            logger.error(`ClientHandlerPool::putNewDataHandler: invalid handlerID: ${dataHandler.handlerID}`);
            dataHandler.endImmediate();
            return;
        }
        dataHandler.dataHandlerState = DataHandlerState.Initializing;
        this._dataHandlerMap.set(dataHandler.handlerID!, dataHandler);
        this._activatedSessionHandlerMap_.set(pendingDataState.sessionID, dataHandler);
        dataHandler.dataHandlerState = DataHandlerState.ConnectingEndPoint;
        dataHandler.sessionID = pendingDataState.sessionID;
        this.sendConnectEndPointPacket(dataHandler.handlerID!, dataHandler.sessionID, pendingDataState.openOpt);
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
                handler.setBufferSizeLimit(-1);
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
        let pendingSessionState = {handlerID: 0, sessionID: sessionID, openOpt: opt, available: true};
        this._pendingSessionIDMap.set(sessionID,pendingSessionState);
        if(dataHandler == undefined) {
            pendingSessionState.handlerID = ++ClientHandlerPool.LAST_DATA_HANDLER_ID;
            this.sendNewDataHandler(pendingSessionState.handlerID, sessionID);
        } else {
            dataHandler.sessionID = sessionID;
            dataHandler.dataHandlerState = DataHandlerState.ConnectingEndPoint;
            pendingSessionState.handlerID = dataHandler.handlerID!;
            this.sendConnectEndPointPacket(dataHandler.handlerID!, sessionID, opt);
        }
    }

    /**
     * TunnelServer 에서 CtrlHandler 에 대한 데이터 이벤트를 받아서 처리한다.
     * @param handler
     * @param packet
     */
    public delegateReceivePacketOfControlHandler(handler: TunnelControlHandler, packet: CtrlPacket) : void {
        if(packet.cmd == CtrlCmd.SuccessOfOpenSession || packet.cmd == CtrlCmd.FailOfOpenSession) {
            let handlerID = packet.ID;
            let sessionID = packet.sessionID;
            console.log("[server]",`데이터 핸들러 연결 세션ID: ${packet.sessionID}  ${packet.cmd == CtrlCmd.SuccessOfOpenSession ? '성공' : '실패'}`);
            let connected = packet.cmd == CtrlCmd.SuccessOfOpenSession;
            if(!this.promoteDataHandler(handlerID,sessionID, connected)) {
                console.log("[server]",`데이터 핸들러 연결 실패: ${handlerID}`);
                connected = false;
            }
            if(!connected) {
                this.burnWaitBuffer(sessionID);
                this.closeSessionAndCallback(sessionID, 0);
            } else {
                this.flushWaitBuffer(sessionID);
            }
            this._pendingSessionIDMap.delete(sessionID);
        } else if(packet.cmd == CtrlCmd.CloseSession) {
            let handlerID = packet.ID;
            let sessionID = packet.sessionID;
            let endLength = packet.waitReceiveLength;
            console.log("[server]",`세션제거 요청 받음 id: ${sessionID}`);
            this.releaseSession_(handlerID,sessionID,endLength);
        }
    }

    private burnWaitBuffer(sessionID: number) : void {
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
            (dataHandler.dataHandlerState != DataHandlerState.ConnectingEndPoint && dataHandler.dataHandlerState != DataHandlerState.Initializing)) {
            return false;
        }
        let pendingState = this._pendingSessionIDMap.get(sessionID);
        if(!pendingState || pendingState.handlerID != handlerID || !pendingState.available) {
            connected = false;
        }
        if(connected) {
            if(pendingState) {
                dataHandler.setBufferSizeLimit(pendingState.openOpt.bufferLimit);
            }
            dataHandler.sessionID = sessionID;
            dataHandler.dataHandlerState = DataHandlerState.OnlineSession;
            this._activatedSessionHandlerMap_.set(sessionID, dataHandler);
            return true;
        } else {
            dataHandler.setBufferSizeLimit(-1);
            dataHandler.dataHandlerState = DataHandlerState.Wait;
            this._activatedSessionHandlerMap_.delete(sessionID);
            this.closeSessionAndCallback(sessionID, 0);
            return false;
        }

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
     * @param waitForLength
     */
    public sendCloseSession(sessionID: number, waitForLength : number) : void {
        let handler = this._activatedSessionHandlerMap_.get(sessionID);
        if(handler == undefined) {
            let pendingState = this._pendingSessionIDMap.get(sessionID);
            if(pendingState) {
                pendingState.available = false;
            }
            else {
                return;
            }
        }
        //this._activatedSessionHandlerMap_.delete(sessionID);
        console.log("[server]",`세션제거 요청을 클라이언트로 전송 id: ${sessionID}`);
        this._controlHandler.sendData(CtrlPacket.closeSession(handler == undefined ? 0 : handler!.handlerID ?? 0, sessionID, waitForLength).toBuffer(), (socketHandler, success, err) => {
            if(!success) {
                console.log('[ClientHandlerPool]', `closeSession: fail: ${err}`);
                return;
            }
            console.log("[server]",`세션제거 요청 전송 완료 id: ${sessionID}`);
            //handler!.dataHandlerState = DataHandlerState.Wait;
        });

    }

    /**
     * 컨트롤 핸들러로부터 세션을 닫으라는 명령을 받았을때 호출된다.
     * @param handlerID
     * @param sessionID
     * @param endLength
     */
    private releaseSession_(handlerID: number,sessionID: number, endLength: number =0) : void {
        let pendingState = this._pendingSessionIDMap.get(sessionID);
        if(pendingState) {
            pendingState.available = false;
            if(handlerID == 0) {
                handlerID = pendingState.handlerID;
            }
        }
        let handler = this._activatedSessionHandlerMap_.get(sessionID);
        if(handler == undefined) {
            handler = this._dataHandlerMap.get(handlerID);

            if(handler != undefined) {
                handler.setBufferSizeLimit(-1);
                handler.dataHandlerState = DataHandlerState.Wait;
            }
            this.closeSessionAndCallback(sessionID, endLength);
            return;
        }
        this.closeSessionAndCallback(sessionID,endLength);
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
     * @private
     */
    private sendNewDataHandler(dataHandlerID: number, sessionId: number) : void {
        let packet = CtrlPacket.newDataHandler(dataHandlerID, sessionId).toBuffer();
        this._controlHandler.sendData(packet, (handler, success, err) => {
            if(!success) {
                this.sendCloseSession(sessionId, 0);
                console.log('[ClientHandlerPool]', `sendNewDataHandlerAndOpen: fail: ${err}`);
                return;
            }
        });
    }

    public terminateSession(sessionID: number) : void {
        let handler = this._activatedSessionHandlerMap_.get(sessionID);
        if(handler == undefined) {
            return;
        } else {

        }
        this._activatedSessionHandlerMap_.delete(sessionID);
        this._pendingSessionIDMap.delete(sessionID);
        this._waitingDataBufferQueueMap.delete(sessionID);
        handler.setBufferSizeLimit(-1);
        handler.dataHandlerState = DataHandlerState.Wait;


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
                this.sendCloseSession(sessionId, 0);
                console.log('[ClientHandlerPool]', `sendOpen: fail: ${err}`);
                return;
            }
        });
    }


    public end() : void {
        // noinspection JSUnusedLocalSymbols
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