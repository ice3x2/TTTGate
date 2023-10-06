import {SocketHandler} from "../util/SocketHandler";
import SocketState from "../util/SocketState";
import {Buffer} from "buffer";
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer, OpenOpt} from "../commons/CtrlPacket";
import {ClientOption} from "../option/TunnelingOption";
import ConnectOpt from "../util/ConnectOpt";
import {logger} from "../commons/Logger";


enum CtrlState {
    None, /** 초기 상태 */
    Connecting, /** 서버와 연결중 */
    Connected,  /** 서버와 연결 완료 */
    Syncing, /** 서버와 동기화 중 */
    SyncSyncing /** 서버와 동기화 완료 */
}

enum DataHandlerState {
    None,
    Wait,
    Initializing,
    ConnectingEndPoint,
    OnlineSession,
    Terminated
}


type ConnectionState = 'connected' | 'closed';
interface OnCtrlStateCallback {
    (client: TunnelClient, state: ConnectionState, error?: Error) : void;
}


interface OnSessionCloseCallback {
    (id: number, error? : Error) : void;
}

interface OnReceiveDataCallback {
    (id: number, data: Buffer) : void;
}

interface OnSessionOpenCallback {
    (id: number, opt: OpenOpt) : void;
}


//type OnSessionEventCallback = (id: number, state: SessionState, data: Buffer | ConnectOpt | null) => void;

enum HandlerType {
    Control,
    Data
}


type DataHandler = SocketHandler & {
    sessionID?: number;
    packetStreamer?: CtrlPacketStreamer;
    dataHandlerState?: DataHandlerState;

}


const PACKET_READER_BUNDLE_KEY = 'R';
const HANDLER_TYPE_BUNDLE_KEY = 'T';
const SESSION_ID_BUNDLE_KEY = 'S';
const CTRL_ID_BUNDLE_KEY = 'I';




/**
 * Client 는 Ctrl(컨트롤) 클라이언트와 Session.ts(세션) 클라이언트로 구성된다.
 * Ctrl 클라이언트는 서버와 연결을 맺으면 Sync 와 SyncSync 패킷을 받는다. 이후 Ack 패킷을 보내면 연결이 완료된다. 이후 Open 패킷을 받기만한다.
 * Open 패킷을 수신받으면 Session클라이언트를 생성하고, Session.ts 클라이언트는 서버와 연결을 맺는다. 이후 이벤트를 통하여 EndPoint 클라이언트와 연결된다.
 * EndPoint 클라이언트와 연결이 완료되면 Syncronize 패킷을 보낸다.
 *
 *
 */
class TunnelClient {


    private readonly _option : ClientOption;
    private _state : CtrlState = CtrlState.None;
    private _isOnline: boolean = false;
    private _ctrlHandler: SocketHandler | undefined = undefined;
    private _waitDataHandlerList : Array<DataHandler> = [];
    private _waitDataHandlerMap : Map<number, SocketHandler> = new Map<number, SocketHandler>();
    private _activatedSessionDataHandlerMap : Map<number, DataHandler> = new Map<number, SocketHandler>();

    private _ctrlPacketStreamer : CtrlPacketStreamer = new CtrlPacketStreamer();

    private _id : number = -1;

    private _onCtrlStateCallback? : OnCtrlStateCallback;
    private _onEndPointCloseCallback? : OnSessionCloseCallback;
    private _onConnectEndPointCallback? : OnSessionOpenCallback;
    private _onReceiveDataCallback? : OnReceiveDataCallback;

    //private _sessionMap : Map<number, ClientSession> = new Map<number, ClientSession>();




    public set onEndPointCloseCallback(value: OnSessionCloseCallback) {
        this._onEndPointCloseCallback = value;
    }

    public set onConnectEndPointCallback(value: OnSessionOpenCallback) {
        this._onConnectEndPointCallback = value;
    }

    public set onReceiveDataCallback(value: OnReceiveDataCallback) {
        this._onReceiveDataCallback = value;
    }




    public set onCtrlStateCallback(callback: OnCtrlStateCallback) {
        this._onCtrlStateCallback = callback;
    }

