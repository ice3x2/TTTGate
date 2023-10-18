import {TCPServer} from "../util/TCPServer";
import SocketState from "../util/SocketState";
import {SocketHandler} from "../util/SocketHandler";
import {TunnelingOption} from "../types/TunnelingOption";
import HttpHandler from "./http/HttpHandler";
import {logger} from "../commons/Logger";
import {CertInfo} from "./CertificationStore";
import ObjectUtil from "../util/ObjectUtil";
import {EndpointHandler, EndpointHttpHandler, EndPointInfo} from "../types/EndpointHandler";
import {clearInterval} from "timers";


interface NewSessionCallback {
    (sessionID:  number, opt: TunnelingOption) : void;
}

interface OnHandlerEventCallback {
    (sessionID:  number, state: SocketState,bundle? : {data? : Buffer, receiveLength: number}) : void;
}

interface OnTerminateSessionCallback {
    (sessionID: number) : void;
}

const OPTION_BUNDLE_KEY : string = "portTunnelOption";
const PORT_BUNDLE_KEY : string = "portNumber";
const SESSION_ID_BUNDLE_KEY : string = "ID";

type ExternalPortServerStatus = {
    port: number,
    online: boolean,
    sessions: number,
    uptime: number,
    active: boolean,
    activeStart: number,
    activeTimeout: number,
    rx: number,
    tx: number,
}



const SESSION_CLEANUP_INTERVAL = 5000;

class ExternalPortServerPool {

    private _portServerMap  = new Map<number, TCPServer>();
    private _statusMap  = new Map<number, ExternalPortServerStatus>();
    private _handlerMap = new Map<number, EndpointHandler | EndpointHttpHandler>();

    private _activeTimeoutMap  = new Map<number, any>();
    private _onNewSessionCallback : NewSessionCallback | null = null;
    private _onHandlerEventCallback : OnHandlerEventCallback | null = null;
    private _onTerminateSessionCallback : OnTerminateSessionCallback | null = null;
    private _closeWaitTimeout : number = 60 * 1000;

    private static LAST_SESSION_ID = 0;

    private _sessionCleanupIntervalID : any = null;









    public static create(options: Array<TunnelingOption>) : ExternalPortServerPool {
        return new ExternalPortServerPool(options);
    }


    private constructor(options: Array<TunnelingOption>) {
        for(let option of options) {
            try {
                option = this.optionNormalization(option);
            } catch (e) {
                console.error(e);
            }
        }

        this.startSessionCleanup();


    }


    private startSessionCleanup() {
        if(this._sessionCleanupIntervalID) clearInterval(this._sessionCleanupIntervalID);
        this._sessionCleanupIntervalID = setInterval(() => {
            let now = Date.now();
            setInterval(() => {
                let closeWaitHandlerList : Array<EndpointHandler | EndpointHttpHandler> = Array.from(this._handlerMap.values())
                    .filter((handler: EndpointHandler | EndpointHttpHandler) => {
                    if(handler.closeWait) {
                        return true;
                    }
                    return false;
                });
                closeWaitHandlerList.forEach((handler: EndpointHandler | EndpointHttpHandler) => {
                    this.closeIfSatisfiedLength(handler, now - handler.lastSendTime! > this._closeWaitTimeout);
                });
            },SESSION_CLEANUP_INTERVAL);
        })
    }




