import net, {Socket} from "net";
import SocketState from "./SocketState";
import ConnectOpt from "./ConnectOpt";
import * as tls from "tls";
import Path from "path";

import Dequeue from "./Dequeue";
import Errors from "./Errors";
import {FileCache} from "./FileCache";
import {QueueLimiterRegistry} from "./QueueLimiter";
import {computeWatermarkBytes, ResourcePolicyRegistry} from "./ResourcePolicy";
import {TlsOptionsFactoryRegistry} from "./TlsOptionsFactory";

import LoggerFactory  from "../util/logger/LoggerFactory";
const logger = LoggerFactory.getLogger('socket', 'SocketHandler');
/**
 * 리스너를 모두 지운 뒤에도 Node 는 진행 중이던 쓰기의 오류를 'error' 로 늦게 내보낼 수 있다.
 * 리스너가 없으면 처리되지 않은 예외로 프로세스가 끝나므로, 닫은 소켓에는 이것만 남긴다(#260).
 */
const IGNORE_LATE_SOCKET_ERROR = () => {};
/** FIN 을 보내거나 받은 뒤 상대가 닫기를 기다리는 시간의 기본값(#248). 데이터는 이미 커널에 있다. */
const DEFAULT_CLOSE_GRACE_MS = 10_000;
/**
 * 닫기 전 남은 출력이 진행 없이 멈춰 있을 수 있는 시간의 기본값(#248).
 * Linux 는 커널 송신 버퍼가 크게(약 1/3, 수 MiB) 비워질 때만 쓰기 완료를 알리므로, 느린 수신자도 끝까지 받도록 넉넉히 둔다.
 * 한계: 보장되는 최소 수신 속도는 약 (송신 버퍼의 1/3) / 이 값이다. Linux 루프백·LAN 에서 60초면 약 25KiB/s 다.
 */
const DEFAULT_CLOSE_STALL_MS = 60_000;
/**
 * 한 번에 소켓에 넘기는 최대 바이트(#248). 큰 버퍼 하나를 통째로 넘기면 다 보낼 때까지 쓰기 완료가 없어
 * 닫는 중에 진행을 볼 수 없다(TLS 는 쓰기 대기량도 줄지 않는다). 조각으로 나누면 조각마다 완료가 생긴다.
 */
const MAX_WRITE_PIECE_BYTES = 64 * 1024;
interface OnSocketEvent {
    (handler: SocketHandler, state: SocketState, data?: any) : void;
}

interface OnDrainEvent {
    (handler: SocketHandler, success: boolean) : void;
}

type FileCacheRecordID = number;
const EMPTY_BUFFER = Buffer.alloc(0);

type WaitItem = {
    buffer: Buffer;
    length: number;
    cacheID : FileCacheRecordID;
    onWriteComplete : OnWriteComplete | undefined;
    /** 끝날 때 메모리 계산에서 뺄 바이트. 없으면 length. 큰 버퍼의 조각은 원래 버퍼를 함께 쓰므로 마지막 조각이 전체를 뺀다(#248). */
    memoryBytes?: number;
}

// noinspection JSUnusedGlobalSymbols
class SocketHandler {

    private static LAST_ID: number = 0;

    private static MaxGlobalMemoryBufferSize: number = 1024 * 1024 * 128; // 128MB
    private static GlobalMemoryBufferSize: number = 0;
    private static GlobalFileCacheSize: number = 0;

    private static FileCacheDirPath : string = Path.join(process.cwd(),"cache");


    private readonly _port: number;
    private readonly _addr: string;
    private readonly _tls : boolean;

    private readonly _id: number = ++SocketHandler.LAST_ID;
    private _socket: net.Socket
    private _state: SocketState = SocketState.None;
    private _bundle: Map<string, any> = new Map<string, any>();
    private _isServer : boolean = false;
    private _fileCache : FileCache | null = null;
    private _waitQueue: Dequeue<WaitItem> = new Dequeue<WaitItem>();
    private _drainEventList : Array<OnDrainEvent> = [];
    /** #254: connect() 의 연결 기한 타이머. 연결이 끝나거나 실패하면 지운다. */
    private _connectTimer : NodeJS.Timeout | undefined;

    private _breakBufferFlush : boolean = false;

    private _sendLength: number = 0;
    private _receiveLength: number = 0;

    private _endWaitingState = false;
    /**
     * 닫기 기한(#248). 'drain' 은 남은 출력을 보내는 단계(closeStallMs, 진행하면 다시 잰다),
     * 'fin' 은 FIN 을 보냈거나 받아 상대가 닫기를 기다리는 단계(closeGraceMs)다.
     */
    private _closeTimer: NodeJS.Timeout | undefined;
    private _closePhase: 'drain' | 'fin' | undefined;

