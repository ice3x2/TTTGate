import SessionState from "../option/SessionState";
import SocketHandler from "../util/SocketHandler";
import {TCPServer, ServerOption} from "../util/TCPServer";
import SocketState from "../util/SocketState";
import {CtrlCmd, CtrlPacket} from "../commons/CtrlPacket";
import {Buffer} from "buffer";
import {ConnectOpt} from "../option/ConnectOpt";
import ControlSession from "../commons/ControlSession";
import ClientSession from "../commons/ClientSession";
import {logger} from "../commons/Logger";
import {CertInfo} from "./CertificationStore";




interface OnReceiveDataCallback {
    (id : number, data: Buffer) : void;
}

interface OnSessionCloseCallback {
    (id: number, opt: ConnectOpt) : void;
}



class TunnelServer {

    private readonly _serverOption : {port: number, tls: boolean, key: string};
    private _sessionMap : Map<number, ClientSession> = new Map<number, ClientSession>();
    private _ctrlSessionMap : Map<number, ControlSession> = new Map<number, ControlSession>();
    private _ctrlHandlerMap : Map<number, SocketHandler> = new Map<number, SocketHandler>();
    private _tunnelServer : TCPServer;
    private _certInfo : CertInfo;
    private readonly _key : string;

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
        this._certInfo = certInfo;
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

    // noinspection JSUnusedGlobalSymbols
    public async close() : Promise<void> {
        logger.info(`TunnelServer::close`);
        return new Promise((resolve, reject) => {
            // noinspection JSUnusedLocalSymbols
            this._tunnelServer.stop((err) => {
                logger.info(`TunnelServer::closed`);
                resolve();
            });
        });

    }

    public sendBuffer(sessionId: number, buffer: Buffer) : boolean {
        let packets = CtrlPacket.createDataCtrl(sessionId, buffer);
        if(!this.available()) {
            return false;
        }
        let session = this._sessionMap.get(sessionId);
        if(!session || session.isEnd()) {
            return false;
        }
        if(session.state == SessionState.HalfOpened || session.state == SessionState.Connected) {
            let handler = this._ctrlHandlerMap.get(session.controlId);
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
        let handler = this._ctrlHandlerMap.get(session.controlId);
        if(!handler) {
            this._sessionMap.delete(sessionId);
            return;
        }
        session.state = SessionState.End;
        let packet : CtrlPacket = CtrlPacket.createCloseCtrl(sessionId);
        handler.sendData(packet.toBuffer(), (handler, success, err?) => {
            if(!success) {
                logger.error(`TunnelServer:: Send data error - id:${sessionId}, err:${err}`);
            }
            if(session) session.state = SessionState.Closed;
            this._sessionMap.delete(sessionId);
        });
    }


    public open(id: number,opt : ConnectOpt, allowClientNames?: Array<string>) : boolean {
        if(!this.available()) {
            return false;
        }
        let handler = this.getNextHandler(allowClientNames);
        if(handler == null) {
            return false;
        }
        let buffer = CtrlPacket.createOpen(id,opt).toBuffer();
        let clientSession = ClientSession.createClientSession(id);
        clientSession.connectOpt = opt;
        clientSession.controlId = handler.id;
        this._sessionMap.set(id, clientSession);
        handler.sendData(buffer, (handler, success, err?) => {
            let session = this._sessionMap.get(id);
            if(!session) {
                logger.warning(`TunnelServer:: fail to send open. session is null => ${id}(${opt.host}:${opt.port}`);
                return;
            }
            else if(!success) {
                logger.error(`TunnelServer:: fail to send open => ${id}(${opt.host}:${opt.port}) ${err}`);
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
            logger.debug(`TunnelServer:: send Open => ${id}(${opt.host}:${opt.port})`);
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
            return this._ctrlHandlerMap.get(ids[0])!;
        }
        let nextId = ids[++this._nextSelectIdx % ids.length];
        return this._ctrlHandlerMap.get(nextId)!;
    }




    private onServerEvent = (server: TCPServer, state: SocketState, handler? : SocketHandler) : void => {
        //console.log("[server]",`TunnelServer: onServerEvent: ${SocketState[state]}`);
        if(SocketState.Listen == state) {
            logger.info(`TunnelServer::Listen: ${this._serverOption.port}`);
            //console.log("[server]",`TunnelServer: onServerEvent:  ${SocketState[state]}: ${this._port}`);
        } if(state == SocketState.Bound && handler) {
            logger.info(`TunnelServer::Bound - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
            handler.socket.setKeepAlive(true, 30000);
            this.onClientHandlerBound(handler);
        }
    }


    private onClientHandlerBound = (handler: SocketHandler) : void => {
        this._ctrlHandlerMap.set(handler.id, handler);
        let ctrlSession = ControlSession.createControlSession(handler.id);
        this._ctrlSessionMap.set(handler.id, ctrlSession);
        logger.info(`TunnelServer::Bound - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
        this.sendSyncAndSyncSyncCmd(handler, ctrlSession);
    }


    private sendSyncAndSyncSyncCmd(handler: SocketHandler, ctrlSession : ControlSession) : void {
        //console.log("[server]",'TunnelServer: makeCtrlHandler - change state => ' + SessionState[SessionState.HalfOpened]);
        logger.info(`TunnelServer::sendSyncAndSyncSyncCmd - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`)
        ctrlSession.state = SessionState.HalfOpened;
        let sendBuffer = CtrlPacket.createSyncCtrl(handler!.id).toBuffer();
        handler.sendData(sendBuffer, (handler, success, err) => {
            if(!success) {
                logger.error(`TunnelServer::sendSyncAndSyncSyncCmd Fail - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}, ${err}`);
                this.closeCtrlHandler(handler);
                return;
            }
            logger.info(`TunnelServer::sendSyncAndSyncSyncCmd Success - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`)
            //console.log("[server]",'TunnelServer: makeCtrlHandler - change state => ' + SessionState[SessionState.Handshaking]);
            ctrlSession.state = SessionState.Handshaking;
            handler.sendData(CtrlPacket.createSyncSyncCtrl(handler!.id).toBuffer());
        });
    }



    private onHandlerEvent = (handler: SocketHandler, state: SocketState, data?: any) : void => {

        if(SocketState.Receive == state) {
            let ctrlHandlerID = handler.id;
            let ctrlSession = this._ctrlSessionMap.get(ctrlHandlerID);
            if(!ctrlSession) {
                //console.log("[server]",`TunnelServer: Not Found CtrlSession. id: ${ctrlHandlerID}`);
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
                if(ctrlSession.state == SessionState.Handshaking) {
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
                    } else if(ctrlPacket.cmd == CtrlCmd.Close) {
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
        this._ctrlHandlerMap.delete(handler.id);
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

export default TunnelServer;