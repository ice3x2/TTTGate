import {ConnectionState, TunnelClient} from "./TunnelClient";
import {ClientOption} from "../types/TunnelingOption";
import SocketState from "../util/SocketState";
import {Buffer} from "buffer";
import EndPointClientPool from "./EndPointClientPool";
import {OpenOpt} from "../commons/CtrlPacket";
import LoggerFactory from "../util/logger/LoggerFactory";
import {TTTClientRuntimeRegistry} from "./TTTClientRuntime";
import {redactSecrets} from "../util/SecretRedactor";

type ClientOwner = {client: TunnelClient; pool: EndPointClientPool};

const logger = LoggerFactory.getLogger('client', 'TTTClient');


class TTTClient {
    private readonly _clientOption: ClientOption;
    private _endPointClientPool: EndPointClientPool;
    private _tunnelClient: TunnelClient;
    private _tryConnectState : boolean = false;
    private _isOnline : boolean = false;
    private _stopped : boolean = false;
    private _reconnectTimer : NodeJS.Timeout | undefined;
    private _owner: ClientOwner | undefined;
    private _cancelReconnect: (() => void) | undefined;

    private constructor(clientOption: ClientOption) {
        this._clientOption = clientOption;
    }


    public static create(clientOption: ClientOption): TTTClient {
        return new TTTClient(clientOption);
    }

    private isCurrentOwner(owner: ClientOwner): boolean {
        return !this._stopped && this._owner === owner;
    }

    private retireOwner(): void {
        const owner = this._owner;
        this._owner = undefined;
        owner?.pool.dispose();
        owner?.client.destroy();
    }

    private cancelReconnect(): void {
        const cancel = this._cancelReconnect;
        this._cancelReconnect = undefined;
        this._reconnectTimer = undefined;
        cancel?.();
    }

    public start() {
        this.cancelReconnect();
        this.retireOwner();
        const owner: ClientOwner = {pool: new EndPointClientPool(), client: TunnelClient.create(this._clientOption)};
        this._owner = owner;
        this._endPointClientPool = owner.pool;
        this._tunnelClient = owner.client;
        owner.client.onCtrlStateCallback = (client, state, error) => {
            if(this.isCurrentOwner(owner) && client === owner.client) this.onCtrlStateCallback(client, state, error);
        };
        owner.client.onConnectEndPointCallback = (id, opt) => {
            if(this.isCurrentOwner(owner)) this.onSessionOpenCallback(id, opt);
        };
        owner.client.onReceiveDataCallback = (id, data) => {
            if(this.isCurrentOwner(owner)) this.onSessionSendCallback(id, data);
        };
        owner.client.onEndPointCloseCallback = (id, length) => {
            if(this.isCurrentOwner(owner)) this.onSessionCloseCallback(id, length);
        };
        owner.pool.onEndPointClientStateChangeCallback = (id, state, bundle) => {
            if(this.isCurrentOwner(owner)) this.onEndPointClientStateChangeCallback(id, state, bundle);
        };
        owner.pool.onEndPointTerminateCallback = id => {
            if(this.isCurrentOwner(owner)) this.onEndPointTerminateCallback(id);
        };
        this._stopped = false;
        this._isOnline = false;
        this._tryConnectState = true;
        logger.info(` try connect to ${this._clientOption.host}:${this._clientOption.port}`);
        logger.info(` option: ${JSON.stringify(redactSecrets(this._clientOption))}`);
        owner.client.connect();
    }

    private onCtrlStateCallback = (client: TunnelClient, state: ConnectionState, error? : Error ) : void => {
        if(!this._owner || !this.isCurrentOwner(this._owner) || client !== this._owner.client) return;
        if(state == 'closed') {
            if(this._stopped) {
                return;
            }
            if(!this._isOnline && !this._tryConnectState) {
                return;
            }
            this._tryConnectState = false;
            this._isOnline = false;
            logger.error(`Connection closed.`, error);
            this.retireOwner();
            const runtime = TTTClientRuntimeRegistry.current();
            const reconnectInterval = runtime.reconnectIntervalMs;
            logger.info(`Try reconnect after ${reconnectInterval}ms`)
            const timer = runtime.scheduler.setTimeout(() => {
                if(this._stopped || this._reconnectTimer !== timer) return;
                this._reconnectTimer = undefined;
                this._cancelReconnect = undefined;
                this.start();
                logger.info(`Try reconnect to ${this._clientOption.host}:${this._clientOption.port}`);
                logger.info(`Option: ${JSON.stringify(redactSecrets(this._clientOption))}`);
            }, reconnectInterval);
            this._reconnectTimer = timer;
            this._cancelReconnect = () => runtime.scheduler.clearTimeout(timer);
        } else if(state == 'connected') {
            logger.info(` connection established.`);
            this._isOnline = true;
            this._tryConnectState = false;
        }
    }

    public stop(): void {
        this._stopped = true;
        this._tryConnectState = false;
        this._isOnline = false;
        this.cancelReconnect();
        this.retireOwner();
    }

    private onSessionOpenCallback = (id: number, opt: OpenOpt) : void => {
        this._endPointClientPool.open(id , opt);
    }



    private onSessionCloseCallback = (id: number, waitForSendLength: number) : void => {
        logger.info("A request has been received to close the session. id: " + id + ", waitForSendLength: " + waitForSendLength);
        this._endPointClientPool.close(id,waitForSendLength);
    }

    private onSessionSendCallback = (id: number, data: Buffer) : void => {
        this._endPointClientPool.send(id, data);
    }

    private onEndPointTerminateCallback = (sessionID: number) : void => {
        this._tunnelClient.terminateEndPointSession(sessionID);
    }


    private onEndPointClientStateChangeCallback =  (sessionID: number,state : SocketState, bundle?: {data?: Buffer, receiveLength: number}) : void => {
        if(state == SocketState.Connected) {
            this._tunnelClient.syncEndpointSession(sessionID);
        } else if(state == SocketState.End || /*state == SocketState.Error ||*/ state == SocketState.Closed) {
            if (!bundle) {
                logger.error(`onEndPointClientStateChangeCallback - bundle is undefined for sessionID: ${sessionID}, state: ${state}`);
                this._tunnelClient.closeEndPointSession(sessionID, 0);
            } else {
                this._tunnelClient.closeEndPointSession(sessionID, bundle.receiveLength);
            }
        } else if(state == SocketState.Receive) {
            if (!bundle || !bundle.data) {
                logger.error(`onEndPointClientStateChangeCallback - bundle or data is undefined for sessionID: ${sessionID}, state: ${state}`);
                return;
            }
            this._tunnelClient.sendData(sessionID, bundle.data);
        }
    }


}





export default TTTClient;