    public async startServer(option: TunnelingOption, certInfo?: CertInfo) : Promise<boolean> {

        let server = this._portServerMap.get(option.forwardPort);
        if(server && !server.isEnd()) {
            return false;
        }



        return new Promise((resolve, reject) => {
            let options = {
                port: option.forwardPort,
                tls: option.tls!,
                key: certInfo?.key.value,
                cert: certInfo?.cert.value,
                ca: certInfo?.ca.value == '' ? undefined : certInfo?.ca.value
            }
            let portServer : TCPServer = TCPServer.create(options);

            portServer.setOnServerEvent(this.onServerEvent);
            portServer.setOnHandlerEvent(this.onHandlerEvent);
            portServer.setBundle(OPTION_BUNDLE_KEY, option);
            if(!option.inactiveOnStartup) option.inactiveOnStartup = false;
            this._statusMap.set(option.forwardPort, {port: option.forwardPort, online: false, sessions: 0, rx: 0, tx: 0, uptime: 0,
                active: !option.inactiveOnStartup, activeTimeout: 0, activeStart: option.inactiveOnStartup? Date.now() : 0});
            portServer.start((err?: Error) => {
                if(err) {
                    logger.error(`ExternalPortServer::startServer - port: ${option.forwardPort}`, err);
                    reject(err);
                    return;
                }
                let status = this._statusMap.get(option.forwardPort);
                if(status) {
                    status.online = true;
                    status.uptime = Date.now();
                }
                let simpleOption = ObjectUtil.cloneDeep(option) as any;
                delete simpleOption['certInfo'];
                logger.info(`ExternalPortServer::startServer - port: ${option.forwardPort}, option: ${JSON.stringify(simpleOption)}`);
                this._portServerMap.set(option.forwardPort, portServer);


                resolve(true);
            });
        })
    }


    private optionNormalization(option: TunnelingOption) : TunnelingOption {
        if(option.tls == undefined) {
            option.tls = false;
        }
        if(option.protocol == "http" && option.destinationPort == undefined) {
            option.destinationPort = 80;
        }
        else if(option.protocol == "https") {
            if(option.destinationPort == undefined) option.destinationPort = 443;
            option.tls = true;
        }

        if(option.destinationPort == undefined) {
            throw new Error("DestinationPort is undefined");
        }

        return option;


    }

    public set OnNewSessionCallback(callback: NewSessionCallback)  {
        this._onNewSessionCallback = callback;
    }

    public set OnHandlerEventCallback(callback: OnHandlerEventCallback)  {
        this._onHandlerEventCallback = callback;
    }

    public set OnTerminateSessionCallback(callback: OnTerminateSessionCallback)  {
        this._onTerminateSessionCallback = callback;
    }


    public getServerStatus(port: number) : ExternalPortServerStatus  {
        let status = this._statusMap.get(port);
        if(!status) {
            return {port: port, online: false, sessions: 0, rx: 0, tx: 0, uptime: 0, active: false, activeTimeout : 0, activeStart: 0};
        }
        return status;

    }


    public send(id: number, data: Buffer) : boolean {
        let handler = this._handlerMap.get(id);
        if(handler) {
            handler.lastSendTime = Date.now();
            handler.sendData(data, (handler: SocketHandler, success: boolean) => {
                this.onSendDataCallback(handler, success);
            });
            let portNumber : number = handler.getBundle(PORT_BUNDLE_KEY);
            let status = this._statusMap.get(portNumber);
            if(status) {
                status.tx += data.length;
            }
            return true;
        }
        return false;
    }

    private onSendDataCallback = (handler: SocketHandler,success: boolean) : void => {
        if(success) {
            this.closeIfSatisfiedLength(handler);
        }
    }

    public closeSession(id: number, endLength: number) : void {
        let handler = this._handlerMap.get(id);
        if(handler) {
            handler.endLength = endLength;
            handler.closeWait = true;
            this.closeIfSatisfiedLength(handler);
        }
    }

    private closeIfSatisfiedLength(endPointClient: EndpointHandler | EndpointHttpHandler, force: boolean = false) {
        if((endPointClient.closeWait && endPointClient.endLength! <= endPointClient.sendLength) || force) {
            console.log('세션 제거 완료: ' + endPointClient.sessionID + ' 남아있는 세션: ' + this._handlerMap.size);
            endPointClient.onSocketEvent = function () {}
            endPointClient.end_();
            this._handlerMap.delete(endPointClient.sessionID!);
            this._onTerminateSessionCallback?.(endPointClient.sessionID!)
        }
    }




