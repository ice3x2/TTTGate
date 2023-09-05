import {TCPServer} from "../util/TCPServer";
import SocketState from "../util/SocketState";
import SocketHandler from "../util/SocketHandler";
import {Options} from "../option/Options";
import HttpHandler from "./http/HttpHandler";
import {logger} from "../commons/Logger";
import {CertInfo} from "./CertificationStore";


interface NewSessionCallback {
    (id:  number, opt: Options) : void;
}

interface OnHandlerEventCallback {
    (id:  number, state: SocketState, data? : Buffer) : void;
}

const OPTION_BUNDLE_KEY : string = "portTunnelOption";
const PORT_BUNDLE_KEY : string = "portNumber";

type ExternalPortServerStatus = {
    port: number,
    online: boolean,
    sessions: number,
    uptime: number,
    rx: number,
    tx: number,
}

class ExternalPortServerPool {

    private _portServerMap : Map<number, TCPServer> = new Map<number, TCPServer>();
    private _statusMap : Map<number, ExternalPortServerStatus> = new Map<number, ExternalPortServerStatus>();
    private _handlerMap : Map<number, SocketHandler | HttpHandler> = new Map<number, SocketHandler>();
    private _onNewSessionCallback : NewSessionCallback | null = null;
    private _onHandlerEventCallback : OnHandlerEventCallback | null = null;

    public static create(options: Array<Options>) : ExternalPortServerPool {
        return new ExternalPortServerPool(options);
    }


    private constructor(options: Array<Options>) {
        for(let option of options) {
            try {
                option = this.optionAdjust(option);
            } catch (e) {
                console.error(e);
            }

        }
    }

    public async startServer(option: Options, certInfo?: CertInfo) : Promise<boolean> {
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
            this._statusMap.set(option.forwardPort, {port: option.forwardPort, online: false, sessions: 0, rx: 0, tx: 0, uptime: 0});
            portServer.start((err?: Error) => {
                if(err) {
                    logger.error(`ExternalPortServer::startServer - port: ${option.forwardPort}, error:  ${err}`);
                    reject(err);
                    return;
                }
                let status = this._statusMap.get(option.forwardPort);
                if(status) {
                    status.online = true;
                    status.uptime = Date.now();
                }
                logger.info(`ExternalPortServer::startServer - port: ${option.forwardPort}, option: ${JSON.stringify(option)}`);
                this._portServerMap.set(option.forwardPort, portServer);


                resolve(true);
            });
        })
    }


    private optionAdjust(option: Options) : Options {
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

    public setOnNewSessionCallback(callback: NewSessionCallback) : void {
        this._onNewSessionCallback = callback;
    }

    public setOnHandlerEventCallback(callback: OnHandlerEventCallback) : void {
        this._onHandlerEventCallback = callback;
    }

    public getServerStatus(port: number) : ExternalPortServerStatus  {
        let status = this._statusMap.get(port);

        if(!status) {
            return {port: port, online: false, sessions: 0, rx: 0, tx: 0, uptime: 0};
        }
        return status;

    }


    public send(id: number, data: Buffer) : boolean {
        let handler = this._handlerMap.get(id);
        if(handler) {
            handler.sendData(data);
            let portNumber : number = handler.getBundle(PORT_BUNDLE_KEY);
            let status = this._statusMap.get(portNumber);
            if(status) {
                status.tx += data.length;
            }
            return true;
        }
        return false;
    }

    public closeSession(id: number) : void {
        let handler = this._handlerMap.get(id);
        if(handler) {
            handler.end();
        }
    }




    private onHandlerEvent = (handler: SocketHandler, state: SocketState, data?: any) : void => {
        //console.log("[server:ExternalPort]",`onHandlerEvent: id: ${handler.id} state: ${SocketState[state]} , data : ${data ? data.length : 0}`);
        if(SocketState.Receive == state) {
            let portNumber : number = handler.getBundle(PORT_BUNDLE_KEY);
            let status = this._statusMap.get(portNumber);
            if(status) {
                status.rx += data.length;
            }
            this._onHandlerEventCallback?.(handler.id, state, data);
        } else if(this._handlerMap.has(handler.id) && handler.isEnd()) {
            this.updateCount(handler.getBundle(OPTION_BUNDLE_KEY).forwardPort, false);
            this._handlerMap.delete(handler.id);
            this._onHandlerEventCallback?.(handler.id, state, data);
            logger.info(`ExternalPortServer::End - id: ${handler.id}, port: ${handler.getBundle(OPTION_BUNDLE_KEY).forwardPort}`);
        }
    }

    private onServerEvent = (server: TCPServer, state: SocketState, handlerOpt?: SocketHandler) : void => {
        if(SocketState.Listen == state) {
            logger.info(`ExternalPortServer::Listen - port: ${server.port}, option: ${JSON.stringify(server.getBundle(OPTION_BUNDLE_KEY))}`);
        }
        if(server.isEnd()) {
            let error = server.getError();
            if(error) {
                logger.error(`ExternalPortServer::Error - port: ${server.port}, error: ${error}`);
            }
            else logger.info(`ExternalPortServer::End - port: ${server.port}`);
            let destPort = server.getBundle(OPTION_BUNDLE_KEY).destinationPort;
            this._portServerMap.delete(destPort);
        } else if(state == SocketState.Bound) {
            let handler = handlerOpt!;
            let option = server.getBundle(OPTION_BUNDLE_KEY);
            if(!option) {
                logger.error(`ExternalPortServer::Error - port: ${server.port}, Option is undefined`);
                handler.close();
                server.stop();
                return;
            }
            option = option as Options;
            handler.setBundle(OPTION_BUNDLE_KEY, option);
            handler.setBundle(PORT_BUNDLE_KEY, server.port);

            if(option.protocol == "http" || option.protocol == "https") {
                logger.info(`ExternalPortServer::Bound HttpHandler - id:${handler.id}, port:${server.port}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
                let httpHandler = HttpHandler.create(handler, option);
                httpHandler.onSocketEvent = this.onHandlerEvent;
                this._handlerMap.set(httpHandler.id, httpHandler);
            } else {
                logger.info(`ExternalPortServer::Bound SocketHandler - id:${handler.id}, port: ${server.port}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
                this._handlerMap.set(handler.id, handler);
            }
            this.updateCount(server.port, true);
            this._onNewSessionCallback?.(handler.id, option);
        }
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
        let removeHandlers : Array<SocketHandler | HttpHandler> = [];
        this._handlerMap.forEach((handler: SocketHandler | HttpHandler, id: number) => {
            let option = handler.getBundle(OPTION_BUNDLE_KEY);
            if(option && option.forwardPort == port) {
                removeHandlers.push(handler);
            }
        });
        await this.closeHandlers(removeHandlers);
        return new Promise((resolve, reject) => {
            server?.stop((err?: Error) => {
                resolve(err != undefined);
            });
        })
    }

    private async closeHandlers(handlers: Array<SocketHandler | HttpHandler>) : Promise<void> {
        return new Promise((resolve, reject) => {
            let removeHandlerSize = handlers.length;
            if(removeHandlerSize == 0) {
                resolve();
                return;
            }
            for(let handler of handlers) {
                handler.close(()=> {
                    removeHandlerSize--;
                    if(removeHandlerSize == 0) {
                        resolve();
                        return;
                    }
                });
            }
        });
    }


    public async stopAll() : Promise<void> {
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