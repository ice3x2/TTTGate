import {SocketHandler} from "../util/SocketHandler";
import {ServerOption, TCPServer} from "../util/TCPServer";
import SocketState from "../util/SocketState";
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer, OpenOpt} from "../commons/CtrlPacket";
import {Buffer} from "buffer";
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
import LoggerFactory  from "../util/logger/LoggerFactory";
import {SysInfo} from "../commons/SysMonitor";
const logger = LoggerFactory.getLogger('server', 'TunnelServer');

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
}


const HANDLER_TYPE_BUNDLE_KEY = 'T';

class TunnelServer {

    private readonly _serverOption : {port: number, tls: boolean, key: string};
    private _clientHandlerPoolMap : Map<number, ClientHandlerPool> = new Map<number, ClientHandlerPool>();
    private _sessionIDAndCtrlIDMap : Map<number, number> = new Map<number, number>();

    private _tunnelServer : TCPServer;
    private readonly _key : string;
    private isRunning = false;

    private _heartbeatInterval : NodeJS.Timeout | undefined;
    private _nextSelectIdx = 0;
    private _onSessionCloseCallback? : OnSessionCloseCallback;
    private _onReceiveDataCallback? : OnReceiveDataCallback;


    public set onSessionCloseCallback(value: OnSessionCloseCallback) {
        this._onSessionCloseCallback = value;
    }

    public set onReceiveDataCallback(value: OnReceiveDataCallback) {
        this._onReceiveDataCallback = value;
    }


    private constructor(option:{port: number, tls: boolean, key: string, keepAlive: number}, certInfo: CertInfo) {
        this._serverOption = option;
        this._key = option.key;
        let tcpServerOption : ServerOption = {port: option.port, tls: option.tls, key: certInfo.key.value, cert: certInfo.cert.value, ca: (certInfo.ca.value == '') ? undefined : certInfo.ca.value};
        this._tunnelServer = TCPServer.create(tcpServerOption);
    }