    private onHandlerEvent = (handler: EndpointHandler | EndpointHttpHandler, state: SocketState, data?: any) : void => {
        let sessionID = handler.getBundle(SESSION_ID_BUNDLE_KEY)!;

            if (SocketState.Receive == state) {
                let portNumber: number = handler.getBundle(PORT_BUNDLE_KEY);
                let status = this._statusMap.get(portNumber);
                if (status) {
                    status.rx += data.length;
                }


                this._onHandlerEventCallback?.(sessionID, state, {data: data, receiveLength: handler.receiveLength});
            } else if (sessionID && (state == SocketState.End || state == SocketState.Closed)) {
                this.updateCount(handler.getBundle(OPTION_BUNDLE_KEY).forwardPort, false);
                if (this._handlerMap.has(sessionID)) {
                    this._onHandlerEventCallback?.(sessionID, SocketState.Closed, {
                        data: data,
                        receiveLength: handler.receiveLength!
                    });
                    this._handlerMap.delete(sessionID);
                }
                setImmediate(() => {
                    this._onTerminateSessionCallback?.(sessionID);
                });
                logger.info(`ExternalPortServer::End - id: ${sessionID}, port: ${handler.getBundle(OPTION_BUNDLE_KEY).forwardPort}`);
                handler.destroy();
            } else if (SocketState.Closed == state) {

            }

    }

