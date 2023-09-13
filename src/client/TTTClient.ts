import {ConnectionState, TunnelClient} from "./TunnelClient";
import {ClientOption} from "../option/TunnelingOption";
import SocketState from "../util/SocketState";
import {Buffer} from "buffer";
import EndPointClientPool from "./EndPointClientPool";
import {ConnectOpt} from "../option/ConnectOpt";
import {logger} from "../commons/Logger";


const RECONNECT_INTERVAL : number = 3000;
class TTTClient {
    private readonly _endPointClientPool: EndPointClientPool = new EndPointClientPool();
    private readonly _clientOption: ClientOption;
    private _tunnelClient: TunnelClient;

    private constructor(clientOption: ClientOption) {
        this._clientOption = clientOption;
    }


    public static create(clientOption: ClientOption): TTTClient {
        let client = new TTTClient(clientOption);
        return client;
    }

    public start() {
        this._tunnelClient = TunnelClient.create(this._clientOption);
        this._tunnelClient.onCtrlStateCallback = this.onCtrlStateCallback;
        this._tunnelClient.onSessionOpenCallback = this.onSessionOpenCallback;
        this._tunnelClient.onReceiveDataCallback = this.onSessionSendCallback;
        this._tunnelClient.onSessionCloseCallback = this.onSessionCloseCallback;
        this._endPointClientPool.onEndPointClientStateChangeCallback = this.onEndPointClientStateChangeCallback;
        logger.info(`TTTClient:: try connect to ${this._clientOption.host}:${this._clientOption.port}`);
        logger.info(`TTTClient:: option: ${JSON.stringify(this._clientOption)}`)
        this._tunnelClient.connect();
    }

    private onCtrlStateCallback = (client: TunnelClient, state: ConnectionState, error? : Error ) : void => {
        if(state == 'closed') {
            logger.error(`TTTClient:: connection closed. \n${error ? error : ''}`);
            this._endPointClientPool.closeAll();
            logger.info(`TTTClient:: try reconnect after ${RECONNECT_INTERVAL}ms`)
            setTimeout(() => {
                logger.info(`TTTClient:: try reconnect to ${this._clientOption.host}:${this._clientOption.port}`);
                logger.info(`TTTClient:: option: ${JSON.stringify(this._clientOption)}`);
                this._endPointClientPool.onEndPointClientStateChangeCallback = this.onEndPointClientStateChangeCallback;
                client.connect();
            },RECONNECT_INTERVAL);
        } else if(state == 'connected') {
            logger.info(`TTTClient:: connection established.`);
        }
    }

    private onSessionOpenCallback = (id: number, opt: ConnectOpt) : void => {
        this._endPointClientPool.open(id , opt);
    }

    private onSessionCloseCallback = (id: number) : void => {
        this._endPointClientPool.close(id);
        logger.info(`TTTClient:: TunnelClient closed, and close EndPointClientPool id: ${id}`);
        console.log("[Client:TTTClient]", `TunnelClient closed, and close EndPointClientPool id: ${id}`);
    }

    private onSessionSendCallback = (id: number, data: Buffer) : void => {
        this._endPointClientPool.send(id, data);

    }





    private onEndPointClientStateChangeCallback =  (id: number,state : SocketState,  data?: Buffer) : void => {
        if(state == SocketState.Connected) {
            //console.log("[Client:EndPointClientPool]", `EndPointClientPool id: ${id} state: ${SocketState[state]}`);
            this._tunnelClient.syncSession(id);
        } else if(state == SocketState.End || state == SocketState.Error || state == SocketState.Closed) {
            //console.log("[Client:EndPointClientPool]", `EndPointClientPool id: ${id} state: ${SocketState[state]}`);
            this._tunnelClient.closeSession(id);
        } else if(state == SocketState.Receive && data) {
            this._tunnelClient.send(id,data);
        }
    }


}





export default TTTClient;