    public static create(option: ClientOption) : TunnelClient {
        return new TunnelClient(option);
    }

    private constructor(option: ClientOption) {
        this._option = option;
    }

    private makeConnectOpt() : ConnectOpt {
        return {host: this._option.host,port: this._option.port ,tls: this._option.tls};
    }

    public connect() : boolean {
        if(this._isOnline || this._state != CtrlState.None) {
            console.error(`TunnelClient: connect: already connected`);
            return false;
        }
        this._state = CtrlState.Connecting;
        this._ctrlHandler = SocketHandler.connect(this.makeConnectOpt(), this.onCtrlHandlerEvent);
        return true;
    }


    public get state () : CtrlState {
        return this._state;
    }


    private failHandshake(err?: Error) : void {
        this._state = CtrlState.None
        this._ctrlHandler?.end();
        this._onCtrlStateCallback?.(this, 'closed', err);
    }

    public syncEndpointSession(sessionID: number) : boolean {
        if(this._state != CtrlState.Connected) {
            console.error(`TunnelClient: syncSession: invalid state: ${this._state}`);
            return false;
        }
        let dataHandler = this._activatedSessionDataHandlerMap.get(sessionID);
        if(!dataHandler) {
            return false;
        }
        let packet : CtrlPacket | undefined = undefined;
        if(dataHandler.dataHandlerState == DataHandlerState.Initializing) {
            console.log("엔드포인트 생성 및 연결 성공 전송. 세션ID:" + sessionID);
            packet = CtrlPacket.resultOfDataHandlerAndConnectEndPoint(this._id, sessionID, true);
        } else {
            console.log("엔드포인트 연결 성공 전송. 세션ID:" + sessionID);
            packet = CtrlPacket.resultOfConnectEndPoint(this._id, sessionID, true);
        }
        dataHandler.sendData(packet.toBuffer(), (handler, success, err) => {
            if(!success) {
                this.deleteActivatedSessionDataHandler(sessionID);
                dataHandler!.destroy();
            } else {
                dataHandler!.dataHandlerState = DataHandlerState.OnlineSession;
            }
        });
        return true;
    }

    private onCtrlHandlerEvent = (handler: SocketHandler, state: SocketState, data?: any) : void => {
        if(state == SocketState.Connected) {
            this.onConnectedCtrlHandler(handler);
        }
        else if(state == SocketState.Receive && handler == this._ctrlHandler) {
            this.onReceiveFromCtrlHandler(handler, data);
        } else if(state == SocketState.Closed || state == SocketState.End) {
            this._state = CtrlState.None;
            this._ctrlHandler = undefined;
            this._onCtrlStateCallback?.(this, 'closed');
        }
    }

    private obtainWaitDataHandler(handlerID: number) : DataHandler | undefined {
        for(let i = 0; i < this._waitDataHandlerList.length; i++) {
            if(this._waitDataHandlerList[i].id == handlerID) {
                return this._waitDataHandlerList.splice(i,1)[0];
            }
        }
        return undefined;

    }

    private onReceiveFromCtrlHandler(handler: SocketHandler, data: Buffer) : void {
        let packetList :  Array<CtrlPacket> = this._ctrlHandler!.getBundle(PACKET_READER_BUNDLE_KEY)!.readCtrlPacketList(data);
        for(let packet of packetList) {
            if(this._state == CtrlState.SyncSyncing && packet.cmd == CtrlCmd.SyncCtrlAck) {
                this._id = packet.ctrlID;
                this.sendAckCtrl(handler, this._id, this._option.key);
            }
            if(this._state == CtrlState.Connected) {
                if(packet.cmd == CtrlCmd.NewDataHandlerAndConnectEndPoint) {
                    this.connectDataHandler(packet.sessionID, packet.openOpt!);
                }
            } else {
                // todo 잘못된 패킷이 수신되었을 경우 처리해야함.
            }
        }
    }

