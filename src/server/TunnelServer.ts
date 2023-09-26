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
const CTRL_ID_BUNDLE_KEY = 'I';



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
            this.startClientCheckInterval();
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

    private startClientCheckInterval() {
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

    private stopClientCheckInterval() {
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


    public async close() : Promise<void> {
        logger.info(`TunnelServer::close`);
        return new Promise((resolve, reject) => {
            this.stopClientCheckInterval();
            // noinspection JSUnusedLocalSymbols
            this._tunnelServer.stop((err) => {
                logger.info(`TunnelServer::closed`);
                resolve();
            });
        });
    }

    public sendBuffer(sessionId: number, buffer: Buffer) : boolean {
        if(!this.available()) {
            return false;
        }
        //let session =  //this._sessionMap.get(sessionId);
        let ctrlID = this._sessionIDAndCtrlIDMap.get(sessionId);
        if(ctrlID == undefined) {
            return false;
        }
        let handlerPool = this._handlerPoolMap.get(ctrlID);
        if(!handlerPool) {
            return false;
        }
        let sessionDataPacketList = CtrlPacket.sessionData(ctrlID, sessionId, buffer);
        for(let packet of sessionDataPacketList) {
            if(!handlerPool.sendPacket(sessionId, packet)) {
                return false;
            }
        }
        return true;
    }


    public openSession(sessionID: number, opt : OpenOpt, allowClientNames?: Array<string>) : boolean {
        if(!this.available()) {
            return false;
        }
        let handlerPool = this.getNextHandlerPool(allowClientNames);
        if(handlerPool == null) {
            return false;
        }
        handlerPool.sendConnectEndPoint(sessionID, opt);
        return true;

    }

    private available() : boolean {
        return this._handlerPoolMap.size > 0;
    }

    private _nextSelectIdx = 0;


    private getNextHandlerPool(allowClientNames?: Array<string>) : ClientHandlerPool | null {
        if(this._handlerPoolMap.size == 0) {
            return null;
        }
        let ids: Array<number> = [];
        if(!allowClientNames || allowClientNames.length == 0) {
           ids =  Array.from(this._handlerPoolMap.keys());
        }  else {
            this._handlerPoolMap.forEach((handlerPool, ctrlID) => {
                if(allowClientNames.includes(handlerPool.name)) {
                    ids.push(ctrlID);
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
                this._unknownClients.splice(index, 1);
                handler.destroy();
                return;
            }
            this._unknownClients[index].lastUpdated = Date.now();
            logger.info(`TunnelServer::sendSyncAndSyncSyncCmd Success - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`)
            handler.setBundle(HANDLER_STATUS_BUNDLE_KEY, SessionState.Handshaking);
        });
    }

    private promoteToCtrlHandler(handler: SocketHandler, clientName: string) : void {
        let index = this._unknownClients.findIndex((item) => item.handler.id == handler.id);
        if(index < 0) {
            logger.error(`TunnelServer::promoteToCtrlHandler - Not Found Client. id: ${handler.id}`);
            handler.end();
            return;
        }
        this._unknownClients.splice(index, 1);

        handler.setBundle(HANDLER_TYPE_BUNDLE_KEY, HandlerType.Control);
        handler.setBundle(CTRL_ID_BUNDLE_KEY, handler.id);
        let ctrlHandlerPool = ClientHandlerPool.create(handler.id, handler);
        ctrlHandlerPool.name = clientName;
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
        handler.setBundle(CTRL_ID_BUNDLE_KEY, ctrlID);
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
        let packetList : Array<CtrlPacket> = [];
        try {
            packetList = ctrlPacketStreamer.readCtrlPacketList(data);
        } catch (e) {
            logger.error(`TunnelServer::onHandlerEvent - CtrlPacketStreamer.readCtrlPacketList Fail. id: ${handler.id}, ${e}`);
            // todo 핸들러 타입을 구분하여 처리해야한다. unknown: unknown 리스트에서 제거, control: , data
            handler.end();
            return;
        }
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
            this.promoteToCtrlHandler(handler, packet.clientName!);
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


    /**
     * 클라이언트 핸들러로부터 이벤트를 받았을때 호출된다.
     * Receive 이벤트는 클라이언트로부터 데이터를 받았을때 호출된다.
     * 그 외에는 close 이벤트가 호출된다.
     * @param handler
     * @param state
     * @param data
     */
    private onHandlerEvent = (handler: SocketHandler, state: SocketState, data?: any) : void => {
        if(SocketState.Receive == state) {
            this.onReceiveData(handler, data);
        } else {
            let handlerType = handler.getBundle(HANDLER_TYPE_BUNDLE_KEY) as HandlerType;
            if(handlerType == HandlerType.Unknown) {
                this._unknownClients.splice(this._unknownClients.findIndex((item) => item.handler.id == handler.id), 1);
                return;
            }
            let ctrlID = handler.getBundle(CTRL_ID_BUNDLE_KEY) as number;
            if(handlerType == HandlerType.Control) {
                this.destroyClientHandlerPool(ctrlID);
            } else if(handlerType == HandlerType.Data) {
                this.endDataHandler(ctrlID, handler);
            }
        }
    }

    private endDataHandler(ctrlID: number, handler: SocketHandler) : void {
        let clientHandlerPool = this._handlerPoolMap.get(ctrlID);
        if(!clientHandlerPool) {
            logger.error(`TunnelServer::onHandlerEvent - Not Found ClientHandlerPool. id: ${ctrlID}`);
            handler.end();
            return;
        }
        clientHandlerPool.endDataHandler(handler);
    }

    /**
     * 핸들러 풀에서 인자로 받은 ctrlID 에 대항하는 풀을 제거하고, 내부의 모든 세션 종료 메시지를 보낸 후에 연결을 종료한다.
     * @param ctrlID
     * @private
     */
    private destroyClientHandlerPool(ctrlID: number) : void {
        let handlerPool = this._handlerPoolMap.get(ctrlID);
        if(!handlerPool) {
            return;
        }
        let removeSessionIDs : Array<number> = [];
        this._sessionIDAndCtrlIDMap.forEach((value, key) => {
            if(value == ctrlID) {
                removeSessionIDs.push(key);
            }
        });
        for(let id of removeSessionIDs) {
            this._sessionIDAndCtrlIDMap.delete(id);
        }

        this._handlerPoolMap.delete(ctrlID);
        handlerPool.destroy();
    }



}

export { TunnelServer, ClientStatus};