import {SocketHandler} from "../util/SocketHandler";
import ConnectOpt from "../util/ConnectOpt";
import SocketState from "../util/SocketState";
import {Buffer} from "buffer";
import {OpenOpt} from "../commons/CtrlPacket";
import {EndpointHandler} from "../types/EndpointHandler";
import {clearInterval} from "timers";


const ID_BUNDLE_KEY : string = "i";

interface OnEndPointClientStateChangeCallback {
    (id: number, state: number,bundle?: {data?: Buffer, receiveLength: number}) : void;
}

interface OnEndPointTerminateCallback {
    (id: number) : void;
}

const SESSION_CLEANUP_INTERVAL : number = 5000;

class EndPointClientPool {

    private _connectOptMap: Map<number, ConnectOpt> = new Map<number, ConnectOpt>();
    private _endPointClientMap: Map<number, EndpointHandler> = new Map<number, EndpointHandler>();
    private _onEndPointClientStateChangeCallback: OnEndPointClientStateChangeCallback | null = null;
    private _onEndPointTerminateCallback: OnEndPointTerminateCallback | null = null;

    private _sessionCleanupIntervalID : NodeJS.Timeout | null = null;

    private _closeWaitTimeout : number = 60 * 1000;

    public constructor() {
        this.startSessionCleanup();
    }


    private startSessionCleanup() {
        if(this._sessionCleanupIntervalID) clearInterval(this._sessionCleanupIntervalID);
        this._sessionCleanupIntervalID = setInterval(() => {
            let now = Date.now();
            setInterval(() => {
                let closeWaitHandlerList : Array<EndpointHandler> = Array.from(this._endPointClientMap.values())
                    .filter((handler: EndpointHandler) => {
                        return !!handler.closeWait;

                    });
                closeWaitHandlerList.forEach((handler: EndpointHandler) => {
                    this.closeIfSatisfiedLength(handler, now - handler.lastSendTime! > this._closeWaitTimeout);
                });
            },SESSION_CLEANUP_INTERVAL);
        })
    }


    public set onEndPointClientStateChangeCallback(callback: OnEndPointClientStateChangeCallback) {
        this._onEndPointClientStateChangeCallback = callback;
    }

    public set onEndPointTerminateCallback (callback: OnEndPointTerminateCallback) {
        this._onEndPointTerminateCallback = callback;
    }


    public open(sessionID: number, connectOpt: OpenOpt) {

        this._connectOptMap.set(sessionID, connectOpt);
        console.log("엔드포인트 연결 시도: sessionID:" + sessionID + "    " + connectOpt.host + ":" + connectOpt.port);
        let endPointClient = SocketHandler.connect(connectOpt,( client: SocketHandler, state: SocketState, data?: any) => {
            client.setBufferSizeLimit(connectOpt.bufferLimit);
            this.onEndPointHandlerEvent(sessionID, client, state, data);
        }) as EndpointHandler;
        endPointClient.closeWait = false;
        endPointClient.lastSendTime = Date.now();
        endPointClient.endLength = 0;
        endPointClient.sessionID = sessionID;
        this._endPointClientMap.set(sessionID, endPointClient);
    }

    public close(id: number, endLength: number) : boolean {
        let endPointClient = this._endPointClientMap.get(id);
        if(endPointClient) {
            endPointClient.endLength = endLength;
            endPointClient.closeWait = true;
            this.closeIfSatisfiedLength(endPointClient);
            return true;
        }
        return false;
    }


    private closeIfSatisfiedLength(endPointClient: EndpointHandler, force: boolean = false) {
        if(endPointClient.closeWait) {
            let i = 100;
            i++;
        }
        if((endPointClient.closeWait && endPointClient.endLength! <= endPointClient.sendLength) || force) {
            this._endPointClientMap.delete(endPointClient.sessionID!);
            endPointClient.end_();
            this._onEndPointTerminateCallback?.(endPointClient.sessionID!)
        }
    }




    public send(id: number, data: Buffer) {
        let endPointClient = this._endPointClientMap.get(id);
        if(endPointClient) {
            endPointClient.lastSendTime = Date.now();
            endPointClient.sendData(data, (handler: SocketHandler /*, success: boolean*/) => {
                this.closeIfSatisfiedLength(handler);
            });
        }
    }




    private onEndPointHandlerEvent = (sessionID: number, client: SocketHandler, state: SocketState, data? :any) : void => {
        if(!client.hasBundle(ID_BUNDLE_KEY)) {
            client.setBundle(ID_BUNDLE_KEY, sessionID);
        }
        if(this._connectOptMap.has(sessionID)) {
            // 임시 조건문
            if(state == SocketState.Connected) {
                console.log("엔드포인트 연결 성공!: sessionID:" + sessionID + "    ");
            }

            let handler = (client as EndpointHandler);
            this._onEndPointClientStateChangeCallback?.(sessionID,state,{data: data, receiveLength:handler.breakBufferFlush ? 0 :handler.receiveLength!});
            if(!this._endPointClientMap.has(sessionID)) {
                this._endPointClientMap.set(sessionID, client as EndpointHandler);
            }
        } else {
            client.end_();
        }
        if(SocketState.End == state || SocketState.Closed == state /*|| SocketState.Error == state*/) {
            let hasSession = this._endPointClientMap.has(sessionID);
            this._endPointClientMap.delete(sessionID);
            this._connectOptMap.delete(sessionID);
            if(hasSession) {
                let handler = (client as EndpointHandler);
                this._onEndPointClientStateChangeCallback?.(sessionID,state,{receiveLength: handler.breakBufferFlush ? 0 :handler.receiveLength!});
                setImmediate(() => {
                    this._onEndPointTerminateCallback?.(sessionID);
                });
            }




        }
    }



    public closeAll() {
        this._onEndPointClientStateChangeCallback = null;
        this._endPointClientMap.forEach((client: SocketHandler /*, key: number*/) => {
            client.destroy();
        });
        this._endPointClientMap.clear();
    }



}

export default EndPointClientPool;