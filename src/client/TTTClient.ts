import {ConnectionState, TunnelClient} from "./TunnelClient";
import {ClientOption} from "../types/TunnelingOption";
import SocketState from "../util/SocketState";
import {Buffer} from "buffer";
import EndPointClientPool from "./EndPointClientPool";
import {logger} from "../commons/Logger";
import {OpenOpt} from "../commons/CtrlPacket";


const RECONNECT_INTERVAL : number = 5000;


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
        this._tunnelClient.onConnectEndPointCallback = this.onSessionOpenCallback;
        this._tunnelClient.onReceiveDataCallback = this.onSessionSendCallback;
        this._tunnelClient.onEndPointCloseCallback = this.onSessionCloseCallback;
        this._endPointClientPool.onEndPointClientStateChangeCallback = this.onEndPointClientStateChangeCallback;
        logger.info(`TTTClient:: try connect to ${this._clientOption.host}:${this._clientOption.port}`);
        logger.info(`TTTClient:: option: ${JSON.stringify(this._clientOption)}`)
        this._tunnelClient.connect();
    }

    private onCtrlStateCallback = (client: TunnelClient, state: ConnectionState, error? : Error ) : void => {
        if(state == 'closed') {
            logger.error(`TTTClient:: connection closed.`, error);
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

    private onSessionOpenCallback = (id: number, opt: OpenOpt) : void => {
        this._endPointClientPool.open(id , opt);
    }

    private onSessionCloseCallback = (id: number, waitForSendLength: number) : void => {
        console.log("[Client:TTTClient]", `세션제거 요청 받음 id: ${id}`)
        this._endPointClientPool.close(id,waitForSendLength);
        logger.info(`TTTClient:: TunnelClient closed, and close EndPointClientPool id: ${id}`);
        console.log("[Client:TTTClient]", `TunnelClient closed, and close EndPointClientPool id: ${id}`);
    }

    private onSessionSendCallback = (id: number, data: Buffer) : void => {
        this._endPointClientPool.send(id, data);
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