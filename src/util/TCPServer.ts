import net from "net";
import {SocketHandler} from "./SocketHandler";
import SocketState from "./SocketState";
import * as tls from "tls";
import LoggerFactory from "../util/logger/LoggerFactory";
import {TlsOptionsFactoryRegistry} from "./TlsOptionsFactory";

const logger = LoggerFactory.getLogger('socket', 'TCPServer');


const DEFAULT_KEEP_ALIVE : number = 10000;
/** 거절 응답을 보낸 소켓을 상대가 닫지 않아도 이 시간 뒤에는 닫는다(#245). */
const DEFAULT_REJECT_LINGER_MS : number = 5000;
/** 거절 응답을 보내고 닫히기를 기다리는 소켓 수의 상한. 넘으면 응답 없이 바로 닫는다(#245). */
const DEFAULT_MAX_REJECTED_SOCKETS : number = 256;
/**
 * 거절한 상대에게서 읽어서 버릴 최대 바이트(#245). 넘으면 읽기를 멈춰 TCP 흐름 제어로 상대를 막고, 연결은 기한에 닫는다.
 * 멈춘 뒤에도 Node 가 highWaterMark 만큼은 더 읽는다.
 * 바로 끊지 않는 까닭: 본문이 큰 정상 요청이 곧바로 RST 를 받지 않고, 기한까지 503 을 읽을 시간을 갖게 한다.
 */
const MAX_REJECTED_DISCARD_BYTES : number = 64 * 1024;

interface OnServerEvent {
    (server: TCPServer, state: SocketState, handler? : SocketHandler) : void;
}

interface OnSocketEvent {
    (handler: SocketHandler, state: SocketState, data?: any) : void;
}

// U5-02 / #117 — 수락 직후, 자원 할당 전 판정. AdmissionDecision과 구조적으로 호환되는 지역 타입
// (util/ 은 server/security를 import하지 않는다).
type AdmitVerdict = {allowed: true} | {allowed: false; reason: string; retryAfterMs?: number; rejectResponse?: Buffer};

/** 따로 묶어 세는 경고의 종류(#245). */
type ThrottledWarnKind = 'pending-tls' | 'rejected-sockets';

