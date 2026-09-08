import net from "net";
import {SocketHandler} from "./SocketHandler";
import SocketState from "./SocketState";
import * as tls from "tls";
import LoggerFactory from "../util/logger/LoggerFactory";
import {TlsOptionsFactoryRegistry} from "./TlsOptionsFactory";

const logger = LoggerFactory.getLogger('socket', 'TCPServer');


const DEFAULT_KEEP_ALIVE : number = 10000;

interface OnServerEvent {
    (server: TCPServer, state: SocketState, handler? : SocketHandler) : void;
}

interface OnSocketEvent {
    (handler: SocketHandler, state: SocketState, data?: any) : void;
}

interface ServerOption {port: number, tls?: boolean, ca?: string, cert?: string, key?: string, keepAlive?: number};

class TCPServer {

    static readonly DEFAULT_KEEP_ALIVE : number = DEFAULT_KEEP_ALIVE;

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
        this._options.keepAlive = this._options.keepAlive ?? DEFAULT_KEEP_ALIVE;
        this._server = this.createServer();
    }

    private createServer(): net.Server {
        const server = this._options.tls
            ? tls.createServer(TlsOptionsFactoryRegistry.current().createServerTlsOptions(this._options), this.onBind)
            : net.createServer(this.onBind);
        server.on('error', (error) => {
            if(server !== this._server) return;
            this._error = error;
            if(!this.isEnd()) {
                logger.error(`TCPServer: error: ${error}`);
                this._state = SocketState.Closed;
                this.release(server);
                this._onServerEvent?.(this, SocketState.Closed);
            }
        });
        server.on('close', () => {
            if(server !== this._server) return;
            if(!this.isEnd()) {
                this._state = SocketState.Closed;
                this.release(server);
                this._onServerEvent?.(this, SocketState.Closed);
            }
        });
        server.on('listening', () => {
            if(server === this._server && this._state == SocketState.Starting) {
                this._state = SocketState.Listen;
                this._onServerEvent?.(this, SocketState.Listen);
            }
        });
        return server;
    }

    private onBind = (socket: net.Socket) : void => {
        let option = {socket:socket, port: this._options.port, addr: "127.0.0.1", tls: this._options.tls ?? false , keepAlive: this._options.keepAlive ?? DEFAULT_KEEP_ALIVE};
        let handler = SocketHandler.bound(option,(handler, state, data) => {
            this._onHandlerEvent?.(handler, state, data);
        }, (ownedHandler) => {
            this._idHandlerMap.delete(ownedHandler.id);
        });
        this._idHandlerMap.set(handler.id, handler);
        this._onServerEvent?.(this, SocketState.Bound, handler);
    }

    public static create(options: ServerOption) : TCPServer {
        return new TCPServer(options);
    }

    /**
     * P3-T5 / REQ-08: 외부 TLS 포트의 인증서 hot-apply.
     *
     * 현 서버가 tls.Server인 경우에 한해 `setSecureContext`를 호출한다.
     * net.Server 또는 이미 종료된 서버에는 무동작(false 반환).
     * 성공 시 내부 옵션(cert/key/ca)도 최신 값으로 갱신한다.
     */
    public applyTlsCertificateHotSwap(next: {key: string, cert: string, ca?: string}): boolean {
        if(this.isEnd()) return false;
        if(!this._options.tls) return false;
        if(!(this._server instanceof tls.Server)) return false;
        if(!next || !next.cert || !next.key) return false;
        const ctx: { key: string, cert: string, ca?: string } = { key: next.key, cert: next.cert };
        if(next.ca && next.ca.length > 0) ctx.ca = next.ca;
        try {
            (this._server as tls.Server).setSecureContext(ctx as any);
            this._options.cert = next.cert;
            this._options.key = next.key;
            this._options.ca = next.ca && next.ca.length > 0 ? next.ca : undefined;
            logger.info(`TCPServer: TLS secure context hot-swapped on port ${this._options.port}`);
            return true;
        } catch (e) {
            logger.error(`TCPServer: setSecureContext failed on port ${this._options.port}`, e);
            return false;
        }
    }


    public start(callback? : (err?: Error) => void) : void {
        if(this.isEnd()) {
            this._server = this.createServer();
            this._state = SocketState.None;
            this._error = undefined;
        }
        if(this._state == SocketState.None) {
            if(callback) this.onceCompletion(this._server, 'listening', callback);
            this._state = SocketState.Starting;
            this._server.listen(this._options.port);
        }
    }

    public stop(callback?: (err?: Error) => void) : void {
        if(!this.isEnd()) {
            this._idHandlerMap.forEach((handler) => {
               handler.destroy();
            });
            if(callback) this.onceCompletion(this._server, 'close', callback);
            this._server.close();
        } else if(callback) {
            callback(new Error("Server is already closed"));
        }
    }

    private onceCompletion(server: net.Server, event: 'listening' | 'close', callback: (err?: Error) => void): void {
        const onSuccess = () => {
            server.removeListener('error', onError);
            callback(undefined);
        };
        const onError = (error: Error) => {
            server.removeListener(event, onSuccess);
            callback(error);
        };
        server.once(event, onSuccess);
        server.once('error', onError);
    }

    private release(server: net.Server) : void {
        server.removeAllListeners();
    }



}

export {TCPServer, OnServerEvent, OnSocketEvent, ServerOption}
