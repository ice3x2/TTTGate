import SessionState from "../option/SessionState";
import {SocketHandler} from "../util/SocketHandler";
import {ServerOption, TCPServer} from "../util/TCPServer";
import SocketState from "../util/SocketState";
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer, OpenOpt} from "../commons/CtrlPacket";
import {Buffer} from "buffer";
import ClientSession from "../commons/ClientSession";
import {logger} from "../commons/Logger";
import {CertInfo} from "./CertificationStore";
import {ClientHandlerPool} from "../commons/ClientHandlerPool";
import {clearInterval} from "timers";


enum HandlerType {
    Unknown,
    Control,
    Data
}

interface OnReceiveDataCallback {
    (id : number, data: Buffer) : void;
}

interface OnSessionCloseCallback {
    (id: number) : void;
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
    lastUpdated: number;
}



const PACKET_READER_BUNDLE_KEY = 'R';
const HANDLER_STATUS_BUNDLE_KEY = 'S';
const HANDLER_TYPE_BUNDLE_KEY = 'T';


class TunnelServer {

    private readonly _serverOption : {port: number, tls: boolean, key: string};
    private _unknownClients : Array<Client> = new Array<Client>();
    private _handlerPoolMap : Map<number, ClientHandlerPool> = new Map<number, ClientHandlerPool>();
    private _sessionIDAndCtrlIDMap : Map<number, number> = new Map<number, number>();

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
                if(currentTime - item.lastUpdated > this._clientTimeout) {
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
        this._unknownClients.push({handler: handler, lastUpdated: Date.now()});
        handler.setBundle(HANDLER_TYPE_BUNDLE_KEY, HandlerType.Unknown);
        handler.setBundle(PACKET_READER_BUNDLE_KEY, new CtrlPacketStreamer());
        logger.info(`TunnelServer::Bound - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
    }




    private sendSyncCtrlAck(handler: SocketHandler) : void {
        let sendBuffer = CtrlPacket.createSyncCtrlAck(handler!.id).toBuffer();
        handler.sendData(sendBuffer, (handler, success, err) => {
            let index =  this._unknownClients.findIndex((item) => item.handler.id == handler.id);
            if(!success) {
                logger.error(`TunnelServer::sendSyncAndSyncSyncCmd Fail - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}, ${err}`);
                this.closeCtrlHandler(handler);
                this._unknownClients.splice(index, 1);
                return;
            }
            this._unknownClients[index].lastUpdated = Date.now();
            logger.info(`TunnelServer::sendSyncAndSyncSyncCmd Success - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`)
            handler.setBundle(HANDLER_STATUS_BUNDLE_KEY, SessionState.Handshaking);
        });
    }

    private promoteToCtrlHandler(handler: SocketHandler) : void {
        let index = this._unknownClients.findIndex((item) => item.handler.id == handler.id);
        if(index < 0) {
            logger.error(`TunnelServer::promoteToCtrlHandler - Not Found Client. id: ${handler.id}`);
            handler.end();
            return;
        }
        this._unknownClients.splice(index, 1);
        handler.setBundle(HANDLER_TYPE_BUNDLE_KEY, HandlerType.Control);
        let ctrlHandlerPool = ClientHandlerPool.create(handler.id, handler);
        this._handlerPoolMap.set(handler.id, ctrlHandlerPool);
    }

    private setNewDataHandler(handler: SocketHandler, packet: CtrlPacket, connected: boolean) : void {
        let ctrlID = packet.ctrlID;
        let sessionID = packet.sessionID;
        let clientHandlerPool = this._handlerPoolMap.get(ctrlID);
        if(!clientHandlerPool) {
            logger.error(`TunnelServer::onHandlerEvent - Not Found ClientHandlerPool. id: ${ctrlID}`);
            handler.end();
            return;
        }
        handler.setBundle(HANDLER_TYPE_BUNDLE_KEY, HandlerType.Data);
        clientHandlerPool.putNewDataHandler(sessionID, connected, handler);
    }

    private checkClientHandlerPool(handler: SocketHandler, ctrlID: number, sessionID: number) : boolean {
        let clientHandlerPool = this._handlerPoolMap.get(ctrlID);
        if(!clientHandlerPool) {
            logger.error(`TunnelServer::onHandlerEvent - Not Found ClientHandlerPool. id: ${handler.id}`);
            handler.end();
            return false;
        }
        return clientHandlerPool.isSessionOpened(sessionID);

    }

    private onReceiveData(handler: SocketHandler, data: Buffer) : void {
        let ctrlPacketStreamer = handler.getBundle(PACKET_READER_BUNDLE_KEY) as CtrlPacketStreamer;
        if(!ctrlPacketStreamer) {
            logger.error(`TunnelServer::onHandlerEvent - Not Found CtrlPacketStreamer. id: ${handler.id}`);
            handler.end();
            return;
        }
        let packetList = ctrlPacketStreamer.readCtrlPacketList(data);
        for(let i = 0, len = packetList.length; i < len; i++) {
            let packet = packetList[i];
            this.onReceivePacket(handler, packet);
        }
    }


    private closeSession(sessionId: number) : void {
        this.releaseSession(sessionId, false);
    }

    private releaseSession(sessionId: number, fromClient: boolean) : void {
        let ctrlID = this._sessionIDAndCtrlIDMap.get(sessionId);
        this._sessionIDAndCtrlIDMap.delete(sessionId);
        if(ctrlID == undefined) {
            return;
        }
        let pool = this._handlerPoolMap.get(ctrlID);
        if(pool == undefined) {
            return;
        }
        if(fromClient) {
            pool.releaseSession(sessionId);
        } else {
            pool.closeSession(sessionId);
        }
    }



    private onReceivePacket(handler: SocketHandler, packet: CtrlPacket) : void  {
        if(packet.cmd == CtrlCmd.SyncCtrl) {
            handler.setBundle(HANDLER_STATUS_BUNDLE_KEY,SessionState.HalfOpened);
            this.sendSyncCtrlAck(handler);
        } else if(packet.cmd == CtrlCmd.AckCtrl) {
            this.promoteToCtrlHandler(handler);
        }
        else if(packet.cmd == CtrlCmd.SuccessOfNewDataHandlerAndConnectEndPoint || packet.cmd == CtrlCmd.FailOfNewDataHandlerAndConnectEndPoint) {
            let connected = packet.cmd == CtrlCmd.SuccessOfNewDataHandlerAndConnectEndPoint;
            this.setNewDataHandler(handler,packet,connected);
            if(!connected) {
                this._onSessionCloseCallback?.(packet.sessionID);
            }
        } else if(packet.cmd == CtrlCmd.Data) {
            if(!this.checkClientHandlerPool(handler, packet.ctrlID, packet.sessionID)) {
                this._onSessionCloseCallback?.(packet.sessionID);
                return;
            }
            this._onReceiveDataCallback?.(packet.sessionID, packet.data);
        } else if(packet.cmd == CtrlCmd.CloseSession) {
            this.releaseSession(packet.sessionID, true);
        }
    }


    private onHandlerEvent = (handler: SocketHandler, state: SocketState, data?: any) : void => {
        if(SocketState.Receive == state) {
            this.onReceiveData(handler, data);
        } else {
            let handlerType = handler.getBundle(HANDLER_TYPE_BUNDLE_KEY) as HandlerType;
            if(handlerType == HandlerType.Control) {
                // todo 여기서 컨트롤 핸들러를 닫고, 해당풀에 속해있는 모든 세션과 데이터 핸들러를 닫아야 한다.
            }


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