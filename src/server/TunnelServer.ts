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
    CtrlState,
    DataHandlerState,
    HandlerType,
    TunnelControlHandler,
    TunnelDataHandler,
    TunnelHandler
} from "../types/TunnelHandler";
import DataStatePacket from "../commons/DataStatePacket";


interface OnReceiveDataCallback {
    (id : number, data: Buffer) : void;
}

interface OnSessionCloseCallback {
    (id: number, endLength: number) : void;
}


interface ClientStatus {
    id: number;
    name: string,
    uptime: number;
    address: string;
    activeSessionCount: number;
    dataHandlerCount: number;
}

interface Client {
    handler: TunnelHandler;
    lastUpdated: number;
}

const HANDLER_TYPE_BUNDLE_KEY = 'T';


class TunnelServer {

    private readonly _serverOption : {port: number, tls: boolean, key: string};
    private _unknownClients : Array<Client> = new Array<Client>();
    private _clientHandlerPoolMap : Map<number, ClientHandlerPool> = new Map<number, ClientHandlerPool>();
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

    /**
     * 클라이언트 체크 인터벌을 시작한다.
     * 아직 상태 및 타입을 알 수 없는 클라이언트를 체크하여 타임아웃된 클라이언트를 종료하고 Unkown Client 목록에서 제거한다.
     * @private
     */
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
                this.removeUnknownClient(item.handler);
                if((item.handler.handlerType == HandlerType.Control && (item.handler as TunnelControlHandler).ctrlState == CtrlState.Connected) ||
                    item.handler.handlerType == HandlerType.Data) {
                    continue;
                }
                item.handler.end_();
            }
        });
    }

    /**
     * Unknown Client 목록에서 클라이언트를 제거한다.
     * @param handler 제거할 클라이언트 핸들러
     * @private
     */
    private removeUnknownClient(handler: TunnelHandler) : void {
        let index = this._unknownClients.findIndex((item) => item.handler.id == handler.id);
        if(index > -1) {
            this._unknownClients.splice(index, 1);
        }
    }

    /**
     * 클라이언트 체크 인터벌을 종료한다.
     * @private
     */
    private stopClientCheckInterval() {
        if(this._clientCheckIntervalId) {
            clearInterval(this._clientCheckIntervalId);
            this._clientCheckIntervalId = undefined;
        }
    }

    public clientStatuses() : Array<ClientStatus> {
        let result : Array<ClientStatus> = [];
        this._clientHandlerPoolMap.forEach((handlerPool, ctrlID) => {
            result.push(
                {
                    id: ctrlID,
                    name: handlerPool.name,
                    uptime: Date.now() - handlerPool.createTime,
                    address: handlerPool.address,
                    activeSessionCount: handlerPool.activatedSessionCount,
                    dataHandlerCount: handlerPool.dataHandlerCount
                });

        });
        return result;
    }


    /**
     * 서버를 종료한다.
     */
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

    /**
     * 해당 세션의 데이터를 전송한다.
     * 세션에 할당된 데이터 핸들러를 찾아서 데이터를 전송한다.
     * @param sessionId 세션ID
     * @param buffer 전송할 데이터
     * @return 성공여부
     */
    public sendBuffer(sessionId: number, buffer: Buffer) : boolean {
        if(!this.available()) {
            return false;
        }
        let ctrlID = this._sessionIDAndCtrlIDMap.get(sessionId);
        if(ctrlID == undefined) {
            return false;
        }
        let handlerPool = this._clientHandlerPoolMap.get(ctrlID);
        if(!handlerPool) {
            return false;
        }
        return handlerPool.sendBuffer(sessionId, buffer);
    }


    /**
     * 세션을 연다.
     * @param sessionID 새로운 세션ID
     * @param opt 연결할 End Point 서버에 대한 정보.
     * @param allowClientNames 허용할 클라이언트 이름 목록. 목록에 포함된 클라이언트만 세션을 연다. 목록이 없으면 모든 클라이언트를 허용한다.
     */
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
        return this._clientHandlerPoolMap.size > 0;
    }

    private _nextSelectIdx = 0;


    private getNextHandlerPool(allowClientNames?: Array<string>) : ClientHandlerPool | null {
        if(this._clientHandlerPoolMap.size == 0) {
            return null;
        }
        let ids: Array<number> = [];
        if(!allowClientNames || allowClientNames.length == 0) {
           ids =  Array.from(this._clientHandlerPoolMap.keys());
        }  else {
            this._clientHandlerPoolMap.forEach((handlerPool, ctrlID) => {
                if(allowClientNames.includes(handlerPool.name)) {
                    ids.push(ctrlID);
                }
            });
        }
        if(ids.length == 1) {
            return this._clientHandlerPoolMap.get(ids[0])!;
        }
        let nextId = ids[++this._nextSelectIdx % ids.length];
        return this._clientHandlerPoolMap.get(nextId)!;
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
        handler.handlerType = HandlerType.Unknown;
        handler.setBundle(HANDLER_TYPE_BUNDLE_KEY, HandlerType.Unknown);
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
        if(index < 0 && !this._clientHandlerPoolMap.has(handler.id)) {
            logger.error(`TunnelServer::promoteToCtrlHandler - Not Found Client. id: ${handler.id}`);
            handler.end_();
            return;
        }
        this._unknownClients.splice(index, 1);
        handler.ctrlState = CtrlState.Connected;
        let ctrlHandlerPool = ClientHandlerPool.create(handler.id, handler);
        ctrlHandlerPool.onSessionCloseCallback = (sessionID: number, endLength:  number) => {
            //this._sessionIDAndCtrlIDMap.delete(sessionID);
            this._onSessionCloseCallback?.(sessionID, endLength);
        }
        ctrlHandlerPool.onReceiveDataCallback = (sessionID: number, data: Buffer) => {
            this._onReceiveDataCallback?.(sessionID, data);
        }
        ctrlHandlerPool.name = clientName;
        this._clientHandlerPoolMap.set(handler.id, ctrlHandlerPool);
    }

    private checkClientHandlerPool(handler: TunnelHandler, ctrlID: number, sessionID: number) : boolean {
        let clientHandlerPool = this._clientHandlerPoolMap.get(ctrlID);
        if(!clientHandlerPool) {
            logger.error(`TunnelServer::onHandlerEvent - Not Found ClientHandlerPool. id: ${handler.id}`);
            handler.end_();
            return false;
        }
        return clientHandlerPool.isSessionOpened(sessionID);
    }

    private onReceiveAllHandler(handler: TunnelHandler, data: Buffer) : void {
        if(handler.handlerType == HandlerType.Unknown && data.length > 0) {
            let delimiter = data.toString('utf-8',0,1);
            if(delimiter == CtrlPacket.PACKET_DELIMITER) {
                let ctrlHandler = handler as TunnelControlHandler;
                ctrlHandler.handlerType = HandlerType.Control;
                ctrlHandler.packetStreamer = new CtrlPacketStreamer();
            } else if(delimiter == DataStatePacket.PACKET_DELIMITER) {
                let dataHandler = handler as TunnelDataHandler;
                dataHandler.handlerType = HandlerType.Data;
                dataHandler.dataHandlerState = DataHandlerState.None;
            } else {
                logger.error(`TunnelServer::onHandlerEvent - Unknown HandlerType. id: ${handler.id}`);
                this.removeUnknownClient(handler);
                handler.end_();
                return;
            }
        }
        if(handler.handlerType == HandlerType.Control) {
            this.onReceiveCtrlHandler(handler as TunnelControlHandler, data);
        } else if(handler.handlerType == HandlerType.Data) {
            this.onReceiveDataHandler(handler as TunnelDataHandler, data);
        } else {
            logger.error(`TunnelServer::onHandlerEvent - Unknown HandlerType. id: ${handler.id}`);
            this.removeUnknownClient(handler);
            handler.end_();
            return;
        }
    }


    /**
     * 데이터 핸들러에서 데이터를 받았을때 호출된다.
     * @param handler
     * @param data
     * @private
     */
    private onReceiveDataHandler(handler: TunnelDataHandler, data: Buffer) : void  {
        if(handler.dataHandlerState == DataHandlerState.None) {
            if(handler.leftOverBuffer) {
                data = Buffer.concat([handler.leftOverBuffer, data]);
                handler.leftOverBuffer = undefined;
            }
            try {
                let result = DataStatePacket.fromBuffer(data);
                if (result.packet) {
                    handler.dataHandlerState = DataHandlerState.Wait;
                    handler.leftOverBuffer = undefined;
                    handler.ctrlID = result.packet.ctrlID;
                    handler.handlerID = result.packet.handlerID;
                    handler.sessionID = result.packet.firstSessionID;
                    let clientHandlerPool = this._clientHandlerPoolMap.get(handler.ctrlID);
                    if (!clientHandlerPool) {
                        logger.error(`TunnelServer::onHandlerEvent - Not Found ClientHandlerPool. id: ${handler.ctrlID}`);
                        handler.end_();
                        return;
                    }
                    clientHandlerPool.putNewDataHandler(handler);

                } else {
                    handler.leftOverBuffer = result.remainBuffer;
                }
            } catch (e) {
                // todo : 에러 출력기 구현
                console.error(e);
                logger.error(`TunnelServer::onHandlerEvent - DataStatePacket.fromBuffer Fail. sessionID: ${handler.sessionID}, ${e}`);
                handler.endImmediate();
                return;
            }
        }
        else {
             let ctrlPool = this.findClientHandlerPool(handler.sessionID!);
             if(!ctrlPool) {
                return;
             }
             ctrlPool.pushReceiveBuffer(handler.sessionID!, data);
             return;
        }
    }

    private findClientHandlerPool(sessionId: number) : ClientHandlerPool | undefined {
        let ctrlID = this._sessionIDAndCtrlIDMap.get(sessionId);
        if(ctrlID == undefined) {
            return undefined;
        }
        let clientHandlerPool = this._clientHandlerPoolMap.get(ctrlID);
        if(!clientHandlerPool) {
            return undefined;
        }
        return clientHandlerPool;

    }


    /**
     * 컨트롤 핸들러에서 데이터를 받았을때 호출된다.
     * @param handler
     * @param data
     * @private
     */
    private onReceiveCtrlHandler(handler: TunnelControlHandler, data: Buffer) : void  {
        let packetList : Array<CtrlPacket> = [];
        try {
            packetList = handler.packetStreamer!.readCtrlPacketList(data);
        } catch (e) {
            // todo : 에러 출력기 구현
            console.error(e);
            if(handler.handlerType == HandlerType.Control) {
                this.removeUnknownClient(handler);
                logger.error(`TunnelServer::onHandlerEvent - CtrlPacketStreamer.readCtrlPacketList Fail. ctrlID: ${handler.id}, ${e}`);
                this.closeHandlerPool(handler.id);
                return;
            } else {
                this.removeUnknownClient(handler);
                handler.destroy();
            }
            return;
        }
        for(let i = 0, len = packetList.length; i < len; i++) {
            let packet = packetList[i];
            this.onReceiveCtrlPacket(handler, packet);
        }
    }


    private closeHandlerPool(ctrlID: number) : void {
        let handlerPool = this._clientHandlerPoolMap.get(ctrlID);
        if(!handlerPool) {
            return;
        }
        this._clientHandlerPoolMap.delete(ctrlID);
        handlerPool.end();
    }



    public closeSession(sessionId: number, waitForLength: number) : void {
        let ctrlID = this._sessionIDAndCtrlIDMap.get(sessionId);
        //this._sessionIDAndCtrlIDMap.delete(sessionId);
        if(ctrlID == undefined) {
            return;
        }
        let pool = this._clientHandlerPoolMap.get(ctrlID);
        if(pool == undefined) {
            return;
        }
        pool.sendCloseSession(sessionId, waitForLength);
    }



    private onReceiveCtrlPacket(handler: TunnelHandler, packet: CtrlPacket) : void  {
        if(packet.cmd == CtrlCmd.SyncCtrl) {
            console.log("[server]",`SyncCtrl 받음 id: ${handler.id}`);
            let ctrlHandler = handler as TunnelControlHandler;
            ctrlHandler.handlerType = HandlerType.Control;
            this.sendSyncCtrlAck(ctrlHandler);
        } else if(packet.cmd == CtrlCmd.AckCtrl) {
            this.promoteToCtrlHandler(handler as TunnelControlHandler, packet.clientName!);
        } else {
            let ctrlID = handler.id;
            let clientHandlerPool = this._clientHandlerPoolMap.get(ctrlID);
            if(!clientHandlerPool) {
                logger.error(`TunnelServer::onHandlerEvent - Not Found ClientHandlerPool. id: ${ctrlID}`);
                handler.end_();
                return;
            }
            clientHandlerPool.delegateReceivePacketOfControlHandler(handler as TunnelControlHandler, packet);
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
            this.onReceiveAllHandler(handler, data);
        } else {
            let handlerType = (handler as TunnelHandler).handlerType;
            if(handlerType == HandlerType.Unknown || handlerType == undefined) {
                this._unknownClients.splice(this._unknownClients.findIndex((item) => item.handler.id == handler.id), 1);
                return;
            }
            if(handlerType == HandlerType.Control) {
                this.destroyClientHandlerPool(handler.id);
            } else if(handlerType == HandlerType.Data) {
                this.endDataHandler(handler as TunnelDataHandler);
            }
        }
    }

    private endDataHandler(dataHandler : TunnelDataHandler) : void {
        let ctrlID = dataHandler.ctrlID ?? 0;
        let clientHandlerPool = this._clientHandlerPoolMap.get(ctrlID);
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
        let handlerPool = this._clientHandlerPoolMap.get(ctrlID);
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

        this._clientHandlerPoolMap.delete(ctrlID);
        handlerPool.end();
    }



}

export { TunnelServer, ClientStatus};