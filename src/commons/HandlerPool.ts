import {SocketHandler} from "../util/SocketHandler";
import {CtrlPacket, CtrlPacketStreamer, OpenOpt} from "./CtrlPacket";
import DataSession from "./ClientSession";
import SessionState from "../option/SessionState";
import SocketState from "../util/SocketState";


interface OnCloseSessionCallback {
    (ctrlID: number, sessionID: number) : void;
}

const SESSION_ID_BUNDLE_KEY = 'S';

class HandlerPool {

    private readonly _id : number;
    private readonly _controlHandler: SocketHandler;
    private _name : string = '';
    // 대기중인 핸들러 풀. 핸들러가 필요할때마다 여기서 꺼내서 사용한다.
    private _waitDataHandlerPool: Array<SocketHandler> = new Array<SocketHandler>();
    // 열린 핸들러 맵. 세션ID를 키로 사용한다.
    private _openedHandlerMap : Map<number, SocketHandler> = new Map<number, SocketHandler>();
    private _sessionMap : Map<number, DataSession> = new Map<number, DataSession>();

    private _onCloseSessionCallback? : OnCloseSessionCallback;


    public static create(id : number, controlHandler: SocketHandler) : HandlerPool {
        return new HandlerPool(id, controlHandler);
    }

    private constructor(id : number, controlHandler: SocketHandler) {
        this._id = id;
        this._controlHandler = controlHandler;
    }

    public putNewDataHandler(sessionID: number,openSuccess: boolean, handler: SocketHandler) : void {
        handler.onSocketEvent = (handler, state, data) => { 
            this.onSocketEvent(handler, state, data);
        };
        if(sessionID < 0) {
            this.pushWaitDataHandler(handler);
            return;
        }
        let session = this._sessionMap.get(sessionID);
        if(!openSuccess || session == undefined) {
            this.releaseSession(sessionID);
            this.pushWaitDataHandler(handler);
            return;
        }
        this._openedHandlerMap.set(sessionID, handler);
        this.flushWaitBuffer(handler, session);
        handler.setBundle(SESSION_ID_BUNDLE_KEY, sessionID);
        session.state = SessionState.Connected;
    }


    private flushWaitBuffer(handler: SocketHandler, session: DataSession) : void {
        let buffer = session.popWaitBuffer();
        while(buffer != undefined) {
            handler.sendData(buffer);
            buffer = session.popWaitBuffer();
        }
    }

    public onSocketEvent(handler: SocketHandler, state: SocketState, data?: any) : void {
        if(state == SocketState.Closed || state == SocketState.End) {
            let sessionID = this.findSessionID(handler);
            if(sessionID != undefined) {
                this.releaseSession(sessionID!);
                this._openedHandlerMap.delete(sessionID);
                this._onCloseSessionCallback?.(this._id, sessionID);
            } else {
                this.pushWaitDataHandler(handler);
            }
        } else if(state == SocketState.Receive) {
            let sessionID = handler.getBundle(SESSION_ID_BUNDLE_KEY);
            let session = this._sessionMap.get(sessionID);
            let packets = session!.readCtrlPacketList(data!);
            for(let packet of packets) {
                this.onCtrlPacket(sessionID, handler, packet);
            }
        }
    }

    private onCtrlPacket(sessionID: number, handler: SocketHandler, packet: CtrlPacket) : void {
        packet.cmd

    }


    private findSessionID(handler: SocketHandler) : number | undefined {
        for(let [key, value] of this._openedHandlerMap) {
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

    public open(sessionID: number, opt : OpenOpt) : DataSession {
        let dataSession = DataSession.createClientSession(sessionID);
        this._sessionMap.set(sessionID, dataSession);
        let socketHandler = this.obtainHandler();
        if(socketHandler == undefined) {
            this.sendNewDataHandlerAndOpen(sessionID, opt);
        } else {
            this.sendOpen(socketHandler, sessionID, opt);
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
            let handler = this._openedHandlerMap.get(sessionID);
            if(handler == undefined) {
                this.releaseSession(sessionID);
                return false;
            }
            handler.sendData(data);
        }
        return true;
    }


    private releaseSession(sessionID : number) : void {
        this._sessionMap.get(sessionID)!.state = SessionState.Closed;
        this._sessionMap.delete(sessionID);
    }


    public close(sessionID: number) : void {

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

    private sendNewDataHandlerAndOpen(sessionId: number,  opt : OpenOpt) : void {
        let packet = CtrlPacket.createNewDataHandlerAndOpenPacket(this._id, sessionId, opt).toBuffer();
        this._controlHandler.sendData(packet, (handler, success, err) => {
            if(!success) {
                this.releaseSession(sessionId);
                console.log('[HandlerPool]', `sendNewDataHandlerAndOpen: fail: ${err}`);
                this._onCloseSessionCallback?.(this._id, sessionId);
                return;
            }
            this._sessionMap.get(sessionId)!.state = SessionState.HalfOpened;
        });
    }

    private sendOpen(handler: SocketHandler, sessionId: number, opt : OpenOpt) : void {
        let packet = CtrlPacket.createOpenSessionEndPoint(this._id, sessionId, opt).toBuffer();
        handler.sendData(packet, (handler, success, err) => {
            if(!success) {
                this.releaseSession(sessionId);
                console.log('[HandlerPool]', `sendOpen: fail: ${err}`);
                this._onCloseSessionCallback?.(this._id, sessionId);
                return;
            }
            this._sessionMap.get(sessionId)!.state = SessionState.HalfOpened;
        });
    }


}

export {HandlerPool}