    private connectEndPoint(handler: DataHandler,packet: CtrlPacket) : void {
        let dataHandler = this.obtainWaitDataHandler(handler.id);
        if(!dataHandler) {
            dataHandler = handler;
        }
        dataHandler.sessionID = packet.sessionID;
        this._activatedSessionDataHandlerMap.set(packet.sessionID, dataHandler);
        dataHandler!.dataHandlerState = DataHandlerState.ConnectingEndPoint;
        console.log('[client]',`TunnelClient: connectEndPoint: sessionID:${packet.sessionID}, remote:(${dataHandler!.socket.remoteAddress})${dataHandler!.socket.remotePort}`)
        this._onConnectEndPointCallback?.(packet.sessionID, packet.openOpt!);
    }



    private connectDataHandler(sessionID: number, endPointConnectOpt: OpenOpt ) : void {
        let dataHandler : DataHandler = SocketHandler.connect(this.makeConnectOpt(), (handler, state, data) => {
            if(state == SocketState.Connected) {
                dataHandler.dataHandlerState = DataHandlerState.Initializing;
                dataHandler.sessionID = sessionID;
                this._activatedSessionDataHandlerMap.set(sessionID, dataHandler);
                logger.info(`TunnelClient::connectDataHandler()\t Connected session data handler. sessionID:${sessionID}, remote:(${dataHandler.socket.remoteAddress})${dataHandler.socket.remotePort}, left activatedSessionDataHandlerMap:${this._activatedSessionDataHandlerMap.size}`)
                this._onConnectEndPointCallback?.(sessionID, endPointConnectOpt);
            } else if(state == SocketState.Receive) {
                this.onReceiveFromDataHandler(handler, data);
            } else if(state == SocketState.Closed || state == SocketState.End) {
                this.closeSessionByDataHandlerClosed(sessionID);
            }
        });
        dataHandler.packetStreamer = new CtrlPacketStreamer();
        dataHandler.sessionID = sessionID;
        dataHandler.dataHandlerState = DataHandlerState.None;
    }


    private closeSessionByDataHandlerClosed(sessionID: number) : void {
        let dataHandler  = this.deleteActivatedSessionDataHandler(sessionID);
        if(!dataHandler) {
            return;
        }
        dataHandler.dataHandlerState = DataHandlerState.Terminated;
        this._onEndPointCloseCallback?.(sessionID);
    }

    private onReceiveFromDataHandler(handler: DataHandler, data: Buffer) : void {
        let readPackets = handler.packetStreamer!.readCtrlPacketList(data);
        for(let packet of readPackets) {
            if(handler.dataHandlerState == DataHandlerState.OnlineSession) {
                if(packet.cmd == CtrlCmd.Data) {
                    this._onReceiveDataCallback?.(handler.sessionID!, packet.data!);
                } else if(packet.cmd == CtrlCmd.CloseSession) {
                    this.changeCloseSessionState(handler.sessionID!);
                    this._onEndPointCloseCallback?.(handler.sessionID!);
                } else {
                    this._onEndPointCloseCallback?.(handler.sessionID!, new Error(`invalid packet cmd: ${packet.cmd}`));
                    this.changeCloseSessionState(handler.sessionID!);
                    handler.end();
                    return;
                }
            }
            else if(handler.dataHandlerState == DataHandlerState.Wait && packet.cmd == CtrlCmd.ConnectEndPoint) {
                this.connectEndPoint(handler, packet);
            } else {
                this.deleteActivatedSessionDataHandler(handler.sessionID!);
                let idx = this._waitDataHandlerList.indexOf(handler);
                if(idx > -1) {
                    this._waitDataHandlerList.splice(idx, 1);
                }
                handler.end();
                logger.error(`TunnelClient::onReceiveFromDataHandler - invalid state: ${handler.dataHandlerState}, sessionID:${handler.sessionID}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`)
            }
        }
    }



    private onConnectedCtrlHandler(handler: SocketHandler) {
        handler.setBundle(PACKET_READER_BUNDLE_KEY, new CtrlPacketStreamer());
        handler.setBundle(HANDLER_TYPE_BUNDLE_KEY, HandlerType.Control);
        this.sendSyncAndSyncSyncCmd(handler);
    }