    private onServerEvent = (server: TCPServer, state: SocketState, handlerOpt?: SocketHandler) : void => {
        if(SocketState.Listen == state) {
            logger.info(`ExternalPortServer::Listen - port: ${server.port}`);
        }
        if(server.isEnd()) {
            let error = server.getError();
            if(error) {
                logger.error(`ExternalPortServer::Error - port: ${server.port}`,error);
            }
            else logger.info(`ExternalPortServer::End - port: ${server.port}`);
            let destPort = server.getBundle(OPTION_BUNDLE_KEY).destinationPort;
            this._portServerMap.delete(destPort);
        } else if(state == SocketState.Bound) {
            let handler = handlerOpt!;
            let sessionID = ExternalPortServerPool.LAST_SESSION_ID++;
            handler.setBundle(SESSION_ID_BUNDLE_KEY, sessionID);
            let option = server.getBundle(OPTION_BUNDLE_KEY);
            if(!option) {
                logger.error(`ExternalPortServer::Error - port: ${server.port}, Option is undefined`);
                handler.destroy();
                server.stop();
                return;
            }
            let status = this._statusMap.get(server.port);
            if(status && !status.active) {
                handler.end_();
                return;
            }
            option = option as TunnelingOption;


            let bufferSizeLimit = option.bufferLimitOnServer == undefined || option.bufferLimitOnServer < 1 ? - 1 :  option.bufferLimitOnServer * 1024 * 1024;
            handler.setBufferSizeLimit(bufferSizeLimit);
            handler.setBundle(OPTION_BUNDLE_KEY, option);
            handler.setBundle(PORT_BUNDLE_KEY, server.port);

            if(option.protocol == "http" || option.protocol == "https") {
                logger.info(`ExternalPortServer::Bound HttpHandler - id:${sessionID}, port:${server.port}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
                let httpHandler = HttpHandler.create(handler, option);
                httpHandler.onSocketEvent = this.onHandlerEvent;
                this.initEndPointInfo(httpHandler as EndpointHttpHandler, sessionID, 'http');
                this._handlerMap.set(sessionID, httpHandler);
            } else {
                logger.info(`ExternalPortServer::Bound SocketHandler - id:${sessionID}, port: ${server.port}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
                this.initEndPointInfo(handler as EndpointHandler, sessionID, 'tcp');
                this._handlerMap.set(sessionID, handler);
            }
            this.updateCount(server.port, true);
            this._onNewSessionCallback?.(sessionID, option);
        }
    }

    private initEndPointInfo(endpointInfo: EndPointInfo, sessionID: number, type: 'http' | 'tcp') {
        endpointInfo.closeWait = false;
        endpointInfo.endLength = 0;
        endpointInfo.lastSendTime = Date.now();
        endpointInfo.sessionID = sessionID;
        endpointInfo.protocolType = type;
    }

    private updateCount(port: number, increase: boolean) : void {
        let status = this._statusMap.get(port);
        if(!status) {
            return;
        }
        status.sessions += increase ? 1 : -1;
        status.sessions = Math.max(0, status.sessions);
    }

    public async stop(port: number) : Promise<boolean> {
        let server = this._portServerMap.get(port);
        if(!server) {
            return false;
        }
        await this.removeHandlerByForwardPort(port);
        return new Promise((resolve, reject) => {
            server?.stop((err?: Error) => {
                resolve(err != undefined);
            });
        })
    }

    private async destroyHandlers(ids: Array<number>) : Promise<void> {
        let handlers : Array<SocketHandler | HttpHandler> = [];
        for(let id of ids) {
            let handler = this._handlerMap.get(id);
            if(handler) {
                handlers.push(handler);
                handler.destroy();
            }
        }
        return new Promise((resolve, reject) => {
            if(handlers.length == 0) {
                resolve();
                return;
            }
            while(handlers.length > 0) {
                let handler = handlers.pop()!;
                handler.destroy();
            }
            resolve();
        });
    }

    private async removeHandlerByForwardPort(port: number) : Promise<void> {

        let ids = Array.from(this._handlerMap.values())
            .filter((handler: SocketHandler | HttpHandler)=> handler.getBundle(OPTION_BUNDLE_KEY)?.forwardPort == port )
            .map((handler: SocketHandler | HttpHandler) => { return handler.getBundle(SESSION_ID_BUNDLE_KEY)!; });
        await this.destroyHandlers(ids);
    }

    public async inactive(port: number) : Promise<boolean> {
        let status = this._statusMap.get(port);
        if(!status) {
            return false;
        }
        status.active = false;
        await this.removeHandlerByForwardPort(port);
        return true;
    }


    public setActiveTimeout(port: number, timeout: number) : boolean {
        let status = this._statusMap.get(port);
        if(!status) {
            return false;
        }
        status.activeTimeout = timeout;
        return true;
    }

    public async active(port: number, timeout?: number) : Promise<boolean> {
        let status = this._statusMap.get(port);
        if(!status) {
            return false;
        }
        if(timeout == undefined) timeout = status.activeTimeout;
        let timeoutCtrl = this._activeTimeoutMap.get(port);
        if(timeoutCtrl != undefined) clearTimeout(timeoutCtrl);
        status.active = true;
        status.activeTimeout = timeout;
        status.activeStart = Date.now();
        if(timeout > 0){
            timeoutCtrl = setTimeout(async () => {
                await this.inactive(port);
            }, timeout * 1000);
            this._activeTimeoutMap.set(port, timeoutCtrl);
        }
        return true;
    }


    public async stopAll() : Promise<void> {
        if(this._sessionCleanupIntervalID) {
            clearInterval(this._sessionCleanupIntervalID);
            this._sessionCleanupIntervalID = null;
        }
        logger.info(`ExternalPortServer::closeAll`);
        let callbackCount = this._portServerMap.size;
        if(callbackCount == 0) return;
        return new Promise((resolve, reject) => {
            this._portServerMap.forEach((server: TCPServer, port: number) => {
                server.stop((err?: Error) => {
                    callbackCount--;
                    logger.info(`ExternalPortServer::close - port: ${port}, left count: ${callbackCount}`);
                    if(callbackCount == 0) {
                        logger.info(`ExternalPortServer::closeAll - done`);
                        this._portServerMap.clear();
                        this._handlerMap.clear();
                        resolve();
                    }
                });
            });
        });
    }
}


export { ExternalPortServerPool, ExternalPortServerStatus };