    private _event: OnSocketEvent;
    private _onOwnerTerminal?: (handler: SocketHandler) => void;


    private _memoryBufferSize: number = 0;
    private _memBufferSizeLimit: number = -1;
    private _fileCacheBufferSize: number = 0;
    private _waitQueueBytes: number = 0;
    private _inFlightWriteCount: number = 0;
    private _isFullNativeBuffer : boolean = false;
    private _inRunWriteBuffer : boolean = false;
    private _pressureReliefEventList : Array<(handler: SocketHandler) => void> = [];
    private _timeoutHandler?: () => void;


    public get isServer() : boolean {
        return this._isServer;
    }


    public get socket() : net.Socket {
        return this._socket;
    }

    /** FIN 을 보내거나 받은 뒤 상대가 닫지 않으면 강제로 닫기까지의 시간(ms)(#248). 테스트에서 줄일 수 있다. */
    public static closeGraceMs: number = DEFAULT_CLOSE_GRACE_MS;
    /** 닫기를 시작했는데 남은 출력이 진행 없이 멈춰 있으면 강제로 닫기까지의 시간(ms)(#248). 테스트에서 줄일 수 있다. */
    public static closeStallMs: number = DEFAULT_CLOSE_STALL_MS;

    public static set fileCacheDirPath(path: string) {
        this.FileCacheDirPath = path;
    }

    public set onSocketEvent(event: OnSocketEvent) {
        this._event = event;
    }

    public get breakBufferFlush() : boolean {
        return this._breakBufferFlush;
    }

    public get sendLength() : number {
        return this._sendLength;
    }

    public get receiveLength() : number {
        return this._receiveLength;
    }


    public static get globalMemoryBufferSize() : number {
        return SocketHandler.GlobalMemoryBufferSize;
    }

    public static get maxGlobalMemoryBufferSize() : number {
        return SocketHandler.MaxGlobalMemoryBufferSize;
    }

    public static get globalFileCacheSize(): number {
        return SocketHandler.GlobalFileCacheSize;
    }

    public static set GlobalMemCacheLimit(limit: number) {
        SocketHandler.MaxGlobalMemoryBufferSize = limit;
        logger.info(`set GlobalMemCacheLimit(${limit / 1024 / 1024}MiB)`);
    }

    public setBufferSizeLimit(size: number) : void {
        this._memBufferSizeLimit = size;
    }

    public get bufferSizeLimit(): number {
        return this._memBufferSizeLimit;
    }

    public get pendingWriteBytes(): number {
        return this._waitQueueBytes;
    }

    public get pendingFileCacheBytes(): number {
        return this._fileCacheBufferSize;
    }

    public get isBackpressured(): boolean {
        const limit = this.resolveBackpressureLimitBytes();
        if(limit <= 0) {
            return false;
        }
        return this._waitQueueBytes >= computeWatermarkBytes(limit).high;
    }

    public get isOutputDrained(): boolean {
        return this._waitQueue.isEmpty() && this._waitQueueBytes <= 0 && this._inFlightWriteCount === 0 && this._fileCacheBufferSize <= 0;
    }

    /**
     * 버퍼가 비워졌을 때 한 번만 호출되는 이벤트 리스너를 등록한다.
     * 만약 버퍼가 비어있는 상태라면 즉시 호출된다.
     * @param event
     */
    public addOnceDrainListener(event: OnDrainEvent) : void {
        if(this.isOutputDrained || this.isEnd()) {
            event(this, true);
            return;
        }
        this._drainEventList.push(event);
    }

    public addOncePressureReliefListener(event: (handler: SocketHandler) => void): void {
        if(!this.isBackpressured || this.isEnd()) {
            event(this);
            return;
        }
        this._pressureReliefEventList.push(event);
    }

    /**
     * 읽기를 멈춘 주체(사유). 출력 배압·하류 배압·대역폭 제한이 같은 소켓을 멈추므로, 모든 사유가 풀려야 다시 읽는다.
     * 예전에는 한 주체의 resumeRead 가 다른 주체의 일시정지까지 풀어 대역폭 제한과 배압이 무력화됐다(#169).
     */
    private readonly _pauseReasons = new Set<string>();

    public pauseRead(reason: string = 'external'): void {
        if(this.isEnd()) {
            return;
        }
        this._pauseReasons.add(reason);
        try {
            this._socket.pause();
        } catch {}
    }

    public resumeRead(reason: string = 'external'): void {
        if(this.isEnd()) {
            return;
        }
        this._pauseReasons.delete(reason);
        if(this._pauseReasons.size > 0) return;
        try {
            this._socket.resume();
        } catch {}
    }

