import {SocketHandler} from "../util/SocketHandler";
import {CtrlPacket, CtrlPacketStreamer, OpenOpt} from "./CtrlPacket";
import DataSession from "./ClientSession";
import SessionState from "../option/SessionState";
import SocketState from "../util/SocketState";



const SESSION_ID_BUNDLE_KEY = 'S';

class ClientHandlerPool {

    private readonly _id : number;
    private readonly _controlHandler: SocketHandler;
    private _name : string = '';
    // 대기중인 핸들러 풀. 핸들러가 필요할때마다 여기서 꺼내서 사용한다.
    private _waitDataHandlerPool: Array<SocketHandler> = new Array<SocketHandler>();
    // 열린 핸들러 맵. 세션ID를 키로 사용한다.
    private _activatedSessionHandlerMap : Map<number, SocketHandler> = new Map<number, SocketHandler>();
    private _sessionMap : Map<number, DataSession> = new Map<number, DataSession>();


    public static create(id : number, controlHandler: SocketHandler) : ClientHandlerPool {
        return new ClientHandlerPool(id, controlHandler);
    }

    private constructor(id : number, controlHandler: SocketHandler) {
        this._id = id;
        this._controlHandler = controlHandler;
    }

    public putNewDataHandler(sessionID: number,openSuccess: boolean, handler: SocketHandler) : void {
        if(sessionID < 0) {
            this.pushWaitDataHandler(handler);
            return;
        }
        let session = this._sessionMap.get(sessionID);
        if(!openSuccess || session == undefined) {
            this.closeSession(sessionID);
            this.pushWaitDataHandler(handler);
            return;
        }
        this._activatedSessionHandlerMap.set(sessionID, handler);
        this.flushWaitBuffer(handler, session);
        handler.setBundle(SESSION_ID_BUNDLE_KEY, sessionID);
        session.state = SessionState.Connected;
    }

    public isSessionOpened(sessionID: number) : boolean {
        return this._activatedSessionHandlerMap.get(sessionID) != undefined;
    }




    private flushWaitBuffer(handler: SocketHandler, session: DataSession) : void {
        let buffer = session.popWaitBuffer();
        while(buffer != undefined) {
            handler.sendData(buffer);
            buffer = session.popWaitBuffer();
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


    private set name(name: string) {
        this._name = name;
    }

    public get id() : number {
        return this._id;
    }

    public get name() : string {
        return this._name;
    }

    public sendConnectEndPoint(sessionID: number, opt : OpenOpt) : DataSession {
        let dataSession = DataSession.createClientSession(sessionID);
        this._sessionMap.set(sessionID, dataSession);
        let socketHandler = this.obtainHandler();
        if(socketHandler == undefined) {
            this.sendNewDataHandlerAndConnectEndPoint(sessionID, opt);
        } else {
            this.sendConnectEndPointPacket(socketHandler, sessionID, opt);
        }
        return dataSession;
    }

    /**
     * 데이터를 전송한다. 만약 세션이 존재하지 않으면 false를 반환한다.
     * @param sessionID
     * @param data
     */
    public send(sessionID: number, data: Buffer) : boolean {
        let dataSession = this._sessionMap.get(sessionID);
        if(dataSession == undefined) {
            return false;
        }
        if(!dataSession.isConnected()) {
            dataSession.pushWaitBuffer(data);
        }
        else {
            let handler = this._activatedSessionHandlerMap.get(sessionID);
            if(handler == undefined) {
                this.closeSession(sessionID);
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
    public closeSession(sessionID: number) : void {
        let handler = this._activatedSessionHandlerMap.get(sessionID);
        if(handler == undefined) {
            return;
        }
        this._activatedSessionHandlerMap.delete(sessionID);
        handler.sendData(CtrlPacket.closeSession(this._id, sessionID).toBuffer(), (handler, success, err) => {
            if(!success) {
                console.log('[ClientHandlerPool]', `closeSession: fail: ${err}`);
                return;
            }
            this.pushWaitDataHandler(handler);
        });

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
        this._activatedSessionHandlerMap.delete(sessionID);
        this.pushWaitDataHandler(handler);
    }

    public endAll() : void {

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
                this._onCloseSessionCallback?.(this._id, sessionId);
                return;
            }
            this._sessionMap.get(sessionId)!.state = SessionState.HalfOpened;
        });
    }

    private sendConnectEndPointPacket(handler: SocketHandler, sessionId: number, opt : OpenOpt) : void {
        let packet = CtrlPacket.connectEndPoint(this._id, sessionId, opt).toBuffer();
        handler.sendData(packet, (handler, success, err) => {
            if(!success) {
                this.closeSession(sessionId);
                console.log('[ClientHandlerPool]', `sendOpen: fail: ${err}`);
                this._onCloseSessionCallback?.(this._id, sessionId);
                return;
            }
            this._sessionMap.get(sessionId)!.state = SessionState.HalfOpened;
        });
    }


}

export {ClientHandlerPool}