
import {SocketHandler} from "../util/SocketHandler";
import {ServerOption, TCPServer} from "../util/TCPServer";
import SocketState from "../util/SocketState";
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer, OpenOpt} from "../commons/CtrlPacket";
import {Buffer} from "buffer";
import {logger} from "../commons/Logger";
import {CertInfo} from "./CertificationStore";
import {ClientHandlerPool} from "./ClientHandlerPool";
import {clearInterval} from "timers";
import {
    HandlerType,
    TunnelControlHandler,
    TunnelHandler,
    CtrlState,
    TunnelDataHandler,
    DataHandlerState
} from "../types/TunnelHandler";


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
    handler: TunnelHandler;
    lastUpdated: number;
}

//const PACKET_READER_BUNDLE_KEY = 'P';


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
                if((item.handler.handlerType == HandlerType.Control && (item.handler as TunnelControlHandler).ctrlState == CtrlState.Connected) ||
                    item.handler.handlerType == HandlerType.Data) {
                    continue;
                }
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
        this._sessionIDAndCtrlIDMap.set(sessionID, handlerPool.id);
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
            this.onClientHandlerBound(handler);
        }
    }


    private onClientHandlerBound = (handler: TunnelHandler) : void => {
        this._unknownClients.push({handler: handler, lastUpdated: Date.now()});
        handler.packetStreamer = new CtrlPacketStreamer();
        handler.handlerType = HandlerType.Unknown;
        logger.info(`TunnelServer::Bound - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
    }




    private sendSyncCtrlAck(ctrlHandler: TunnelControlHandler) : void {
        let sendBuffer = CtrlPacket.createSyncCtrlAck(ctrlHandler!.id).toBuffer();
        ctrlHandler.sendData(sendBuffer, (handler_, success, err) => {
            let index =  this._unknownClients.findIndex((item) => item.handler.id == ctrlHandler.id);
            if(!success) {
                logger.error(`TunnelServer::sendSyncAndSyncSyncCmd Fail - id:${ctrlHandler.id}, remote:(${ctrlHandler.socket.remoteAddress})${ctrlHandler.socket.remotePort}, ${err}`);
                this._unknownClients.splice(index, 1);
                ctrlHandler.destroy();
                return;
            }
            if(index > -1 && this._unknownClients[index]) {
                this._unknownClients[index].lastUpdated = Date.now();
            }
            logger.info(`TunnelServer::sendSyncAndSyncSyncCmd Success - id:${ctrlHandler.id}, remote:(${ctrlHandler.socket.remoteAddress})${ctrlHandler.socket.remotePort}`)
            ctrlHandler.ctrlState = CtrlState.Syncing;

        });
    }

    private promoteToCtrlHandler(handler: TunnelControlHandler, clientName: string) : void {
        let index = this._unknownClients.findIndex((item) => item.handler.id == handler.id);
        if(index < 0) {
            logger.error(`TunnelServer::promoteToCtrlHandler - Not Found Client. id: ${handler.id}`);
            handler.end();
            return;
        }
        this._unknownClients.splice(index, 1);
        handler.ctrlID = handler.id;
        handler.ctrlState = CtrlState.Connected;
        let ctrlHandlerPool = ClientHandlerPool.create(handler.id, handler);
        ctrlHandlerPool.name = clientName;
        this._handlerPoolMap.set(handler.id, ctrlHandlerPool);
    }

    private setNewDataHandler(handler: TunnelHandler, packet: CtrlPacket, connected: boolean) : void {
        let dataHandler = handler as TunnelDataHandler;
        dataHandler.handlerType = HandlerType.Data;
        dataHandler.ctrlID = packet.ctrlID;
        dataHandler.sessionID = packet.sessionID;
        dataHandler.dataHandlerState = connected ? DataHandlerState.OnlineSession : DataHandlerState.Wait;
        let unknownClientIndex = this._unknownClients.findIndex((item) => item.handler.id == dataHandler.id);
        if(unknownClientIndex > -1) {
            this._unknownClients.splice(unknownClientIndex, 1);
        }

        let clientHandlerPool = this._handlerPoolMap.get(dataHandler.ctrlID);
        if(!clientHandlerPool) {
            logger.error(`TunnelServer::onHandlerEvent - Not Found ClientHandlerPool. id: ${dataHandler.ctrlID}`);
            dataHandler.end();
            return;
        }
        dataHandler.dataHandlerState = connected ? DataHandlerState.OnlineSession : DataHandlerState.Wait;
        clientHandlerPool.putNewDataHandler(dataHandler);
    }

    private checkClientHandlerPool(handler: TunnelHandler, ctrlID: number, sessionID: number) : boolean {
        let clientHandlerPool = this._handlerPoolMap.get(ctrlID);
        if(!clientHandlerPool) {
            logger.error(`TunnelServer::onHandlerEvent - Not Found ClientHandlerPool. id: ${handler.id}`);
            handler.end();
            return false;
        }
        return clientHandlerPool.isSessionOpened(sessionID);
    }

    private onReceiveData(handler: TunnelHandler, data: Buffer) : void {
        let ctrlPacketStreamer = handler.packetStreamer;
        if(!ctrlPacketStreamer) {
            logger.error(`TunnelServer::onHandlerEvent - Not Found CtrlPacketStreamer. id: ${handler.id}`);
            handler.end();
            return;
        }
        let packetList : Array<CtrlPacket> = [];
        try {
            packetList = ctrlPacketStreamer.readCtrlPacketList(data);
        } catch (e) {
            // todo : 에러 출력기 구현
            console.error(e);
            if(handler.handlerType == HandlerType.Control) {
                this.removeUnknownClient(handler);
                let ctrlHandler = handler as TunnelControlHandler;
                logger.error(`TunnelServer::onHandlerEvent - CtrlPacketStreamer.readCtrlPacketList Fail. ctrlID: ${ctrlHandler.ctrlID}, ${e}`);
                this.closeHandlerPool(ctrlHandler.ctrlID ?? ctrlHandler.id);
                return;
            } else if(handler.handlerType == HandlerType.Data) {
                let dataHandler = handler as TunnelDataHandler;
                logger.error(`TunnelServer::onHandlerEvent - CtrlPacketStreamer.readCtrlPacketList Fail. sessionID: ${dataHandler.sessionID}, ${e}`);
                this.endDataHandler(dataHandler);
                return;
            } else {
                this.removeUnknownClient(handler);
                handler.destroy();
            }
            return;
        }
        for(let i = 0, len = packetList.length; i < len; i++) {
            let packet = packetList[i];
            this.onReceivePacket(handler, packet);
        }
    }


    private removeUnknownClient(handler: TunnelHandler) : void {
        let index = this._unknownClients.findIndex((item) => item.handler.id == handler.id);
        if(index > -1) {
            this._unknownClients.splice(index, 1);
        }
    }

    private closeHandlerPool(ctrlID: number) : void {
        let handlerPool = this._handlerPoolMap.get(ctrlID);
        if(!handlerPool) {
            return;
        }
        this._handlerPoolMap.delete(ctrlID);
        handlerPool.end();
    }


    public closeSession(sessionId: number) : void {
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



    private onReceivePacket(handler: TunnelHandler, packet: CtrlPacket) : void  {
        if(packet.cmd == CtrlCmd.SyncCtrl) {
            console.log("[server]",`SyncCtrl 받음 id: ${handler.id}`);
            let ctrlHandler = handler as TunnelControlHandler;
            ctrlHandler.handlerType = HandlerType.Control;
            this.sendSyncCtrlAck(ctrlHandler);
        } else if(packet.cmd == CtrlCmd.AckCtrl) {
            this.promoteToCtrlHandler(handler as TunnelControlHandler, packet.clientName!);
        }
        else if(packet.cmd == CtrlCmd.SuccessOfNewDataHandlerAndConnectEndPoint || packet.cmd == CtrlCmd.FailOfNewDataHandlerAndConnectEndPoint) {
            console.log("[server]",`데이터 핸들러 연결 세션ID: ${packet.sessionID}  ${packet.cmd == CtrlCmd.SuccessOfNewDataHandlerAndConnectEndPoint ? '성공' : '실패'}`);
            let connected = packet.cmd == CtrlCmd.SuccessOfNewDataHandlerAndConnectEndPoint;
            this.setNewDataHandler(handler,packet,connected);
            if(!connected) {
                this._onSessionCloseCallback?.(packet.sessionID);
            }
        }
        else if(packet.cmd == CtrlCmd.SuccessOfConnectEndPoint) {
            console.log("[server]",`데이터 핸들러 연결 성공 세션ID: ${packet.sessionID}`);
            let handlerPool = this._handlerPoolMap.get(packet.ctrlID);
            if(!handlerPool) {
                logger.error(`TunnelServer::onHandlerEvent - Not Found ClientHandlerPool. id: ${handler.id}`);
                handler.destroy();
                return;
            }
            this.setNewDataHandler(handler,packet,true);
        }
        else if(packet.cmd == CtrlCmd.Data) {
            if(!this.checkClientHandlerPool(handler, packet.ctrlID, packet.sessionID)) {
                this._onSessionCloseCallback?.(packet.sessionID);
                return;
            }
            this._onReceiveDataCallback?.(packet.sessionID, packet.data);
        } else if(packet.cmd == CtrlCmd.CloseSession) {
            console.log("[server]",`세션제거 요청 받음 id: ${packet.sessionID}`);
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
            let handlerType = (handler as TunnelHandler).handlerType;
            if(handlerType == HandlerType.Unknown || handlerType == undefined) {
                this._unknownClients.splice(this._unknownClients.findIndex((item) => item.handler.id == handler.id), 1);
                return;
            }
            if(handlerType == HandlerType.Control) {
                this.destroyClientHandlerPool((handler as TunnelControlHandler).ctrlID ?? handler.id);
            } else if(handlerType == HandlerType.Data) {
                this.endDataHandler(handler as TunnelDataHandler);
            }
        }
    }

    private endDataHandler(dataHandler : TunnelDataHandler) : void {
        let ctrlID = dataHandler.ctrlID ?? 0;
        let clientHandlerPool = this._handlerPoolMap.get(ctrlID);
        if(!clientHandlerPool) {
            logger.error(`TunnelServer::onHandlerEvent - Not Found ClientHandlerPool. id: ${ctrlID}`);
            dataHandler.destroy();
            return;
        }
        clientHandlerPool.endDataHandler(dataHandler);
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
        handlerPool.end();
    }



}

export { TunnelServer, ClientStatus};