    /**
     * 소켓의 타임아웃을 설정합니다.
     * @param timeout 타임아웃 값(밀리초)
     */
    public setTimeout(timeout: number): void {
        if (this._socket && !this.isEnd()) {
            try {
                this._socket.setTimeout(timeout);
                if(this._timeoutHandler) {
                    this._socket.off('timeout', this._timeoutHandler);
                }
                this._timeoutHandler = () => {
                    logger.info(`Socket ${this._id} timed out after ${timeout}ms`);
                    this.end_();
                };
                this._socket.on('timeout', this._timeoutHandler);
            } catch (e) {
                logger.error(`Error setting socket timeout: ${e}`);
            }
        }
    }

    public clearTimeout(): void {
        if(!this._socket) {
            return;
        }
        try {
            this._socket.setTimeout(0);
            if(this._timeoutHandler) {
                this._socket.off('timeout', this._timeoutHandler);
            }
            this._timeoutHandler = undefined;
        } catch (e) {
            logger.error(`Error clearing socket timeout: ${e}`);
        }
    }


    private clearConnectTimer(): void {
        if(this._connectTimer) clearTimeout(this._connectTimer);
        this._connectTimer = undefined;
    }

    public static connect(options: ConnectOpt, event: OnSocketEvent) : SocketHandler {
        let handlerRef: Array<SocketHandler> = [];
        options.keepalive = options.keepalive ?? 60000;
        let connectTimer: NodeJS.Timeout | undefined;
        let established = false;
        let connected = () => {
            established = true;
            clearTimeout(connectTimer);
            handlerRef[0]?.clearConnectTimer();
            if(handlerRef.length > 0 && handlerRef[0]._state == SocketState.None) {
                handlerRef[0]._state = SocketState.Connected;
                event(handlerRef[0], SocketState.Connected);
            }
        }

        let socket : net.Socket;
        // noinspection PointlessBooleanExpressionJS
        if(options.tls && options.tls === true) {
            let option = TlsOptionsFactoryRegistry.current().createClientSocketOptions(options) as tls.ConnectionOptions;
            socket = tls.connect(option, connected);
        } else {
            let option = TlsOptionsFactoryRegistry.current().createClientSocketOptions(options) as net.NetConnectOpts;
            socket = net.connect(option, connected);
        }
        let handler = new SocketHandler(socket, options.port, options.host, options.tls ?? false, event);
        handlerRef.push(handler);
        if(options.connectTimeout && options.connectTimeout > 0) {
            // TLS 는 핸드셰이크가 끝나야 connected 가 불린다. 그 전에 기한이 지나면 연결 실패와 같은 경로로 닫는다.
            // 타이머는 unref 이고, 연결이 끝난 뒤나 이미 닫힌 소켓에서는 아무 일도 하지 않는다(release() 가 리스너를 지워
            // close 리스너로 해제되지 않을 수 있지만 해가 없다).
            const limit = options.connectTimeout;
            connectTimer = setTimeout(() => {
                if(established) return;
                socket.destroy(Object.assign(new Error(`connect timed out after ${limit}ms`), {code: 'ETIMEDOUT'}));
            }, limit);
            connectTimer.unref?.();
            // 연결이 실패하거나 닫히면 release()·destroy() 가 지운다(#254). 남으면 기한까지 핸들러를 붙잡는다.
            handler._connectTimer = connectTimer;
        }

        if(options.timeout && options.timeout > 0) {
            handler.setTimeout(options.timeout);
        }


        return handler;
    }

    public static bound(options: {socket: net.Socket, port: number, addr: string, tls: boolean, keepAlive: number }, event: OnSocketEvent, onOwnerTerminal?: (handler: SocketHandler) => void) : SocketHandler {
        options.socket.setNoDelay(true);
        if(options.keepAlive > 0) {
            options.socket.setKeepAlive(true, options.keepAlive);
        }
        let handler = new SocketHandler(options.socket, options.port, options.addr, options.tls, event, onOwnerTerminal);
        handler._state = SocketState.Connected;
        handler._isServer = true;

        return handler;
    }

    public get localAddr() : string {
        return this._socket.localAddress ?? '';
    }

    private constructor(socket: Socket, port: number, addr: string,  tls: boolean,event: OnSocketEvent, onOwnerTerminal?: (handler: SocketHandler) => void) {
        this._port = port;
        this._addr = addr;
        this._tls = tls;
        this._socket = socket;

        this._event = event;
        this._onOwnerTerminal = onOwnerTerminal;
        this.initSocket(socket);
    }


    public get remoteAddress() : string {
        return this._socket.remoteAddress ?? '';
    }

