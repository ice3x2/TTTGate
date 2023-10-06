import {SocketHandler} from "../util/SocketHandler";
import {CtrlPacket, CtrlPacketStreamer, OpenOpt} from "../commons/CtrlPacket";;
import SessionState from "../option/SessionState";
import Dequeue from "../util/Dequeue";



const SESSION_ID_BUNDLE_KEY = 'S';
const WAIT_BUFFER_BUNDLE_KEY = 'W';
const SESSION_STATE_BUNDLE_KEY = 'T';



class ClientHandlerPool {

    private readonly _id : number;
    private readonly _controlHandler: SocketHandler;
    private _name : string = '';
    // 대기중인 핸들러 풀. 핸들러가 필요할때마다 여기서 꺼내서 사용한다.
    private _waitDataHandlerPool: Array<SocketHandler> = new Array<SocketHandler>();
    // 열린 핸들러 맵. 세션ID를 키로 사용한다.
    private _activatedSessionHandlerMap : Map<number, SocketHandler> = new Map<number, SocketHandler>();

    private _waitPacketQueueMap : Map<number, Dequeue<CtrlPacket>> = new Map<number, Dequeue<CtrlPacket>>();



    public static create(id : number, controlHandler: SocketHandler) : ClientHandlerPool {
        return new ClientHandlerPool(id, controlHandler);
    }

    private constructor(id : number, controlHandler: SocketHandler) {
        this._id = id;
        this._controlHandler = controlHandler;
    }

    public endDataHandler(handler: SocketHandler) : void {
        let sessionID = this.findSessionID(handler);
        if(sessionID == undefined) {
            this._waitDataHandlerPool.splice(this._waitDataHandlerPool.indexOf(handler), 1);
            return;
        }
        this.deleteActivatedSessionHandler(sessionID);
        handler.end();
    }

    public putNewDataHandler(sessionID: number,openSuccess: boolean, handler: SocketHandler) : void {
        if(sessionID < 0) {
            this.pushWaitDataHandler(handler);
            return;
        }
        if(!openSuccess) {
            this.closeSession(sessionID);
            this.pushWaitDataHandler(handler);
            return;
        }
        this._activatedSessionHandlerMap.set(sessionID, handler);
        this.flushWaitBuffer(handler, sessionID);
        handler.setBundle(SESSION_ID_BUNDLE_KEY, sessionID);
    }

    public isSessionOpened(sessionID: number) : boolean {
        return this._activatedSessionHandlerMap.get(sessionID) != undefined;
    }




    private flushWaitBuffer(handler: SocketHandler, sessionID : number) : void {
        let waitPacketQueue = this._waitPacketQueueMap.get(sessionID);
        if(waitPacketQueue == undefined) {
            return;
        }
        let packet = waitPacketQueue.popFront();
        while(packet != undefined) {
            this.sendPacket(sessionID, packet);
            packet = waitPacketQueue.popFront();
        }

    }


