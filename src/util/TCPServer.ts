import net from "net";
import { SocketHandler } from  "./SocketHandler";
import SocketState from "./SocketState";
import * as tls from "tls";
import LoggerFactory  from "../util/logger/LoggerFactory";
const logger = LoggerFactory.getLogger('', 'TCPServer');


interface OnServerEvent {
    (server: TCPServer, state: SocketState, handler? : SocketHandler,info?: {address?: string, port?: number}) : void;
}

interface OnSocketEvent {
    (handler: SocketHandler,info: {address?: string, port?: number}, state: SocketState, data?: any) : void;
}

interface ServerOption {port: number, tls?: boolean, ca?: string, cert?: string, key?: string};

class TCPServer {


    private readonly _options : ServerOption;
    private _server : net.Server;
    private _idHandlerMap : Map<number, SocketHandler> = new Map<number, SocketHandler>();
    private _onServerEvent? : OnServerEvent;
    private _onHandlerEvent? : OnSocketEvent;
    private _state : SocketState = SocketState.None;
    private _bundle : Map<string, any> = new Map<string, any>();
    private _error : any = undefined;



    public isEnd() : boolean {
        return this._state == SocketState.Closed || this._state == SocketState.End;
    }

    public getError()  : any {
        return this._error;
    }

    public isListen() : boolean {
        return this._state == SocketState.Listen;
    }

    public setOnServerEvent(event: OnServerEvent) {
        this._onServerEvent = event;
    }

    public setBundle(key: string, value: any) {
        this._bundle.set(key, value);
    }

    public getBundle(key: string) : any {
        return this._bundle.get(key);
    }

    public deleteBundle(key: string) : void {
        this._bundle.delete(key);
    }

    public get port() : number {
        return this._options.port;
    }



    public setOnHandlerEvent(event: OnSocketEvent) {
        this._onHandlerEvent = event;
    }

    private constructor(options: ServerOption) {
        options.tls = options.tls ?? false;
        this._options = options;


        if(options.tls) {
            let tlsOption : any = {
                key: options.key,
                cert: options.cert,
                secureProtocol: 'TLSv1_2_server_method'
            }
            if(options.ca) {
                tlsOption.ca = options.ca;
            }
            this._server = tls.createServer(tlsOption,this.onBind);
        } else {
            this._server = net.createServer(this.onBind)
        }
        this._server.on('error', (error) => {
            this._error = error;
            if(!this.isEnd()) {
                logger.error(`TCPServer: error: ${error}`);
                this._state = SocketState.Closed;
                this._onServerEvent?.(this, SocketState.Closed);
                this.release();
            }
            this._state = SocketState.Closed;

        });
        this._server.on('close', () => {
            if(!this.isEnd()) {
                this._state = SocketState.Closed;
                this._onServerEvent?.(this, SocketState.Closed);
                this.release();
            }
            this._state = SocketState.Closed;
        });
        this._server.on('listening', () => {
            if(this._state == SocketState.Starting) {
                this._state = SocketState.Listen;
                this._onServerEvent?.(this, SocketState.Listen);
            }
        });
    }


    private onBind = (socket: net.Socket) : void => {
        let option = {socket:socket, port: this._options.port, addr: "127.0.0.1", tls: this._options.tls ?? false };
        let info = {address: socket.remoteAddress, port: socket.remotePort};
        let handler = SocketHandler.bound(option,(handler,info, state, data) => {
            if(state == SocketState.Closed || /*state == SocketState.Error ||*/ state == SocketState.End) {
                this._idHandlerMap.delete(handler.id);
            }
            this._onHandlerEvent?.(handler,info, state, data);
        });
        this._idHandlerMap.set(handler.id, handler);

        const ipv4Regex = /(\d{1,3}\.){3}\d{1,3}/;
        const ipv4Address = socket.remoteAddress?.match(ipv4Regex)?.[0];

        this._onServerEvent?.(this, SocketState.Bound, handler, {address: ipv4Address, port: socket.remotePort});
    }

    public static create(options: ServerOption) : TCPServer {
        let server = new TCPServer(options);
        return server;
    }


    public start(callback? : (err?: Error) => void) : void {
        if(this.isEnd()) {
            this._server = net.createServer(this.onBind)
            this._state = SocketState.None;
        }
        if(this._state == SocketState.None) {
            if(callback) {
                this._server.once('listening', () => {
                    callback(undefined);
                });
                this._server.once('error', (err) => {
                    callback(err);
                });
            }
            this._state = SocketState.Starting;
            this._server.listen(this._options.port);
        }
    }

    public stop(callback?: (err?: Error) => void) : void {
        if(!this.isEnd()) {
            this._idHandlerMap.forEach((handler) => {
               handler.destroy();
            });
            this._server.once('close', () => {
                callback?.(undefined);
                this.release();
            });
            this._server.on('error', (err) => {
                callback?.(err);
                this.release();
            });
            this._server.close();
        } else if(callback) {
            callback(new Error("Server is already closed"));
        }
    }

    private release() : void {
        this._server.removeAllListeners();
        this._onServerEvent = undefined;
        this._onHandlerEvent = undefined;
    }



}

export {TCPServer, OnServerEvent, OnSocketEvent, ServerOption}