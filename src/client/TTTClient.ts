import {ConnectionState, TunnelClient} from "./TunnelClient";
import {ClientOption} from "../types/TunnelingOption";
import SocketState from "../util/SocketState";
import {Buffer} from "buffer";
import EndPointClientPool from "./EndPointClientPool";
import {OpenOpt} from "../commons/CtrlPacket";
import LoggerFactory from "../util/logger/LoggerFactory";

const logger = LoggerFactory.getLogger('client', 'TTTClient');


const RECONNECT_INTERVAL : number = 5000;


class TTTClient {
    private readonly _clientOption: ClientOption;
    private _endPointClientPool: EndPointClientPool;
    private _tunnelClient: TunnelClient;
    private _tryConnectState : boolean = false;
    private _isOnline : boolean = false;

    private constructor(clientOption: ClientOption) {
        this._clientOption = clientOption;
    }


    public static create(clientOption: ClientOption): TTTClient {
        return new TTTClient(clientOption);
    }

    public start() {
        this._endPointClientPool = new EndPointClientPool();
        this._tunnelClient = TunnelClient.create(this._clientOption);
        this._tunnelClient.onCtrlStateCallback = this.onCtrlStateCallback;
        this._tunnelClient.onConnectEndPointCallback = this.onSessionOpenCallback;
        this._tunnelClient.onReceiveDataCallback = this.onSessionSendCallback;
        this._tunnelClient.onEndPointCloseCallback = this.onSessionCloseCallback;
        this._endPointClientPool.onEndPointClientStateChangeCallback = this.onEndPointClientStateChangeCallback;
        this._endPointClientPool.onEndPointTerminateCallback = this.onEndPointTerminateCallback;
        logger.info(` try connect to ${this._clientOption.host}:${this._clientOption.port}`);
        logger.info(` option: ${JSON.stringify(this._clientOption)}`)
        this._tryConnectState = true;
        this._tunnelClient.connect();
    }

    private onCtrlStateCallback = (client: TunnelClient, state: ConnectionState, error? : Error ) : void => {
        if(state == 'closed') {
            if(!this._isOnline && !this._tryConnectState) {
                return;
            }
            this._tryConnectState = false;
            this._isOnline = false;
            logger.error(`Connection closed.`, error);
            this._endPointClientPool.closeAll();
            logger.info(`Try reconnect after ${RECONNECT_INTERVAL}ms`)
            setTimeout(() => {
                this.start();
                logger.info(`Try reconnect to ${this._clientOption.host}:${this._clientOption.port}`);
                logger.info(`Option: ${JSON.stringify(this._clientOption)}`);
            },RECONNECT_INTERVAL);
        } else if(state == 'connected') {
            logger.info(` connection established.`);
            this._isOnline = true;
            this._tryConnectState = false;
        }
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
            this._tunnelClient.closeEndPointSession(sessionID, bundle!.receiveLength);
        } else if(state == SocketState.Receive) {
            this._tunnelClient.sendData(sessionID,bundle?.data!);
        }
    }


}





export default TTTClient;