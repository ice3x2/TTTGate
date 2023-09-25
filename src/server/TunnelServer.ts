import SessionState from "../option/SessionState";
import {SocketHandler} from "../util/SocketHandler";
import {ServerOption, TCPServer} from "../util/TCPServer";
import SocketState from "../util/SocketState";
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer, OpenOpt} from "../commons/CtrlPacket";
import {Buffer} from "buffer";
import ConnectOpt from "../util/ConnectOpt";
import ControlSession from "../commons/ControlSession";
import ClientSession from "../commons/ClientSession";
import {logger} from "../commons/Logger";
import {CertInfo} from "./CertificationStore";
import {HandlerPool} from "../commons/HandlerPool";
import {clearInterval} from "timers";


interface OnReceiveDataCallback {
    (id : number, data: Buffer) : void;
}

interface OnSessionCloseCallback {
    (id: number, opt: ConnectOpt) : void;
}


interface ClientStatus {
    id: number;
    state: 'connecting' | 'connected' | 'end';
    name: string,
    uptime: number;
    address: string;
}

interface Client {
    handler: SocketHandler;
    created: number;
    available: boolean;
}

const PACKET_READER_BUNDLE_KEY = 'R';
const HANDLER_STATUS_BUNDLE_KEY = 'S';


class TunnelServer {

    private readonly _serverOption : {port: number, tls: boolean, key: string};
    private _unknownClients : Set<Client> = new Set<Client>();
    private _handlerPoolMap : Map<number, HandlerPool> = new Map<number, HandlerPool>();
    private _sessionAndHandlerPoolMap : Map<number, HandlerPool> = new Map<number, HandlerPool>();

    private _tunnelServer : TCPServer;
    private readonly _key : string;

    private _clientCheckIntervalId : NodeJS.Timeout | undefined;
    private _clientTimeout : number = 30000;

    private _onSessionCloseCallback? : OnSessionCloseCallback;
    private _onReceiveDataCallback? : OnReceiveDataCallback;


    public set onSessionCloseCallback(value: OnSessionCloseCallback) {
        this._onSessionCloseCallback = value;
    }

    public set onReceiveDataCallback(value: OnReceiveDataCallback) {
        this._onReceiveDataCallback = value;
    }


    private constructor(option:{port: number, tls: boolean, key: string}, certInfo: CertInfo) {
        this._serverOption = option;
        this._key = option.key;
        let tcpServerOption : ServerOption = {port: option.port, tls: option.tls, key: certInfo.key.value, cert: certInfo.cert.value, ca: (certInfo.ca.value == '') ? undefined : certInfo.ca.value};
        this._tunnelServer = TCPServer.create(tcpServerOption);
    }

    public static create(option:{port: number, tls: boolean, key: string}, certInfo: CertInfo) : TunnelServer {
        return new TunnelServer(option, certInfo);
    }


    public get port() : number {
        return this._serverOption.port;
    }

    public get tls() : boolean {
        return this._serverOption.tls === undefined ? false : this._serverOption.tls;
    }