    private findSessionID(handler: SocketHandler) : number | undefined {
        for(let [key, value] of this._activatedSessionHandlerMap) {
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
        this._waitPacketQueueMap.set(sessionID, new Dequeue<CtrlPacket>());
        let socketHandler = this.obtainHandler();
        if(socketHandler == undefined) {
            this.sendNewDataHandlerAndConnectEndPoint(sessionID, opt);
        } else {
            this.sendConnectEndPointPacket(socketHandler, sessionID, opt);
        }
    }

    /**
     * 데이터를 전송한다. 만약 세션이 존재하지 않으면 false를 반환한다.
     * @param sessionID
     * @param data
     */
    public sendPacket(sessionID: number, packet: CtrlPacket) : boolean {
        if(!this._activatedSessionHandlerMap.has(sessionID) && this._waitPacketQueueMap.has(sessionID)) {
            this._waitPacketQueueMap.get(sessionID)!.pushBack(packet);
        }
        else {

            let handler = this._activatedSessionHandlerMap.get(sessionID);
            if(handler == undefined) {
                this.closeSession(sessionID);
                return false;
            }
            handler.sendData(packet.toBuffer());
        }
        return true;
    }


    /**
     * ExternalPortServer 로부터 세션을 닫으라는 명령을 받았을때 호출된다. (ExternalPortServer 의 핸들러가 close 될 때)
     * @param sessionID
     */
    public closeSession(sessionID: number) : void {
        let handler = this._activatedSessionHandlerMap.get(sessionID);
        if(handler == undefined) {
            return;
        }
        this.deleteActivatedSessionHandler(sessionID);
        console.log("[server]",`세션제거 요청을 클라이언트로 전송 id: ${sessionID}`);
        handler.sendData(CtrlPacket.closeSession(this._id, sessionID).toBuffer(), (handler, success, err) => {
            if(!success) {
                console.log('[ClientHandlerPool]', `closeSession: fail: ${err}`);
                return;
            }
            console.log("[server]",`세션제거 요청 전송 완료 id: ${sessionID}`);
            this.pushWaitDataHandler(handler);
        });
    }

    private deleteActivatedSessionHandler(sessionID: number) : void {
        this._activatedSessionHandlerMap.delete(sessionID);
        this._waitPacketQueueMap.delete(sessionID);
    }

    /**
     * 클라이언트 데이터 핸들러로부터 세션을 닫으라는 명령을 받았을때 호출된다.
     * @param sessionID
     */
    public releaseSession(sessionID: number) : void {
        let handler = this._activatedSessionHandlerMap.get(sessionID);
        if(handler == undefined) {
            return;
        }
        this.deleteActivatedSessionHandler(sessionID);
        this.pushWaitDataHandler(handler);
    }


    /**
     * 핸들러풀에서 핸들러를 꺼내온다. 만약 핸들러풀에 핸들러가 없으면 undefined를 반환한다.
     * @private
     */
    private obtainHandler() : SocketHandler | undefined {
        if(this._waitDataHandlerPool.length > 0) {
            return this._waitDataHandlerPool.shift();
        }
        return undefined;
    }

    /**
     * 핸들러풀에 핸들러를 넣는다.
     * @param handler
     * @private
     */
    private pushWaitDataHandler(handler: SocketHandler) : void {
        this._waitDataHandlerPool.push(handler);
    }

    private sendNewDataHandlerAndConnectEndPoint(sessionId: number,  opt : OpenOpt) : void {
        let packet = CtrlPacket.newDataHandlerAndConnectEndPoint(this._id, sessionId, opt).toBuffer();
        this._controlHandler.sendData(packet, (handler, success, err) => {
            if(!success) {
                this.closeSession(sessionId);
                console.log('[ClientHandlerPool]', `sendNewDataHandlerAndOpen: fail: ${err}`);
                return;
            }
            handler.setBundle(SESSION_STATE_BUNDLE_KEY, SessionState.HalfOpened);

        });
    }

    private sendConnectEndPointPacket(handler: SocketHandler, sessionId: number, opt : OpenOpt) : void {
        let packet = CtrlPacket.connectEndPoint(this._id, sessionId, opt).toBuffer();
        handler.sendData(packet, (socketHandler, success, err) => {
            if(!success) {
                this.closeSession(sessionId);
                console.log('[ClientHandlerPool]', `sendOpen: fail: ${err}`);
                return;
            }
            handler.setBundle(SESSION_STATE_BUNDLE_KEY, SessionState.HalfOpened);

        });
    }

    public destroy() : void {
        for(let [key, value] of this._activatedSessionHandlerMap) {
            value.sendData(CtrlPacket.closeSession(this._id, key).toBuffer(), () => {
                value.end();
            });
        }
        this._activatedSessionHandlerMap.clear();
        this._controlHandler.destroy();
    }

}

export {ClientHandlerPool}