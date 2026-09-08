import {SocketHandler} from "../util/SocketHandler";
import ConnectOpt from "../util/ConnectOpt";
import SocketState from "../util/SocketState";
import {Buffer} from "buffer";
import {OpenOpt} from "../commons/CtrlPacket";
import {EndpointHandler} from "../types/EndpointHandler";
import {clearInterval} from "timers";
import LoggerFactory  from "../util/logger/LoggerFactory";
const logger = LoggerFactory.getLogger('client', 'EndPointClientPool');


const ID_BUNDLE_KEY : string = "i";

interface OnEndPointClientStateChangeCallback {
    (id: number, state: number,bundle?: {data?: Buffer, receiveLength: number}) : void;
}

interface OnEndPointTerminateCallback {
    (id: number, mode?: 'graceful' | 'abort') : void;
}

const SESSION_CLEANUP_INTERVAL : number = 10000;

class EndPointClientPool {

    private _endpointOwners = new Map<number, {handler?: EndpointHandler; terminal: boolean}>();
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
                // 매번 현재 시간을 재계산하여 정확한 타임아웃 체크
                const now = Date.now();
                let closeWaitHandlerList : Array<EndpointHandler> = Array.from(this._endPointClientMap.values())
                    .filter((handler: EndpointHandler) => {
                        return !!handler.closeWait;

                    });
                closeWaitHandlerList.forEach((handler: EndpointHandler) => {
                    let isTimeout = handler.lastSendTime ? (now - handler.lastSendTime > this._closeWaitTimeout) : true;
                    this.closeIfSatisfiedLength(handler, isTimeout);
                });
            },SESSION_CLEANUP_INTERVAL);

    }


    public set onEndPointClientStateChangeCallback(callback: OnEndPointClientStateChangeCallback) {
        this._onEndPointClientStateChangeCallback = callback;
    }

    public set onEndPointTerminateCallback (callback: OnEndPointTerminateCallback) {
        this._onEndPointTerminateCallback = callback;
    }


    public open(sessionID: number, connectOpt: OpenOpt) {

        const previous = this._endpointOwners.get(sessionID);
        const owner: {handler?: EndpointHandler; terminal: boolean} = {terminal: false};
        this._endpointOwners.set(sessionID, owner);
        this._endPointClientMap.delete(sessionID);
        previous?.handler?.destroy();
        this._connectOptMap.set(sessionID, connectOpt);
        logger.info("Connect to endpoint: (sessionID " + sessionID +") " + connectOpt.host + ":" + connectOpt.port);
        let endPointClient = SocketHandler.connect(connectOpt,(client: SocketHandler, state: SocketState, data?: any) => {
            owner.handler ??= client as EndpointHandler;
            if(this._endpointOwners.get(sessionID) !== owner) { client.destroy(); return; }
            if(owner.terminal) return;
            this._endPointClientMap.set(sessionID, client as EndpointHandler);
            client.setBufferSizeLimit(connectOpt.bufferLimit);
            this.onEndPointHandlerEvent(sessionID, client, state, data);
        }) as EndpointHandler;
        owner.handler ??= endPointClient;
        if(owner.terminal || this._endpointOwners.get(sessionID) !== owner) return;
        endPointClient.closeWait = false;
        endPointClient.closeInitiated = false;
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
        const ready = endPointClient.closeWait && (endPointClient.endLength ?? 0) <= endPointClient.sendLength && endPointClient.isOutputDrained;
        if((ready || force) && !endPointClient.closeInitiated) {
            endPointClient.closeInitiated = true;
            if(force) {
                endPointClient.destroy();
                return;
            }
            endPointClient.end_();
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




    private onEndPointHandlerEvent = (sessionID: number, client: SocketHandler, state: SocketState, data?: any) : void => {
        const owner = this._endpointOwners.get(sessionID);
        if(!owner || owner.handler !== client || owner.terminal) return;
        if(!client.hasBundle(ID_BUNDLE_KEY)) client.setBundle(ID_BUNDLE_KEY, sessionID);
        const handler = client as EndpointHandler;
        const receiveLength = handler.breakBufferFlush ? 0 : (handler.receiveLength ?? 0);
        if(state === SocketState.End || state === SocketState.Closed) {
            const graceful = state === SocketState.End && client.socket.readableEnded && !client.socket.errored &&
                !handler.breakBufferFlush && !handler.closeWait && !handler.closeInitiated;
            logger.info(`Disconnected from endpoint: sessionID:${sessionID}`);
            owner.terminal = true;
            this._endPointClientMap.delete(sessionID);
            this._connectOptMap.delete(sessionID);
            this._onEndPointClientStateChangeCallback?.(sessionID, state, {receiveLength});
            setImmediate(() => {
                if(this._endpointOwners.get(sessionID) !== owner) return;
                this._endpointOwners.delete(sessionID);
                this._onEndPointTerminateCallback?.(sessionID, graceful ? 'graceful' : 'abort');
            });
            return;
        }
        if(state === SocketState.Connected) logger.info(`Successfully connected to endpoint: sessionID:${sessionID}`);
        this._onEndPointClientStateChangeCallback?.(sessionID, state, {data, receiveLength});
    }

    public closeAll() {
        this.dispose();
    }

    public dispose() {
        this._endpointOwners.clear();
        this._onEndPointClientStateChangeCallback = null;
        if(this._sessionCleanupIntervalID) {
            clearInterval(this._sessionCleanupIntervalID);
            this._sessionCleanupIntervalID = null;
        }
        this._endPointClientMap.forEach((client: SocketHandler /*, key: number*/) => {
            client.destroy();
        });
        this._endPointClientMap.clear();
        this._connectOptMap.clear();
    }



}

export default EndPointClientPool;