    public async start() : Promise<void> {
        return new Promise((resolve, reject) => {
            this.startUnknownClientCheckInterval();
            this._tunnelServer.setOnServerEvent(this.onServerEvent);
            this._tunnelServer.setOnHandlerEvent(this.onHandlerEvent);
            this._tunnelServer.start((err) => {
                if(err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    private startUnknownClientCheckInterval() {
        if(this._clientCheckIntervalId) {
            clearInterval(this._clientCheckIntervalId);
            this._clientCheckIntervalId = undefined;
        }
        let currentTime = Date.now();
        this._clientCheckIntervalId = setInterval(() => {
            let cleanUpTargets : Array<Client> = [];
            this._unknownClients.forEach((item) => {
                if(!item.available && currentTime - item.created > this._clientTimeout) {
                    cleanUpTargets.push(item);
                }
            });
            for(let item of cleanUpTargets) {
                this._unknownClients.splice(this._unknownClients.indexOf(item), 1);
                item.handler.end();
            }
        });
    }

    private stopUnknownClientCheckInterval() {
        if(this._clientCheckIntervalId) {
            clearInterval(this._clientCheckIntervalId);
            this._clientCheckIntervalId = undefined;
        }
    }

    public clientStatuses() : Array<ClientStatus> {
        let result : Array<ClientStatus> = [];
        /*this._ctrlSessionMap.forEach((session, id) => {
            result.push(
                {
                    id: id,
                    state: TunnelServer.sessionStateToString(session.state),
                    name: session.clientName,
                    uptime: Date.now() - session.createTime,
                    address: session.address
                });
        });*/
        return result;
    }

    private static sessionStateToString(state: SessionState) : 'connecting' | 'connected' | 'end' {
        if(state == SessionState.HalfOpened || state == SessionState.Handshaking) {
            return 'connecting';
        }
        else if(state == SessionState.Closed || state == SessionState.None) {
            return 'end';
        }
        return 'connected';
    }

    // noinspection JSUnusedGlobalSymbols
    public async close() : Promise<void> {
        logger.info(`TunnelServer::close`);
        return new Promise((resolve, reject) => {
            this.stopUnknownClientCheckInterval();
            // noinspection JSUnusedLocalSymbols
            this._tunnelServer.stop((err) => {
                logger.info(`TunnelServer::closed`);
                resolve();
            });
        });

    }

    public sendBuffer(sessionId: number, buffer: Buffer) : boolean {
        let packets = CtrlPacket.createSessionData(sessionId, buffer);
        if(!this.available()) {
            return false;
        }
        let session = this._sessionMap.get(sessionId);
        if(!session || session.isEnd()) {
            return false;
        }
        if(session.state == SessionState.HalfOpened || session.state == SessionState.Connected) {
            let handler = this._handlerPoolMap.get(session.controlId);
            if(!handler) {
                this._sessionMap.delete(sessionId);
                return false;
            }
            for(let packet of packets) {
                handler.sendData(packet.toBuffer());
            }
        } else {
            for(let packet of packets) {
                session.pushWaitBuffer(packet.toBuffer());
            }
        }
        return true;
    }




    public closeSession(sessionId: number) : void {
        let session = this._sessionMap.get(sessionId);
        if(!session) {
            return;
        }
        let handler = this._handlerPoolMap.get(session.controlId);
        if(!handler) {
            this._sessionMap.delete(sessionId);
            return;
        }
        session.state = SessionState.End;
        let packet : CtrlPacket = CtrlPacket.createCloseSession(sessionId);
        handler.sendData(packet.toBuffer(), (handler, success, err?) => {
            if(!success) {
                logger.error(`TunnelServer:: Send data error - id:${sessionId}, err:${err}`);
            }
            if(session) session.state = SessionState.Closed;
            this._sessionMap.delete(sessionId);
        });
    }


    public open(sessionID: number,opt : OpenOpt, allowClientNames?: Array<string>) : boolean {
        if(!this.available()) {
            return false;
        }
        let handler = this.getNextHandler(allowClientNames);
        if(handler == null) {
            return false;
        }
        let buffer = CtrlPacket.connectEndPoint(sessionID,opt).toBuffer();
        let clientSession = ClientSession.createClientSession(sessionID);
        clientSession.connectOpt = opt;
        clientSession.controlId = handler.id;
        this._sessionMap.set(sessionID, clientSession);
        handler.sendData(buffer, (handler, success, err?) => {
            let session = this._sessionMap.get(sessionID);
            if(!session) {
                logger.warning(`TunnelServer:: fail to send open. session is null => ${sessionID}(${opt.host}:${opt.port}`);
                return;
            }
            else if(!success) {
                logger.error(`TunnelServer:: fail to send open => ${sessionID}(${opt.host}:${opt.port}) ${err}`);
                return;
            }
            else {
                session.state = SessionState.HalfOpened;
                let waitBuffer : Buffer | undefined = session.popWaitBuffer();
                while(waitBuffer) {
                    handler.sendData(waitBuffer);
                    waitBuffer = session.popWaitBuffer();
                }
            }
            logger.debug(`TunnelServer:: send Open => ${sessionID}(${opt.host}:${opt.port})`);
        })
        return true;
    }

    private available() : boolean {
        let available = false;
        this._ctrlSessionMap.forEach((session) => {
            if(session.state == SessionState.Connected) {
                available = true;
            }
        });
        return available;
    }

    private _nextSelectIdx = 0;


    private getNextHandler(allowClientNames?: Array<string>) : SocketHandler | null {
        if(this._ctrlSessionMap.size == 0) {
            return null;
        }
        let ids: Array<number> = [];
        if(!allowClientNames || allowClientNames.length == 0) {
           ids =  Array.from(this._ctrlSessionMap.keys());
        }  else {
            this._ctrlSessionMap.forEach((session, id) => {
                if(allowClientNames.includes(session.clientName)) {
                    ids.push(id);
                }
            });
        }
        if(ids.length == 1) {
            return this._handlerPoolMap.get(ids[0])!;
        }
        let nextId = ids[++this._nextSelectIdx % ids.length];
        return this._handlerPoolMap.get(nextId)!;
    }




    private onServerEvent = (server: TCPServer, state: SocketState, handler? : SocketHandler) : void => {
        //console.log("[server]",`TunnelServer: onServerEvent: ${SocketState[state]}`);
        if(SocketState.Listen == state) {
            logger.info(`TunnelServer::Listen: ${this._serverOption.port}`);
            //console.log("[server]",`TunnelServer: onServerEvent:  ${SocketState[state]}: ${this._port}`);
        } if(state == SocketState.Bound && handler) {
            logger.info(`TunnelServer::Bound - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
            handler.socket.setKeepAlive(true, 15000);
            this.onClientHandlerBound(handler);
        }
    }


    private onClientHandlerBound = (handler: SocketHandler) : void => {
        this._unknownClients.push({handler: handler, created: Date.now(), available: false});
        handler.setBundle(PACKET_READER_BUNDLE_KEY, new CtrlPacketStreamer());
        logger.info(`TunnelServer::Bound - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
    }

    // todo: 주기적으로 체크해서 아무것도 아닌 클라이언트 연결을 끊고 제거한다.

    private onReceiveCtrlPacket = (handler: SocketHandler, ctrlPacket: CtrlPacket) : void => {

    };



    private sendSyncCtrlAck(handler: SocketHandler, ctrlSession : ControlSession) : void {
        let sendBuffer = CtrlPacket.createSyncCtrlAck(handler!.id).toBuffer();
        handler.sendData(sendBuffer, (handler, success, err) => {
            if(!success) {
                logger.error(`TunnelServer::sendSyncAndSyncSyncCmd Fail - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}, ${err}`);
                this.closeCtrlHandler(handler);
                return;
            }
            logger.info(`TunnelServer::sendSyncAndSyncSyncCmd Success - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`)
            //console.log("[server]",'TunnelServer: makeCtrlHandler - change state => ' + SessionState[SessionState.Handshaking]);
            ctrlSession.state = SessionState.Handshaking;
        });
    }


    private onHandlerEvent = (handler: SocketHandler, state: SocketState, data?: any) : void => {
        if(SocketState.Receive == state) {
            let ctrlPacketStreamer = handler.getBundle(PACKET_READER_BUNDLE_KEY) as CtrlPacketStreamer;
            if(!ctrlPacketStreamer) {
                logger.error(`TunnelServer::onHandlerEvent - Not Found CtrlPacketStreamer. id: ${handler.id}`);
                handler.end();
                return;
            }
            let packetList = ctrlPacketStreamer.readCtrlPacketList(data);
            for(let packet of packetList) {
                if(packet.cmd == CtrlCmd.SyncCtrl || packet.cmd == CtrlCmd.AckCtrl) {
                    // 컨트롤 패킷 연결 시도.
                }
                else if(packet.cmd == CtrlCmd.SuccessOfNewDataHandlerAndConnectEndPoint || packet.cmd == CtrlCmd.FailOfNewDataHandlerAndConnectEndPoint) {
                    // 데이터 핸들러 연결 시도.
                }
                else if(packet.cmd == CtrlCmd.Data){

                }
                else if(packet.cmd == CtrlCmd.CloseSession){

                }
            }




            let ctrlHandlerID = handler.id;
            let ctrlSession = this._ctrlSessionMap.get(ctrlHandlerID);
            if(!ctrlSession) {
                logger.error(`TunnelServer::onHandlerEvent - Not Found CtrlSession. id: ${ctrlHandlerID}`);
                handler.end();
                return;
            }
            let ctrlPackets : Array<CtrlPacket> | undefined;
            try {
                ctrlPackets = ctrlSession.readCtrlPacketList(data);
            } catch (e) {
                logger.error(`TunnelServer::onHandlerEvent - Fail to parse ctrlPacket. id: ${ctrlHandlerID}, err: ${e}`);
                this.closeCtrlHandler(handler);
                return;
            }

            for(let ctrlPacket of ctrlPackets!) {
                if(ctrlSession.state == SessionState.HalfOpened) {
                    if(ctrlPacket.cmd == CtrlCmd.SyncCtrl) {
                        this.sendSyncCtrlAck(handler, ctrlSession);
                    }
                    else {
                        logger.info(`TunnelServer::onHandlerEvent - Change state => Close. id: ${ctrlHandlerID}`);
                        this.closeCtrlHandler(handler);
                        return;
                    }
                }
                else if(ctrlSession.state == SessionState.Handshaking) {
                    if(ctrlPacket.cmd == CtrlCmd.AckCtrl) {
                        if(ctrlPacket.ackKey != this._key) {
                            logger.error(`TunnelServer::onHandlerEvent - Not Found CtrlSession. id: ${ctrlHandlerID}`);
                            this.closeCtrlHandler(handler);
                            return;
                        }
                        ctrlSession.state = SessionState.Connected;
                        if(ctrlPacket.clientName) {
                            ctrlSession.clientName = ctrlPacket.clientName;
                        }
                        logger.info(`TunnelServer::onHandlerEvent - Change state => Connected, id: ${ctrlHandlerID}, client name: ${ctrlPacket.clientName}`);
                    } else {
                        logger.info(`TunnelServer::onHandlerEvent - Change state => Close. id: ${ctrlHandlerID}`);
                        this.closeCtrlHandler(handler);
                        return;
                    }
                } else if(ctrlSession.state == SessionState.Connected) {
                    if(ctrlPacket.cmd == CtrlCmd.Data) {
                        this._onReceiveDataCallback?.(ctrlPacket.id, ctrlPacket.data);
                    } else if(ctrlPacket.cmd == CtrlCmd.CloseSession) {
                        let clientSession = this._sessionMap.get(ctrlPacket.id);
                        if(clientSession) {
                            this._onSessionCloseCallback?.(ctrlPacket.id, clientSession.connectOpt);
                            this._sessionMap.delete(ctrlPacket.id);
                        }
                    }
                }
            }
        } else {
            let ctrlSession = this._ctrlSessionMap.get(handler.id);
            if(ctrlSession) {
                ctrlSession.state = SessionState.End;
            }
            this.closeCtrlHandler(handler);
        }
    }

    private closeCtrlHandler = (handler: SocketHandler) : void => {
        this._handlerPoolMap.delete(handler.id);
        this._ctrlSessionMap.delete(handler.id);
        let deleteSessionIDs : Array<number> = [];
        this._sessionMap.forEach((session, id) => {
            if(session.controlId == handler.id) {
                deleteSessionIDs.push(id);
                this._onSessionCloseCallback?.(id, session.connectOpt);
            }
        })
        for(let id of deleteSessionIDs) {
            this._sessionMap.delete(id);
        }
        handler.end();
    }

}

export { TunnelServer, ClientStatus};