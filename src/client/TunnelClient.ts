import SocketHandler from "../util/SocketHandler";
import SocketState from "../util/SocketState";
import {Buffer} from "buffer";
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer} from "../commons/CtrlPacket";
import SessionState from "../option/SessionState";
import {ClientOption} from "../option/TunnelingOption";
import {ConnectOpt} from "../option/ConnectOpt";
import ClientSession from "../commons/ClientSession";
import {logger} from "../commons/Logger";


enum CtrlState {
    None, /** 초기 상태 */
    Connecting, /** 서버와 연결중 */
    Connected,  /** 서버와 연결 완료 */
    Syncing, /** 서버와 동기화 중 */
    SyncSyncing /** 서버와 동기화 완료 */
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
    (id: number, opt: ConnectOpt) : void;
}

//type OnSessionEventCallback = (id: number, state: SessionState, data: Buffer | ConnectOpt | null) => void;



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
    private _ctrlPacketStreamer : CtrlPacketStreamer = new CtrlPacketStreamer();

    private _onCtrlStateCallback? : OnCtrlStateCallback;
    private _onSessionCloseCallback? : OnSessionCloseCallback;
    private _onSessionOpenCallback? : OnSessionOpenCallback;
    private _onReceiveDataCallback? : OnReceiveDataCallback;

    private _sessionMap : Map<number, ClientSession> = new Map<number, ClientSession>();


    public set onSessionCloseCallback(value: OnSessionCloseCallback) {
        this._onSessionCloseCallback = value;
    }

    public set onSessionOpenCallback(value: OnSessionOpenCallback) {
        this._onSessionOpenCallback = value;
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

    public syncSession(id: number) : boolean {
        if(this._state != CtrlState.Connected) {
            console.error(`TunnelClient: syncSession: invalid state: ${this._state}`);
            return false;
        }
        let session = this._sessionMap.get(id);
        if(!session) {
            console.error(`TunnelClient: syncSession: invalid session id: ${id}`);
            return false;
        }
        let buffer = session.popWaitBuffer();
        while(buffer) {
            this._onReceiveDataCallback?.(id, buffer);
            buffer = session.popWaitBuffer();
        }
        session.state = SessionState.Connected;

        return true;
    }

    // state 상태 변화.
    // 1. connected -> syncing : 최초 연결 상태에서 SyncCtrl 패킷을 받으면 Syncing 상태로 전환
    // 2. syncing -> syncsyncing : Syncing 상태에서 SyncSyncCtrl 패킷을 받으면 SyncSyncing 상태로 전환
    // 3. syncsyncing -> synced :  SyncSyncing 상태에서 AckSyncCtrl 패킷 전달이 성공하면 Synced 상태로 전환. 이 상태에서 통신 가능.
    private onCtrlHandlerEvent = (handler: SocketHandler, state: SocketState, data?: any) : void => {
        try {
            if (SocketState.Connected == state) {
                handler.socket.setKeepAlive(true, 30000);
                this._state = CtrlState.Syncing;
            } else if (SocketState.Receive == state) {
                let packetList : Array<CtrlPacket> = this._ctrlPacketStreamer.readCtrlPacketList(data);
                for(let packet of packetList) {
                    if(this._state == CtrlState.Syncing && packet.cmd == CtrlCmd.SyncCtrl) {
                        this._state = CtrlState.SyncSyncing;
                    }
                    else if(this._state == CtrlState.SyncSyncing && packet.cmd == CtrlCmd.SyncSyncCtrl) {
                        this._state = CtrlState.Connecting
                        this.sendAckCtrl(handler, packet.id, this._option.key);
                    } else if(this._state == CtrlState.Connected && packet.cmd == CtrlCmd.Data) {
                        let session = this._sessionMap.get(packet.id);
                        if(!session) {
                            console.error(`TunnelClient: onCtrlHandlerEvent: invalid session id: ${packet.id}`);
                            continue;
                        }
                        if(session.state == SessionState.HalfOpened) {
                            session.pushWaitBuffer(packet.data);
                        } else {
                            this._onReceiveDataCallback?.(packet.id, packet.data);
                        }
                    } else if(this._state == CtrlState.Connected && packet.cmd == CtrlCmd.Open) {
                        let session = new ClientSession(packet.id);
                        session.state = SessionState.HalfOpened;
                        session.connectOpt = packet.openOpt!;
                        this._sessionMap.set(packet.id, session);
                        this._onSessionOpenCallback?.(packet.id, packet.openOpt!);
                    } else if(this._state == CtrlState.Connected && packet.cmd == CtrlCmd.Close) {
                        this._onSessionCloseCallback?.(packet.id);
                        this._sessionMap.delete(packet.id);
                    }
                }
            } else if (SocketState.Closed == state || SocketState.Error == state || SocketState.End == state) {
                this._state = CtrlState.None;
                this._ctrlHandler = undefined;
                this._isOnline = false;
                this._onCtrlStateCallback?.(this, 'closed', data);
            }
        } catch (e) {
            logger.error(`TunnelClient: onCtrlHandlerEvent: error: ${e}`);
            handler.close();
        }

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



    public closeSession(id: number) : boolean {
        let session =  this._sessionMap.get(id);
        if(!session || !this._ctrlHandler) {
            return false;
        }
        session.state = SessionState.End;
        this._ctrlHandler.sendData(CtrlPacket.createCloseCtrl(id).toBuffer());
        return true;
    }



    public send(id: number, data: Buffer) : boolean {
        let session =  this._sessionMap.get(id);
        if (!session || !this._ctrlHandler) {
            return false;
        }
        let packets = CtrlPacket.createDataCtrl(id, data);
        if(session.state == SessionState.HalfOpened) {
            console.log('[Client:TunnelClient]',   `PushWaitBuffer: id - ${id}`);
            for(let packet of packets) {
                session.pushWaitBuffer(packet.toBuffer());
            }
            return true;
        }
        for(let packet of packets) {
            this._ctrlHandler.sendData(packet.toBuffer());
        }
        return true;

    }





}

export {TunnelClient,  ConnectionState}