    public static create(option:{port: number, tls: boolean, key: string, keepAlive: number}, certInfo: CertInfo) : TunnelServer {
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
            this._tunnelServer.setOnServerEvent(this.onServerEvent);
            this._tunnelServer.setOnHandlerEvent(this.onHandlerEvent);
            this._tunnelServer.start((err) => {
                if(err) {
                    reject(err);
                } else {
                    this.isRunning = true;
                    resolve();
                }
            });
        });
    }


    /**
     * 클라이언트 체크 인터벌을 종료한다.
     * @private
     */
    private stopClientCheckInterval() {
        if(this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = undefined;
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
                });
        });
        return result;
    }


    /**
     * 서버를 종료한다.
     */
    public async close() : Promise<void> {
        logger.info(`close`);
        this.isRunning = false;
        return new Promise((resolve) => {
            if(this._heartbeatInterval) {
                clearInterval(this._heartbeatInterval!);
            }
            this._clientHandlerPoolMap.forEach((handlerPool) => {
                handlerPool.getAllSessionIDs().forEach((id) => { this._onSessionCloseCallback?.(id, 0) });
                handlerPool.end();
            });
            this.stopClientCheckInterval();
            // noinspection JSUnusedLocalSymbols
            this._tunnelServer.stop((err) => {
                logger.info(`closed`);
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
        if(SocketState.Listen == state) {
            logger.info(`Listen: ${this._serverOption.port}`);
        } if(state == SocketState.Bound && handler) {
            if(!this.isRunning) {
                handler.end_();
                return;
            }
            logger.info(`Bound - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
            this.onClientHandlerBound(handler);
        }
    }


    private onClientHandlerBound = (handler: TunnelHandler) : void => {
        handler.handlerType = HandlerType.Unknown;
        handler.setBundle(HANDLER_TYPE_BUNDLE_KEY, HandlerType.Unknown);
        logger.info(`Bound - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
    }


    private sendSyncCtrlAck(ctrlHandler: TunnelControlHandler) : void {
        let sendBuffer = CtrlPacket.createSyncCtrlAck(ctrlHandler!.id).toBuffer();
        ctrlHandler.sendData(sendBuffer, (handler_, success, err) => {
            if(!success) {
                logger.error(`sendSyncAndSyncSyncCmd Fail - id:${ctrlHandler.id}, remote:(${ctrlHandler.socket.remoteAddress})${ctrlHandler.socket.remotePort}, ${err}`);
                ctrlHandler.destroy();
                return;
            }
            logger.info(`sendSyncAndSyncSyncCmd Success - id:${ctrlHandler.id}, remote:(${ctrlHandler.socket.remoteAddress})${ctrlHandler.socket.remotePort}`)
            ctrlHandler.ctrlState = CtrlState.Syncing;

        });
    }

    private promoteToCtrlHandler(handler: TunnelControlHandler, clientName: string) : void {
        handler.ctrlState = CtrlState.Connected;
        let ctrlHandlerPool = ClientHandlerPool.create(handler.id, handler);
        ctrlHandlerPool.onSessionCloseCallback = (sessionID: number, endLength:  number) => {
            this._onSessionCloseCallback?.(sessionID, endLength);
        }
        ctrlHandlerPool.onReceiveDataCallback = (sessionID: number, data: Buffer) => {
            this._onReceiveDataCallback?.(sessionID, data);
        }
        ctrlHandlerPool.name = clientName;
        this._clientHandlerPoolMap.set(handler.id, ctrlHandlerPool);
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
                let str = data.toString('utf-8', 0, Math.min(data.length, 64)).trim().replaceAll('\n', '\\n').replaceAll('\r', '\\r');
                logger.error(`onHandlerEvent - Unknown packet. id: ${handler.id}, addr: ${handler.remoteAddress}:${handler.remotePort}, data: ${str}...`);
                handler.end_();
                return;
            }
        }
        if(handler.handlerType == HandlerType.Control) {
            this.onReceiveCtrlHandler(handler as TunnelControlHandler, data);
        } else if(handler.handlerType == HandlerType.Data) {
            this.onReceiveDataHandler(handler as TunnelDataHandler, data);
        } else {
            logger.error(`onHandlerEvent - Unknown HandlerType. id: ${handler.id}`);
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
                    handler.dataHandlerState = DataHandlerState.Initializing;
                    handler.leftOverBuffer = undefined;
                    handler.ctrlID = result.packet.ctrlID;
                    handler.handlerID = result.packet.handlerID;
                    handler.sessionID = result.packet.firstSessionID;
                    let clientHandlerPool = this._clientHandlerPoolMap.get(handler.ctrlID);
                    if (!clientHandlerPool) {
                        logger.error(`onHandlerEvent - Not Found ClientHandlerPool. id: ${handler.ctrlID}`);
                        handler.end_();
                        return;
                    }
                    clientHandlerPool.putNewDataHandler(handler);

                } else {
                    handler.leftOverBuffer = result.remainBuffer;
                }
            } catch (e) {
                // todo : 에러 출력기 구현
                logger.error(`onHandlerEvent - DataStatePacket.fromBuffer Fail. sessionID: ${handler.sessionID}`,e);
                handler.endImmediate();
                return;
            }
        }
        else {
             let ctrlPool = this.findClientHandlerPool(handler.sessionID!);
             if(!ctrlPool) {
                 this._onSessionCloseCallback?.(handler.sessionID!, 0);
                return;
             }
             if(!ctrlPool.pushReceiveBuffer(handler.sessionID!, data)) {
                 this._onSessionCloseCallback?.(handler.sessionID!, 0);
             }
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
            logger.error(`onHandlerEvent - CtrlPacketStreamer.readCtrlPacketList Fail. ctrlID: ${handler.id}`,e);
            if(handler.handlerType == HandlerType.Control) {
                logger.error(`onHandlerEvent - CtrlPacketStreamer.readCtrlPacketList Fail. ctrlID: ${handler.id}, ${e}`);
                this.destroyClientHandlerPool(handler.id);
                return;
            } else {
                handler.destroy();
            }
            return;
        }
        for(let i = 0, len = packetList.length; i < len; i++) {
            let packet = packetList[i];
            this.onReceiveCtrlPacket(handler, packet);
        }
    }






    public terminateSession(sessionId: number) : void {
        let pool = this.findCtrlHandlerPool(sessionId);
        this._sessionIDAndCtrlIDMap.delete(sessionId);
        if(pool == undefined) {
            return;
        }
        pool.terminateSession(sessionId);


    }

    private findCtrlHandlerPool(sessionId: number) : ClientHandlerPool | undefined {
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



    public closeSession(sessionId: number, waitForLength: number) : void {
        let pool = this.findClientHandlerPool(sessionId);
        if(pool == undefined) {
            return;
        }
        pool.sendCloseSession(sessionId,waitForLength);
    }



    private onReceiveCtrlPacket(handler: TunnelHandler, packet: CtrlPacket) : void  {
        logger.info('receive ctrl packet - cmd:' + CtrlCmd[packet.cmd] + ', handler id: ' + handler.id + ', remote: ' + handler.remoteAddress + ':' + handler.remotePort);
        if(packet.cmd == CtrlCmd.SyncCtrl) {
            let ctrlHandler = handler as TunnelControlHandler;
            ctrlHandler.handlerType = HandlerType.Control;
            this.sendSyncCtrlAck(ctrlHandler);
        } else if(packet.cmd == CtrlCmd.AckCtrl) {
            if(packet.ackKey != this._key) {
                this.notMatchedAuthKey(handler as TunnelControlHandler);
                return;
            }
            this.promoteToCtrlHandler(handler as TunnelControlHandler, packet.clientName!);
        } else {
            let ctrlID = handler.id;
            let clientHandlerPool = this._clientHandlerPoolMap.get(ctrlID);
            if(!clientHandlerPool) {
                logger.error(`onHandlerEvent - Not Found ClientHandlerPool. id: ${ctrlID}`);
                handler.end_();
                return;
            }
            clientHandlerPool.delegateReceivePacketOfControlHandler(handler as TunnelControlHandler, packet);
        }
    }

    private notMatchedAuthKey(handler: TunnelControlHandler) : void {
        logger.error(`Authkey is not matched. id: ${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
        let packet = CtrlPacket.message(handler.id,{type: 'log', payload: '<Fatal> Authkey is not matched.'});
        handler.sendData(packet.toBuffer());
        this._clientHandlerPoolMap.delete(handler.id);
        setTimeout(() => {
            handler.destroy();
        },1000);
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
        if(!this.isRunning) {
            handler.destroy();
            return;
        }
        if(SocketState.Receive == state) {
            this.onReceiveAllHandler(handler, data);
        } else {
            let handlerType = (handler as TunnelHandler).handlerType;
            if(handlerType == HandlerType.Unknown || handlerType == undefined) {
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
        let clientHandlerPool = this.findCtrlHandlerPool(dataHandler.sessionID ?? -1);
        clientHandlerPool = clientHandlerPool ? clientHandlerPool : this._clientHandlerPoolMap.get(ctrlID);
        if(!clientHandlerPool) {
            logger.error(`onHandlerEvent - Not Found ClientHandlerPool. id: ${ctrlID}`);
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
            this._onSessionCloseCallback?.(id, 0);
        }
       handlerPool.getAllSessionIDs().forEach((id) => this._onSessionCloseCallback?.(id, 0) );


        this._clientHandlerPoolMap.delete(ctrlID);

        handlerPool.end();
    }

    public getClientSysInfo(clientID: number) : SysInfo | undefined {
        let handlerPool = this._clientHandlerPoolMap.get(clientID);
        if(!handlerPool) return undefined;
        return handlerPool.sysInfo;
    }


}

export { TunnelServer, ClientStatus};