interface ServerOption {port: number, tls?: boolean, ca?: string, cert?: string, key?: string, keepAlive?: number, requestClientCert?: boolean, admit?: (remoteAddress: string | undefined) => AdmitVerdict,
    /**
     * TLS 서버에서 핸드셰이크(암호 연산) 전에 부르는 판정(#287). 거절이면 TLS 응답 없이 바로 닫고 핸드셰이크 대기 수에도 넣지 않는다.
     * 핸드셰이크 비용을 아끼려는 것이므로 값싼 판정만 넣는다. 나머지 판정은 핸드셰이크 뒤의 admit 이 한다.
     */
    admitBeforeHandshake?: (remoteAddress: string | undefined) => AdmitVerdict,
    /** TLS 핸드셰이크 기한(ms). 핸드셰이크가 끝나기 전 연결은 바인드되지 않아 미인증 기한 밖에 있으므로 따로 끊는다(#174). */
    handshakeTimeoutMs?: number,
    /** TLS 핸드셰이크 중인 연결 수의 상한. 넘는 새 TCP 연결은 바로 닫는다(#181). 미지정이면 상한 없음. */
    maxPendingTlsHandshakes?: number,
    /** 같은 주소 버킷이 핸드셰이크 중일 수 있는 연결 수. 주소 하나가 대기 슬롯을 다 차지하지 못하게 한다(#181). */
    maxPendingTlsHandshakesPerAddress?: number,
    /** 주소를 버킷으로 묶는 함수(예: IPv4 주소 하나, IPv6 /64). 없으면 주소 그대로 쓴다. */
    addressBucketOf?: (remoteAddress: string) => string,
    /** 거절 응답(예: 503)을 보낸 소켓을 닫기까지 기다리는 최대 시간(ms, 양수). 기본 5초(#245). */
    rejectLingerMs?: number,
    /** 거절 응답을 보내고 닫히기를 기다리는 소켓 수의 상한. 기본 256(#245). */
    maxRejectedSockets?: number};

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
    /** 거절 응답을 보내고 닫히기를 기다리는 소켓. 핸들러가 없으므로 stop() 이 따로 닫는다(#245). */
    private _rejectedSockets : Set<net.Socket> = new Set<net.Socket>();



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
     * 그 대응을 찾지 못해도 TCP 소켓의 close 에서 반드시 줄어든다. 돌려주는 함수를 새 TCP 연결마다 부른다.
     */
    private limitPendingTlsHandshakes(server: tls.Server, max: number): (raw: net.Socket) => void {
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
        server.on('secureConnection', (secure: tls.TLSSocket) => {
            const raw = (secure as unknown as {_parent?: net.Socket})._parent;
            if(raw) release(raw);
        });
        return (raw: net.Socket) => {
            const bucket = bucketOf(raw.remoteAddress ?? '');
            const fromBucket = perBucket.get(bucket) ?? 0;
            if(pending.size >= max || fromBucket >= maxPerBucket) {
                this.warnThrottled('pending-tls', `too many pending TLS handshakes on port ${this._options.port}${fromBucket >= maxPerBucket ? ` from ${bucket}` : ''}; closing new connections`);
                this._closedBeforeHandshake.add(raw);
                raw.destroy();
                return;
            }
            pending.set(raw, bucket);
            perBucket.set(bucket, fromBucket + 1);
            raw.once('close', () => release(raw));
        };
    }

    /**
     * TLS 서버의 새 TCP 연결을 핸드셰이크(암호 연산) 전에 다룬다. 먼저 admitBeforeHandshake 로 거절할 주소를 닫고(#287),
     * 남은 연결만 핸드셰이크 대기 수에 넣는다. 둘을 한 리스너에 두어 이 순서가 리스너 등록 순서에 기대지 않게 한다.
     * Node 의 tls.Server 는 자기 'connection' 리스너에서 TLS 소켓을 먼저 만들어 두므로, 거절한 연결도 tlsClientError 를 낸다.
     */
    private guardTlsConnections(server: tls.Server): void {
        const admitBeforeHandshake = this._options.admitBeforeHandshake;
        const max = this._options.maxPendingTlsHandshakes;
        const countPending = max !== undefined ? this.limitPendingTlsHandshakes(server, max) : undefined;
        if(!admitBeforeHandshake && !countPending) return;
        server.on('connection', (raw: net.Socket) => {
            if(admitBeforeHandshake && !admitBeforeHandshake(raw.remoteAddress).allowed) {
                this._closedBeforeHandshake.add(raw);
                raw.destroy();
                return;
            }
            countPending?.(raw);
        });
    }

    /**
     * 서버가 핸드셰이크 전에 닫은 TCP 소켓(판정 거절, 대기 상한 초과). 그 소켓이 내는 tlsClientError 는 로그에 남기지 않는다.
     * 거절이 몰릴 때 거절마다 로그가 쌓이지 않게 한다. 거절 자체는 warnThrottled 와 거절 집계가 알린다.
     */
    private readonly _closedBeforeHandshake = new WeakSet<net.Socket>();

    private _pendingTlsSockets: Map<net.Socket, string> | undefined;
    private _throttledWarns: Map<ThrottledWarnKind, {lastAt: number, suppressed: number}> = new Map();

    /**
     * 공격 중에는 거절이 초당 수십 번 난다. 약한 서버의 디스크·CPU 를 지키려고 종류마다 10초에 한 줄만 남긴다(#181).
     * 종류를 나눠 세므로 한 종류의 경고가 다른 종류를 가리지 않는다(#245).
     */
    private warnThrottled(kind: ThrottledWarnKind, message: string): void {
        const now = Date.now();
        const state = this._throttledWarns.get(kind) ?? {lastAt: 0, suppressed: 0};
        if(now - state.lastAt < 10_000) { state.suppressed++; this._throttledWarns.set(kind, state); return; }
        logger.warn(`TCPServer: ${message}${state.suppressed > 0 ? ` (${state.suppressed} more since the last warning)` : ''}`);
        this._throttledWarns.set(kind, {lastAt: now, suppressed: 0});
    }

    private createServer(): net.Server {
        const server = this._options.tls
            ? tls.createServer(this.serverTlsOptions(), this.onBind)
            : net.createServer(this.onBind);
        if(this._options.tls) {
            this.guardTlsConnections(server as tls.Server);
            // 핸드셰이크 기한이 지나도 Node 는 tlsClientError 만 내고 TCP 소켓을 그대로 둔다. 직접 닫아야 슬롯이 풀린다(#174).
            server.on('tlsClientError', (error, socket) => {
                const raw = (socket as unknown as {_parent?: net.Socket})._parent;
                if(!raw || !this._closedBeforeHandshake.has(raw)) logger.debug(`TCPServer: TLS client error: ${error.message}`);
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

    /**
     * 거절 응답을 쓰고 연결을 끝낸다. 이 소켓에는 핸들러가 없으므로 오류 처리와 닫기 기한을 여기서 건다(#245).
     * 오류 리스너가 없으면 상대의 RST 가 처리되지 않은 'error' 가 되어 프로세스가 끝나고,
     * 기한이 없으면 FIN 을 보내지 않는 상대가 동시 연결 한도 밖에서 소켓을 붙잡는다.
     */
    private endRejected(socket: net.Socket, response: Buffer) : void {
        // 이미 닫힌 소켓의 오류도 다음 틱에 올 수 있으므로 무엇보다 먼저 건다.
        socket.on('error', (error) => logger.debug(`TCPServer: rejected socket error: ${error.message}`));
        if(socket.destroyed) return;
        if(this._rejectedSockets.size >= (this._options.maxRejectedSockets ?? DEFAULT_MAX_REJECTED_SOCKETS)) {
            this.warnThrottled('rejected-sockets', `too many rejected connections waiting to close on port ${this._options.port}; closing new ones without a response`);
            socket.destroy();
            return;
        }
        this._rejectedSockets.add(socket);
        const linger = setTimeout(() => socket.destroy(), Math.max(1, this._options.rejectLingerMs ?? DEFAULT_REJECT_LINGER_MS));
        linger.unref?.();
        socket.once('close', () => {
            clearTimeout(linger);
            this._rejectedSockets.delete(socket);
        });
        // 아무도 읽지 않으면 남은 요청 바이트 때문에 'end' 가 미뤄져, 상대가 FIN 을 보내도 기한까지 닫히지 않는다.
        // 그래서 읽어서 버리되, 상한을 넘으면 읽기를 멈추고 기한에 맡긴다.
        let discarded = 0;
        const discard = (chunk: Buffer) => {
            discarded += chunk.length;
            if(discarded <= MAX_REJECTED_DISCARD_BYTES) return;
            socket.off('data', discard);
            socket.pause();
        };
        socket.on('data', discard);
        socket.end(response);
    }

    private onBind = (socket: net.Socket) : void => {
        if(this._options.admit) {
            const verdict = this._options.admit(socket.remoteAddress);
            if(!verdict.allowed) {
                if(verdict.rejectResponse) this.endRejected(socket, verdict.rejectResponse); else socket.destroy();
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
            this._rejectedSockets.forEach((socket) => socket.destroy());
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