    private sendSyncAndSyncSyncCmd(handler: SocketHandler) : void {
        //console.log("[server]",'TunnelServer: makeCtrlHandler - change state => ' + SessionState[SessionState.HalfOpened]);
        logger.info(`TunnelClient::sendSyncAndSyncSyncCmd - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`)
        let sendBuffer = CtrlPacket.createSyncCtrl().toBuffer();
        handler.sendData(sendBuffer, (handler, success, err) => {
            if(!success) {
                logger.error(`TunnelClient::sendSyncAndSyncSyncCmd Fail - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}, ${err}`);
                this._ctrlHandler?.end();
                return;
            }
            logger.info(`TunnelClient::sendSyncAndSyncSyncCmd Success - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`)
            this._state = CtrlState.SyncSyncing;
        });
    }


    private sendAckCtrl(handler: SocketHandler, id: number, key : string) : void {
        handler.sendData(CtrlPacket.createAckCtrl(id, this._option.name, key).toBuffer(), (handler, success, err) => {
            if (!success) {
                this.failHandshake(err);
                return;
            }
            this._state = CtrlState.Connected;
            this._onCtrlStateCallback?.(this, 'connected');
        });
    }


    /**
     * 외부(TTTClient)에서 세션을 종료한다.
     * @param sessionID
     */
    public closeEndPointSession(sessionID: number) : boolean {
        let dataHandler = this.changeCloseSessionState(sessionID);
        if(!dataHandler) {
            return false;
        }
        if(dataHandler.dataHandlerState == DataHandlerState.Initializing) {
            console.log("엔드포인트 생성 및 연결 !실패! 전송. 세션ID:" + sessionID);
            let packet = CtrlPacket.resultOfDataHandlerAndConnectEndPoint(this._id, sessionID, false);
            dataHandler.sendData(packet.toBuffer(), (handler, success, err) => {
                if(!success) {
                    dataHandler!.dataHandlerState = DataHandlerState.Terminated
                    dataHandler!.destroy();
                    return;
                }
                this._waitDataHandlerList.push(dataHandler!);
            });
        }
        else this.closeEndPointSessionByUnknownHandler(dataHandler!, sessionID);
        return true;
    }

    private changeCloseSessionState(sessionID: number) : DataHandler | undefined {
        let dataHandler = this._activatedSessionDataHandlerMap.get(sessionID);
        if(!dataHandler || dataHandler.dataHandlerState == DataHandlerState.Terminated) {
            return undefined;
        }
        this.deleteActivatedSessionDataHandler(sessionID);
        dataHandler!.dataHandlerState = DataHandlerState.Wait;
    }

    private deleteActivatedSessionDataHandler(sessionID: number) : DataHandler | undefined {
        let dataHandler = this._activatedSessionDataHandlerMap.get(sessionID);
        if(!dataHandler) {
            return undefined;
        }
        this._activatedSessionDataHandlerMap.delete(sessionID);
        logger.info(`TunnelClient::deleteActivatedSessionDataHandler - sessionID:${sessionID}, remote:(${dataHandler.socket.remoteAddress})${dataHandler.socket.remotePort}, left activatedSessionDataHandlerMap:${this._activatedSessionDataHandlerMap.size}`)
        return dataHandler;
    }


    public closeEndPointSessionByUnknownHandler(dataHandler: DataHandler, sessionID: number) : boolean {
        dataHandler.sendData(CtrlPacket.closeSession(this._id, sessionID).toBuffer(), (handler, success, err) => {
            if(!success) {
                dataHandler!.dataHandlerState = DataHandlerState.Terminated
                dataHandler!.end();
            } else {
                dataHandler!.dataHandlerState = DataHandlerState.Wait;
                this._waitDataHandlerList.push(dataHandler!);
            }
        });
        return true;
    }




    public sendData(sessionID: number, data: Buffer) : boolean {
        let dataHandler = this._activatedSessionDataHandlerMap.get(sessionID);
        if (!dataHandler) {
            return false;
        }
        let packets = CtrlPacket.sessionData(this._id, sessionID, data);
        for(let packet of packets) {
            dataHandler.sendData(packet.toBuffer());
        }
        return true;
    }



}

export {TunnelClient,  ConnectionState}