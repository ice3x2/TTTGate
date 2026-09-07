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
const logger = LoggerFactory.getLogger('', 'SocketHandler');
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

    private _breakBufferFlush : boolean = false;

    private _sendLength: number = 0;
    private _receiveLength: number = 0;

    private _endWaitingState = false;

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

    public pauseRead(): void {
        if(this.isEnd()) {
            return;
        }
        try {
            this._socket.pause();
        } catch {}
    }

    public resumeRead(): void {
        if(this.isEnd()) {
            return;
        }
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


    public static connect(options: ConnectOpt, event: OnSocketEvent) : SocketHandler {
        let handlerRef: Array<SocketHandler> = [];
        options.keepalive = options.keepalive ?? 60000;
        let connected = () => {
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

    private notifyOwnerTerminal(): void {
        const callback = this._onOwnerTerminal;
        this._onOwnerTerminal = undefined;
        callback?.(this);
    }

    public isSecure() : boolean {
        return this._tls;
    }

    public get state() : SocketState {
        return this._state;
    }

    public get id () : number {
        return this._id;
    }


    private initSocket(socket: net.Socket) : void {
        this._socket = socket;
        socket.on('connect', ()=> {
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
        this.clearWaitQueue(error);
        this.clearTimeout();
        this._socket.removeAllListeners();
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
        if(!this.isOutputDrained) {
            this._endWaitingState = true;
            return;
        }
        this._socket.end();
    }

    public endImmediate() : void {
        if(this.isEnd()) {
            return;
        }
        this._socket.end();
        this._state = SocketState.End;
        this.notifyOwnerTerminal();
        this._event?.(this, SocketState.End);
        this.clearWaitQueue();
    }


    public destroy() : void {
        if(this._state == SocketState.Closed /*|| this._state == SocketState.Error*/) {
            return;
        }
        this.clearTimeout();
        this.callAllDrainEvent(this.isOutputDrained);
        this._socket.removeAllListeners();
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

        if(QueueLimiterRegistry.current().shouldSpillToFile({
            incomingSize: data.length,
            localBufferedBytes: this._memoryBufferSize,
            localBufferedLimit: this._memBufferSizeLimit,
            globalBufferedBytes: SocketHandler.GlobalMemoryBufferSize,
            globalBufferedLimit: SocketHandler.MaxGlobalMemoryBufferSize
        })) {
            if(!this._fileCache) {
                this._fileCache = FileCache.create(SocketHandler.FileCacheDirPath);
            }
            if(!this.canWriteToFileCache(data.length)) {
                logger.warn(`Socket ${this._id} exceeded file cache budget. Closing connection.`);
                onWriteComplete?.(this, false, new Error("File cache quota exceeded"));
                this.destroy();
                return;
            }
            try {
                let record = this._fileCache.writeSync(data);
                if(record.id < 0) {
                    throw new Error("File cache write failed");
                }
                this.appendFileCacheUsage(data.length);
                this._waitQueueBytes += data.length;
                this._waitQueue.pushBack({buffer: EMPTY_BUFFER, length: data.length, cacheID: record.id, onWriteComplete: onWriteComplete});
            } catch (error) {
                logger.error(`Failed to spill socket ${this._id} buffer to file cache`, error);
                onWriteComplete?.(this, false, error as Error);
                this.destroy();
                return;
            }
        } else  {
            this.appendUsageMemoryBufferSize(data.length);
            this._waitQueueBytes += data.length;
            this._waitQueue.pushBack({buffer: data, length: data.length, cacheID: -1, onWriteComplete: onWriteComplete});
        }

        this.updateInputPressure();

        this.sendPopDataRecursive2();

    }

    private callAllDrainEvent(success: boolean) : void {
        while (this._drainEventList.length > 0) {
            let event = this._drainEventList.shift()
            if(event) {
                event(this,success);
            }
        }
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
                    this._socket.end();
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
        this._memoryBufferSize += size;
        if(this._memoryBufferSize < 0) {
            this._memoryBufferSize = 0;
        }
        SocketHandler.GlobalMemoryBufferSize += size;
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
            this.appendUsageMemoryBufferSize(-waitItem.length);
        }
    }

    private failWaitItem(waitItem: WaitItem): void {
        this.completeWaitItem(waitItem, waitItem.cacheID == -1);
        waitItem.onWriteComplete?.(this, false);
    }

    private maybeNotifyDrainOrPressureRelief(): void {
        this.updateInputPressure();
        if(!this.isBackpressured) {
            this.callPressureReliefEvent();
        }
        if(this.isOutputDrained) {
            if(this._endWaitingState && !this.isEnd()) {
                this._socket.end();
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

    private updateInputPressure(): void {
        if(this.isBackpressured) {
            this.pauseRead();
        } else if(this.resolveBackpressureLimitBytes() > 0) {
            const {low} = computeWatermarkBytes(this.resolveBackpressureLimitBytes());
            if(this._waitQueueBytes <= low) {
                this.resumeRead();
            }
        }
    }




}



interface OnWriteComplete {
    (client: SocketHandler, success: boolean, err? : Error) : void;
}



export {SocketHandler, OnWriteComplete, OnDrainEvent, OnSocketEvent};