    public get remotePort() : number {
        return this._socket.remotePort ?? 0;
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

    public hasBundle(key: string) : boolean {
        return this._bundle.has(key);
    }


    public isEnd() : boolean {
        return this._state == SocketState.Closed || this._state == SocketState.End; /* || this._state == SocketState.Error; */
    }

    /** 종료를 요청했거나(end_()) 이미 끝난 연결. 이 상태에서는 더 보낼 수 없다(#260). */
    public get isEnding() : boolean {
        return this._endWaitingState || this.isEnd();
    }

    private notifyOwnerTerminal(): void {
        const callback = this._onOwnerTerminal;
        this._onOwnerTerminal = undefined;
        callback?.(this);
    }

    public isSecure() : boolean {
        return this._tls;
    }

    /** TLS 이고 상대가 낸 클라이언트 인증서가 서버의 ca 로 검증되었는지(mtls-strict, #159). */
    public isClientCertificateVerified() : boolean {
        return this._tls && (this._socket as unknown as {authorized?: boolean}).authorized === true;
    }

    public get state() : SocketState {
        return this._state;
    }

    public get id () : number {
        return this._id;
    }


    private initSocket(socket: net.Socket) : void {
        this._socket = socket;
        // TLS 클라이언트 소켓은 TCP 'connect' 가 핸드셰이크보다 먼저 온다. 그때 Connected 를 내면 엔드포인트 세션이
        // 핸드셰이크 전에 성공으로 알려지고, 핸드셰이크 실패·기한 초과가 FailOfOpenSession 이 되지 못한다(#179).
        // 서버 쪽 TLS 소켓은 bound() 로 이미 Connected 라 이 이벤트를 쓰지 않는다.
        socket.on(socket instanceof tls.TLSSocket ? 'secureConnect' : 'connect', ()=> {
            if(this._state != SocketState.Connected) {
                this._state = SocketState.Connected;
                this._event(this, SocketState.Connected);
            }

        });
        socket.on('error', (error)=> {
            console.error(error);
            this.procError(error)
        });
        socket.on('drain', ()=> {
            if(this._isFullNativeBuffer && this._inRunWriteBuffer) {
                this._isFullNativeBuffer = false;
                setImmediate(() => {
                    this.sendPopDataRecursive2(true);
                });
            }
        });
        socket.on('close', ()=> {
            this.callAllDrainEvent(this.isOutputDrained);
            if(this._state != SocketState.Closed /* && this._state != SocketState.Error*/) {
                this._breakBufferFlush = !this._waitQueue.isEmpty();
                this._state = SocketState.Closed;
                this.notifyOwnerTerminal();
                this._event(this, SocketState.Closed);
            }
            this.release();
        });
        socket.on('data',(data) => {
            this._receiveLength += data.length;
            if(!this.isEnd()) {
                try {
                    this._event(this, SocketState.Receive, data);
                } catch (e) {
                    this.procError(e as Error);
                }
            }
        });
        socket.on('end', ()=> {
            if(!this.isEnd()) {
                this._state = SocketState.End;
                this._breakBufferFlush = !this._waitQueue.isEmpty();
                this.notifyOwnerTerminal();
                this._event(this, SocketState.End);
                //23.10.19 수정
                this.clearWaitQueue();
                // 상대가 먼저 FIN 을 보냈다. 남은 쓰기가 비워지지 않으면 'close' 가 오지 않으므로 기한을 건다(#248).
                // 아직 끝나지 않은 쓰기가 있으면 그 쓰기가 나갈 시간을 정체 기한으로 준다.
                if(!this._socket.destroyed) {
                    if(this._inFlightWriteCount > 0) this.armDrainDeadline(); else this.armFinDeadline();
                }
            }

        });
    }

    private procError(error: Error, logging? : boolean) : void {
        if(logging !== false) {
            logger.error(`procError() - ${error.message}`);
            logger.error(Errors.toString(error));
        }
        this._breakBufferFlush = !this._waitQueue.isEmpty();
        this.callAllDrainEvent(this.isOutputDrained);
        if(this._state != SocketState.Closed) {
            this._state = SocketState.Closed;
            this.notifyOwnerTerminal();
            this._event(this, SocketState.Closed, error);
        }
        this.release(error);
    }

    private release(error?: Error) : void {
        this.clearConnectTimer();
        this.clearWaitQueue(error);
        this.clearTimeout();
        this.clearCloseTimer();
        this._socket.removeAllListeners();
        this._socket.on('error', IGNORE_LATE_SOCKET_ERROR);
        this._state = SocketState.Closed;
        this._socket.destroy();
        this._event = ()=>{};
        this._bundle.clear();
        this._waitQueue.clear();
        this._fileCache?.deleteSync();
        this.resetFileCacheUsage();
        this._waitQueueBytes = 0;
        this._inFlightWriteCount = 0;
        this.resetBufferSize();
    }

    private resetBufferSize() : void {
        SocketHandler.GlobalMemoryBufferSize -= this._memoryBufferSize;
        this._memoryBufferSize = 0;
        if (SocketHandler.GlobalMemoryBufferSize < 0) {
            SocketHandler.GlobalMemoryBufferSize = 0;
        }
    }

    private resetFileCacheUsage(): void {
        SocketHandler.GlobalFileCacheSize -= this._fileCacheBufferSize;
        this._fileCacheBufferSize = 0;
        if(SocketHandler.GlobalFileCacheSize < 0) {
            SocketHandler.GlobalFileCacheSize = 0;
        }
    }

    public get port() {
        return this._port;
    }

    public get addr() {
        return this._addr;
    }

    public get tls() {
        return this._tls;
    }



    public end_() : void {
        if(this._endWaitingState || this.isEnd()) {
            return;
        }
        // 종료를 요청했음을 출력이 비어 있어도 표시한다. 이 뒤의 sendData 는 소켓에 쓰지 않고 실패한다.
        // 표시하지 않으면 end() 뒤의 쓰기가 ERR_STREAM_WRITE_AFTER_END 로 실패한다(#260).
        const drained = this.isOutputDrained;
        this._endWaitingState = true;
        if(drained) {
            this.endSocket();
        } else {
            this.armDrainDeadline();
        }
    }

    /** FIN 을 보내고 상대가 닫기를 기다리는 단계로 넘어간다(#248). */
    private endSocket(): void {
        this._socket.end();
        this.armFinDeadline();
    }

    /**
     * #248 — 닫기를 시작했는데 남은 출력이 멈춰 있으면(상대가 읽지 않음) 연결과 세션 전체가 끝없이 남는다.
     * 진행 없이 closeStallMs 가 지나면 강제로 닫는다. 쓰기(최대 MAX_WRITE_PIECE_BYTES 조각)가 끝날 때마다 다시 잰다.
     */
    private armDrainDeadline(): void {
        this._closePhase = 'drain';
        this.armCloseTimer(SocketHandler.closeStallMs, () => this.forceClose(`remaining output made no progress for ${SocketHandler.closeStallMs}ms`));
    }

    /**
     * #248 — FIN 을 보냈거나 받았는데 상대가 닫지 않으면 연결과 세션 전체가 끝없이 남는다.
     * 이 단계의 데이터는 이미 커널에 있으므로 closeGraceMs 뒤 강제로 닫아도 잃는 것이 없다.
     */
    private armFinDeadline(): void {
        if(this._closePhase === 'fin') return;
        this._closePhase = 'fin';
        this.armCloseTimer(SocketHandler.closeGraceMs, () => this.forceClose(`the peer did not close within ${SocketHandler.closeGraceMs}ms`));
    }

    /** drain 단계에서 쓰기가 끝났다. 기한을 다시 잰다. 상대가 먼저 닫았고 마지막 쓰기가 끝났으면 FIN 대기로 넘어간다. */
    private noteCloseProgress(): void {
        if(this._closePhase !== 'drain' || !this._closeTimer) return;
        if(this.isEnd() && this._inFlightWriteCount === 0) {
            this.armFinDeadline();
            return;
        }
        this._closeTimer.refresh();
    }

    private armCloseTimer(ms: number, onExpire: () => void): void {
        this.clearCloseTimer();
        this._closeTimer = setTimeout(() => {
            this._closeTimer = undefined;
            if(this._state == SocketState.Closed) return;
            onExpire();
        }, Math.max(1, ms));
        this._closeTimer.unref?.();
    }

    private clearCloseTimer(): void {
        if(this._closeTimer) clearTimeout(this._closeTimer);
        this._closeTimer = undefined;
    }

    /**
     * 강제 종료는 destroy() 의 종료 경로(Closed 이벤트)를 따르므로 세션 맵·캐시 파일이 평소처럼 정리된다.
     * 한계: 받은 데이터를 읽지 않은 채 닫으면 Linux 는 RST 를 보내 커널에 남은 송신 데이터도 버린다.
     */
    private forceClose(reason: string): void {
        logger.info(`Socket ${this._id} closed by force: ${reason}`);
        this.destroy();
    }

    public endImmediate() : void {
        if(this.isEnd()) {
            return;
        }
        this.endSocket();
        this._state = SocketState.End;
        this.notifyOwnerTerminal();
        this._event?.(this, SocketState.End);
        this.clearWaitQueue();
    }


    public destroy() : void {
        if(this._state == SocketState.Closed /*|| this._state == SocketState.Error*/) {
            return;
        }
        this.clearConnectTimer();
        this.clearTimeout();
        this.clearCloseTimer();
        this.callAllDrainEvent(this.isOutputDrained);
        this._socket.removeAllListeners();
        this._socket.on('error', IGNORE_LATE_SOCKET_ERROR);
        this._socket.destroy();


        this._state = SocketState.Closed;
        this.notifyOwnerTerminal();
        this._event(this, SocketState.Closed);

        this._event = ()=>{};
        this._bundle.clear();
        this.clearWaitQueue();
        this._fileCache?.deleteSync();
        this.resetFileCacheUsage();
        this._waitQueueBytes = 0;
        this._inFlightWriteCount = 0;
        this.resetBufferSize();
    }


    private static isOverGlobalMemoryBufferSize(size: number) : boolean {
        return SocketHandler.GlobalMemoryBufferSize + size > SocketHandler.MaxGlobalMemoryBufferSize;
    }

    private isOverMemoryBufferSize(size: number) : boolean {
        if(this._memBufferSizeLimit < 0) {
            return false;
        }
        return (this._memoryBufferSize + size > this._memBufferSizeLimit);
    }


    public sendData(data: Buffer,onWriteComplete? : OnWriteComplete ) : void {
        //23.10.19 수정 - 종료 대기 상태면 데이터를 버린다.
        if(this.isEnd() || this._endWaitingState) {
            onWriteComplete?.(this, false);
            return;
        }

        if(data.length === 0) {
            onWriteComplete?.(this, true);
            return;
        }

        // 메모리·파일 캐시 경로와 파일 캐시 예산은 버퍼 전체로 한 번 정한다. 조각마다 정하면 버퍼 하나가 두 곳으로 갈라져
        // 메모리 조각(subarray)이 원래 버퍼 전체를 RAM 에 붙잡는데 계산은 일부만 센다(#248).
        const spill = QueueLimiterRegistry.current().shouldSpillToFile({
            incomingSize: data.length,
            localBufferedBytes: this._memoryBufferSize,
            localBufferedLimit: this._memBufferSizeLimit,
            globalBufferedBytes: SocketHandler.GlobalMemoryBufferSize,
            globalBufferedLimit: SocketHandler.MaxGlobalMemoryBufferSize
        });
        if(spill) {
            if(!this._fileCache) {
                this._fileCache = FileCache.create(SocketHandler.FileCacheDirPath);
            }
            if(!this.canWriteToFileCache(data.length)) {
                logger.warn(`Socket ${this._id} exceeded file cache budget. Closing connection.`);
                onWriteComplete?.(this, false, new Error("File cache quota exceeded"));
                this.destroy();
                return;
            }
        }

        // 큰 버퍼는 복사 없이 MAX_WRITE_PIECE_BYTES 조각으로 나눠 넣는다. 조각마다 쓰기 완료가 생겨 닫는 중에도 진행을 본다(#248).
        // 완료 콜백은 마지막 조각에만 단다. 넣다가 실패하면 그 오류로 한 번 알리고 닫는다
        // (뒤에 소켓 오류가 나면 clearWaitQueue 가 마지막 조각의 콜백에 그 오류를 넘긴다).
        // 메모리 경로의 조각(subarray)은 원래 버퍼를 함께 쓰므로 마지막 조각이 끝날 때까지 버퍼 전체가 RAM 에 있다.
        // 그래서 메모리 계산은 버퍼 전체를 한 번 더하고, 마지막 조각이 끝날 때 한 번에 뺀다.
        if(!spill) this.appendUsageMemoryBufferSize(data.length);
        for(let offset = 0; offset < data.length; offset += MAX_WRITE_PIECE_BYTES) {
            const last = offset + MAX_WRITE_PIECE_BYTES >= data.length;
            const piece = data.length <= MAX_WRITE_PIECE_BYTES ? data : data.subarray(offset, offset + MAX_WRITE_PIECE_BYTES);
            const error = this.enqueuePiece(piece, last ? onWriteComplete : undefined, spill, last ? data.length : 0);
            if(error) {
                onWriteComplete?.(this, false, error);
                this.destroy();
                return;
            }
        }

        this.sendPopDataRecursive2();

    }

    /**
     * 조각 하나를 대기 큐에 넣는다. 파일 캐시에 쓰지 못하면 그 오류를 돌려준다(콜백은 부르지 않는다).
     * @param memoryBytes 메모리 경로에서 이 조각이 끝날 때 메모리 계산에서 뺄 바이트(더하기는 sendData 가 버퍼 전체로 한 번 한다)
     */
    private enqueuePiece(piece: Buffer, onWriteComplete: OnWriteComplete | undefined, spill: boolean, memoryBytes: number): Error | undefined {
        if(!spill) {
            this._waitQueueBytes += piece.length;
            this._waitQueue.pushBack({buffer: piece, length: piece.length, cacheID: -1, onWriteComplete: onWriteComplete, memoryBytes});
            return undefined;
        }
        try {
            let record = this._fileCache!.writeSync(piece);
            if(record.id < 0) {
                throw new Error("File cache write failed");
            }
            this.appendFileCacheUsage(piece.length);
            this._waitQueueBytes += piece.length;
            this._waitQueue.pushBack({buffer: EMPTY_BUFFER, length: piece.length, cacheID: record.id, onWriteComplete: onWriteComplete});
            return undefined;
        } catch (error) {
            logger.error(`Failed to spill socket ${this._id} buffer to file cache`, error);
            return error as Error;
        }
    }

    private callAllDrainEvent(success: boolean) : void {
        while (this._drainEventList.length > 0) {
            let event = this._drainEventList.shift()
            if(event) {
                event(this,success);
            }
        }
    }

    /**
     * #254: 이 핸들러를 다른 핸들러로 바꿔 닫기 전에, 배압 해제를 기다리던 쪽을 깨운다.
     * destroy() 는 이 리스너를 부르지 않으므로, 그대로 닫으면 기다리던 쪽(끝점 읽기)이 세션이 끝날 때까지 멈춘다.
     */
    public releasePressureReliefListeners(): void {
        this.callPressureReliefEvent();
    }

    private callPressureReliefEvent(): void {
        while(this._pressureReliefEventList.length > 0) {
            const event = this._pressureReliefEventList.shift();
            if(event) {
                event(this);
            }
        }
    }


    private sendPopDataRecursive2(force: boolean = false) : void {
        if(this._inRunWriteBuffer && !force) {
            return;
        }
        this._inRunWriteBuffer = true;
        let waitItem = undefined;
        do {
            try {
                waitItem = this.popBufferSync();
            } catch (error) {
                this._inRunWriteBuffer = false;
                this.procError(error as Error);
                return;
            }
            if(!waitItem) {
                this._inRunWriteBuffer = false;
                // 종료 대기 상태고, 버퍼 큐가 비어있으면 소켓을 종료한다.
                if(this._endWaitingState && this._inFlightWriteCount === 0) {
                    this.endSocket();
                }
                this.maybeNotifyDrainOrPressureRelief();
                return;
            }
            if(this.isEnd()) {
                this.failWaitItem(waitItem);
                return;
            }
            let length = waitItem.length;
            if(length == 0) {
                this.procError(new Error(" sendPopDataRecursive() - buffer length is zero."));
                return;
            }
            let onWriteComplete = waitItem.onWriteComplete;
            const currentWaitItem = waitItem;
            this._inFlightWriteCount++;
            this.writeBuffer(waitItem.buffer, (client, success, err) => {
                this._inFlightWriteCount = Math.max(0, this._inFlightWriteCount - 1);
                onWriteComplete?.(client, success, err);
                if(!success) {
                    this.completeWaitItem(currentWaitItem, currentWaitItem.cacheID == -1);
                    this._inRunWriteBuffer = false;
                    this.maybeNotifyDrainOrPressureRelief();
                    return;
                }
                this._sendLength += length;
                // 닫는 중에도 출력이 나가고 있으면 기한을 다시 잰다(#248).
                this.noteCloseProgress();
                this.completeWaitItem(currentWaitItem, currentWaitItem.cacheID == -1);
                this.maybeNotifyDrainOrPressureRelief();
            });
        } while (waitItem && !this._isFullNativeBuffer)
    }


    private clearWaitQueue(error?: Error) : void {
        let waitItem = this._waitQueue.popFront()
        while(waitItem) {
            this.completeWaitItem(waitItem, waitItem.cacheID == -1);
            waitItem.onWriteComplete?.(this, false, error);
            waitItem = this._waitQueue.popFront();
        }
        this._waitQueue.clear();
        this.maybeNotifyDrainOrPressureRelief();
    }

    public isConnected() : boolean {
        return this._state == SocketState.Connected;
    }


    private  writeBuffer(buffer: Buffer,onWriteComplete?: OnWriteComplete)  {


        if(this.isEnd()) {
            onWriteComplete?.(this, false);
            return;
        }
            try {
                this._isFullNativeBuffer = !this._socket.write(buffer, (error) => {
                    if (error) {
                        if (this.isEnd()) {
                            onWriteComplete?.(this, false);
                            return;
                        }
                        logger.warn(`writeBuffer() - socket.write() error(${error.message})`, error);
                        this.procError(error, false);
                        onWriteComplete?.(this, false, error);
                        return;
                    }
                    onWriteComplete?.(this, true);
                });
            } catch(e) {
                logger.warn(`writeBuffer() - socket.write() error(${e})`);
                onWriteComplete?.(this, false);
                this.procError(e as Error, false);
            }



    }


    private appendUsageMemoryBufferSize(size: number) : void {
        // 빼는 양은 이 핸들러가 가진 만큼까지만 전역에 반영한다. destroy() 가 이미 전부 뺀 뒤 늦게 끝난 쓰기가
        // 다시 빼면 다른 핸들러의 몫까지 줄어 전역 상한이 느슨해진다(#248 의 강제 종료로 이 순서가 흔해졌다).
        const delta = size < 0 ? Math.max(size, -this._memoryBufferSize) : size;
        this._memoryBufferSize += delta;
        SocketHandler.GlobalMemoryBufferSize += delta;
        if(SocketHandler.GlobalMemoryBufferSize < 0) {
            SocketHandler.GlobalMemoryBufferSize = 0;
        }
        else if(SocketHandler.GlobalMemoryBufferSize > SocketHandler.MaxGlobalMemoryBufferSize) {
            SocketHandler.GlobalMemoryBufferSize = SocketHandler.MaxGlobalMemoryBufferSize;
        }
    }

    private appendFileCacheUsage(size: number): void {
        this._fileCacheBufferSize += size;
        if(this._fileCacheBufferSize < 0) {
            this._fileCacheBufferSize = 0;
        }
        SocketHandler.GlobalFileCacheSize += size;
        if(SocketHandler.GlobalFileCacheSize < 0) {
            SocketHandler.GlobalFileCacheSize = 0;
        }
    }



    private popBufferSync() : WaitItem | undefined {
        // Failed cached reads stay queued for failure callbacks and drain accounting.
        let waitItem = this._waitQueue.front();
        if(!waitItem) {
            return undefined;
        }
        if(waitItem.cacheID != -1) {
            let buffer = this._fileCache?.readSync(waitItem.cacheID);
            if(!buffer || buffer.length !== waitItem.length) {
                throw new Error(`File cache read failed for record ${waitItem.cacheID}`);
            }
            this._fileCache!.remove(waitItem.cacheID);
            this.appendFileCacheUsage(-waitItem.length);
            waitItem.buffer = buffer;
        }
        this._waitQueue.popFront();
        return waitItem;
    }

    private completeWaitItem(waitItem: WaitItem, releaseMemoryBuffer: boolean): void {
        this._waitQueueBytes -= waitItem.length;
        if(this._waitQueueBytes < 0) {
            this._waitQueueBytes = 0;
        }
        if(waitItem.cacheID != -1 && this._fileCache && waitItem.buffer === EMPTY_BUFFER) {
            this._fileCache.remove(waitItem.cacheID);
            this.appendFileCacheUsage(-waitItem.length);
        }
        if(releaseMemoryBuffer) {
            this.appendUsageMemoryBufferSize(-(waitItem.memoryBytes ?? waitItem.length));
        }
    }

    private failWaitItem(waitItem: WaitItem): void {
        this.completeWaitItem(waitItem, waitItem.cacheID == -1);
        waitItem.onWriteComplete?.(this, false);
    }

    private maybeNotifyDrainOrPressureRelief(): void {
        if(!this.isBackpressured) {
            this.callPressureReliefEvent();
        }
        if(this.isOutputDrained) {
            if(this._endWaitingState && !this.isEnd()) {
                this.endSocket();
            }
            this.callAllDrainEvent(true);
        }
    }

    private resolveBackpressureLimitBytes(): number {
        if(this._memBufferSizeLimit <= 0) {
            return -1;
        }
        return this._memBufferSizeLimit;
    }

    private effectiveFileCacheLimitBytes(): number {
        const policy = ResourcePolicyRegistry.current();
        if(this._memBufferSizeLimit > 0) {
            return Math.max(policy.fileCachePerHandlerLimitBytes, this._memBufferSizeLimit * 4);
        }
        return policy.fileCachePerHandlerLimitBytes;
    }

    private canWriteToFileCache(size: number): boolean {
        const policy = ResourcePolicyRegistry.current();
        const nextLocal = this._fileCacheBufferSize + size;
        const nextGlobal = SocketHandler.GlobalFileCacheSize + size;
        return nextLocal <= this.effectiveFileCacheLimitBytes() && nextGlobal <= policy.fileCacheGlobalLimitBytes;
    }





}



interface OnWriteComplete {
    (client: SocketHandler, success: boolean, err? : Error) : void;
}



export {SocketHandler, OnWriteComplete, OnDrainEvent, OnSocketEvent};
