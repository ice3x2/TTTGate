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

// U5-02 / #117 — 수락 직후, 자원 할당 전 판정. AdmissionDecision과 구조적으로 호환되는 지역 타입
// (util/ 은 server/security를 import하지 않는다).
type AdmitVerdict = {allowed: true} | {allowed: false; reason: string; retryAfterMs?: number; rejectResponse?: Buffer};

interface ServerOption {port: number, tls?: boolean, ca?: string, cert?: string, key?: string, keepAlive?: number, requestClientCert?: boolean, admit?: (remoteAddress: string | undefined) => AdmitVerdict,
    /** TLS 핸드셰이크 기한(ms). 핸드셰이크가 끝나기 전 연결은 바인드되지 않아 미인증 기한 밖에 있으므로 따로 끊는다(#174). */
    handshakeTimeoutMs?: number,
    /** TLS 핸드셰이크 중인 연결 수의 상한. 넘는 새 TCP 연결은 바로 닫는다(#181). 미지정이면 상한 없음. */
    maxPendingTlsHandshakes?: number,
    /** 같은 주소 버킷이 핸드셰이크 중일 수 있는 연결 수. 주소 하나가 대기 슬롯을 다 차지하지 못하게 한다(#181). */
    maxPendingTlsHandshakesPerAddress?: number,
    /** 주소를 버킷으로 묶는 함수(예: IPv4 주소 하나, IPv6 /64). 없으면 주소 그대로 쓴다. */
    addressBucketOf?: (remoteAddress: string) => string};

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

    public get handlerCount() : number {
        return this._idHandlerMap.size;
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

    private serverTlsOptions(): tls.TlsOptions {
        const options = TlsOptionsFactoryRegistry.current().createServerTlsOptions(this._options);
        if(this._options.handshakeTimeoutMs !== undefined) options.handshakeTimeout = this._options.handshakeTimeoutMs;
        return options;
    }

    /**
     * 핸드셰이크가 끝나기 전 연결은 바인드 뒤에 세는 미인증 상한 밖에 있다. 약한 서버(512MB)에서 fd·메모리가
     * 고갈되지 않게 그 수를 묶는다. secureConnection 의 TLS 소켓은 _parent 로 원래 TCP 소켓을 가리킨다(Node 내부).
     * 그 대응을 찾지 못해도 TCP 소켓의 close 에서 반드시 줄어든다.
     */
    private limitPendingTlsHandshakes(server: tls.Server, max: number): void {
        // 서버마다 따로 센다. stop() 이 이 서버의 대기 연결을 닫는다.
        const pending = new Map<net.Socket, string>();
        const perBucket = new Map<string, number>();
        const maxPerBucket = this._options.maxPendingTlsHandshakesPerAddress ?? Number.POSITIVE_INFINITY;
        const bucketOf = this._options.addressBucketOf ?? ((address: string) => address);
        const release = (raw: net.Socket) => {
            const bucket = pending.get(raw);
            if(bucket === undefined) return;
            pending.delete(raw);
            const count = (perBucket.get(bucket) ?? 1) - 1;
            if(count > 0) perBucket.set(bucket, count); else perBucket.delete(bucket);
        };
        this._pendingTlsSockets = pending;
        server.on('connection', (raw: net.Socket) => {
            const bucket = bucketOf(raw.remoteAddress ?? '');
            const fromBucket = perBucket.get(bucket) ?? 0;
            if(pending.size >= max || fromBucket >= maxPerBucket) {
                this.warnThrottled(`too many pending TLS handshakes on port ${this._options.port}${fromBucket >= maxPerBucket ? ` from ${bucket}` : ''}; closing new connections`);
                raw.destroy();
                return;
            }
            pending.set(raw, bucket);
            perBucket.set(bucket, fromBucket + 1);
            raw.once('close', () => release(raw));
        });
        server.on('secureConnection', (secure: tls.TLSSocket) => {
            const raw = (secure as unknown as {_parent?: net.Socket})._parent;
            if(raw) release(raw);
        });
    }

    private _pendingTlsSockets: Map<net.Socket, string> | undefined;
    private _lastWarnAt = 0;
    private _suppressedWarns = 0;

    /** 공격 중에는 거절이 초당 수십 번 난다. 약한 서버의 디스크·CPU 를 지키려고 10초에 한 줄만 남긴다(#181). */
    private warnThrottled(message: string): void {
        const now = Date.now();
        if(now - this._lastWarnAt < 10_000) { this._suppressedWarns++; return; }
        logger.warn(`TCPServer: ${message}${this._suppressedWarns > 0 ? ` (${this._suppressedWarns} more since the last warning)` : ''}`);
        this._lastWarnAt = now;
        this._suppressedWarns = 0;
    }

    private createServer(): net.Server {
        const server = this._options.tls
            ? tls.createServer(this.serverTlsOptions(), this.onBind)
            : net.createServer(this.onBind);
        if(this._options.tls && this._options.maxPendingTlsHandshakes !== undefined) this.limitPendingTlsHandshakes(server as tls.Server, this._options.maxPendingTlsHandshakes);
        if(this._options.tls) {
            // 핸드셰이크 기한이 지나도 Node 는 tlsClientError 만 내고 TCP 소켓을 그대로 둔다. 직접 닫아야 슬롯이 풀린다(#174).
            server.on('tlsClientError', (error, socket) => {
                logger.debug(`TCPServer: TLS client error: ${error.message}`);
                socket.destroy();
            });
        }
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
        if(this._options.admit) {
            const verdict = this._options.admit(socket.remoteAddress);
            if(!verdict.allowed) {
                if(verdict.rejectResponse) socket.end(verdict.rejectResponse); else socket.destroy();
                return;
            }
        }
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
            // 핸드셰이크 중인 연결은 핸들러가 아직 없다. 다시 기동한 서버의 계수 밖에 남지 않게 함께 닫는다(#181).
            this._pendingTlsSockets?.forEach((_bucket, raw) => raw.destroy());
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

export {TCPServer, OnServerEvent, OnSocketEvent, ServerOption, AdmitVerdict}
