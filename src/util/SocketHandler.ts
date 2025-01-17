import net, {Socket} from "net";
import SocketState from "./SocketState";
import ConnectOpt from "./ConnectOpt";
import * as tls from "tls";
import Path from "path";

import Dequeue from "./Dequeue";
import Errors from "./Errors";
import {FileCache} from "./FileCache";

import LoggerFactory  from "../util/logger/LoggerFactory";
const logger = LoggerFactory.getLogger('', 'SocketHandler');


const MIN_KEEP_ALIVE : number = 500;

interface OnSocketEvent {
    (handler: SocketHandler,info: {address?: string, port?: number}, state: SocketState, data?: any) : void;
}

interface OnDrainEvent {
    (handler: SocketHandler, success: boolean) : void;
}

type FileCacheRecordID = number;
const EMPTY_BUFFER = Buffer.alloc(0);

type WaitItem = {
    buffer: Buffer;
    cacheID : FileCacheRecordID;
    onWriteComplete : OnWriteComplete | undefined;
}

// noinspection JSUnusedGlobalSymbols
class SocketHandler {

    private static LAST_ID: number = 0;

    private static MaxGlobalMemoryBufferSize: number = 1024 * 1024 * 128; // 128MB
    private static GlobalMemoryBufferSize: number = 0;

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


    private _memoryBufferSize: number = 0;
    private _memBufferSizeLimit: number = -1;
    private _isFullNativeBuffer : boolean = false;
    private _inRunWriteBuffer : boolean = false;


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

    public static set GlobalMemCacheLimit(limit: number) {
        SocketHandler.MaxGlobalMemoryBufferSize = limit;
        logger.info(`set GlobalMemCacheLimit(${limit / 1024 / 1024}MiB)`);
    }

    public setBufferSizeLimit(size: number) : void {
        this._memBufferSizeLimit = size;
    }

    /**
     * 버퍼가 비워졌을 때 한 번만 호출되는 이벤트 리스너를 등록한다.
     * 만약 버퍼가 비어있는 상태라면 즉시 호출된다.
     * @param event
     */
    public addOnceDrainListener(event: OnDrainEvent) : void {
        if(this._waitQueue.isEmpty() || this.isEnd()) {
            event(this, true);
            return;
        }
        this._drainEventList.push(event);
    }



    public static connect(options: ConnectOpt, event: OnSocketEvent) : SocketHandler {
        let handlerRef: Array<SocketHandler> = [];


        options.keepalive = options.keepalive ?? 60000;


        let connected = () => {
            if(handlerRef.length > 0 && handlerRef[0]._state == SocketState.None) {
                handlerRef[0]._state = SocketState.Connected;
                event(handlerRef[0],{address: options.host, port: options.port}, SocketState.Connected);
            }
        }

        let socket : net.Socket;
        // noinspection PointlessBooleanExpressionJS
        if(options.tls && options.tls === true) {
            let option = {port: options.port, host: options.host, allowHalfOpen: false ,keepAlive: options.keepalive > 0, keepAliveInitialDelay: Math.max(options.keepalive, MIN_KEEP_ALIVE) ,noDelay: true, rejectUnauthorized: false};
            socket = tls.connect(option, connected);
        } else {
            let option = {port: options.port, host: options.host, allowHalfOpen: false ,keepAlive: options.keepalive > 0, keepAliveInitialDelay: Math.max(options.keepalive, MIN_KEEP_ALIVE),noDelay: true, rejectUnauthorized: false};
            socket = net.connect(option, connected);
        }
        let handler = new SocketHandler(socket, options.port, options.host, options.tls ?? false, event);
        handlerRef.push(handler);
        return handler;
    }

    public static bound(options: {socket: net.Socket, port: number, addr: string, tls: boolean, keepAlive: number }, event: OnSocketEvent) : SocketHandler {
        options.socket.setNoDelay(true);
        if(options.keepAlive > 0) {
            options.socket.setKeepAlive(true, options.keepAlive);
        }
        let handler = new SocketHandler(options.socket, options.port, options.addr, options.tls, event);
        handler._state = SocketState.Connected;
        handler._isServer = true;

        return handler;
    }

    public get localAddr() : string {
        return this._socket.localAddress ?? '';
    }

    private constructor(socket: Socket, port: number, addr: string,  tls: boolean,event: OnSocketEvent) {
        this._port = port;
        this._addr = addr;
        this._tls = tls;
        this._socket = socket;

        this._event = event;
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
        let info = {address: this._socket.remoteAddress, port: this._socket.remotePort};
        socket.on('connect', ()=> {
            if(this._state != SocketState.Connected) {
                this._state = SocketState.Connected;
                this._event(this,info, SocketState.Connected);
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
            this.callAllDrainEvent(this._waitQueue.isEmpty())
            if(this._state != SocketState.Closed /* && this._state != SocketState.Error*/) {
                this._breakBufferFlush = !this._waitQueue.isEmpty();
                this._state = SocketState.Closed;
                this._event(this,info, SocketState.Closed);
            }
            this.release();
        });
        socket.on('data',(data) => {
            this._receiveLength += data.length;
            if(!this.isEnd()) {
                try {
                    this._event(this,info, SocketState.Receive, data);
                } catch (e) {
                    this.procError(e as Error);
                }
            }
        });
        socket.on('end', ()=> {
            if(!this.isEnd()) {
                this._state = SocketState.End;
                this._breakBufferFlush = !this._waitQueue.isEmpty();
                this._event(this,info, SocketState.End);
                //23.10.19 수정
                this._waitQueue.clear();
            }

        });
    }

    private procError(error: Error, logging? : boolean) : void {
        if(logging !== false) {
            logger.error(`procError() - ${error.message}`);
            logger.error(Errors.toString(error));
        }
        this._breakBufferFlush = !this._waitQueue.isEmpty();
        this.callAllDrainEvent(this._waitQueue.isEmpty())
        if(this._state != SocketState.Closed) {
            this._state = SocketState.Closed;
            this._event(this,{address: this._socket.remoteAddress, port:this._socket.remotePort},SocketState.Closed, error);
        }
        this.release();
    }

    private release() : void {
        this.clearWaitQueue();
        this._socket.removeAllListeners();
        this._state = SocketState.Closed;
        this._socket.destroy();
        this._event = ()=>{};
        this._bundle.clear();
        this._waitQueue.clear();
        this._fileCache?.delete();
        this.resetBufferSize();
    }

    private resetBufferSize() : void {
        SocketHandler.GlobalMemoryBufferSize -= this._memoryBufferSize;
        this._memoryBufferSize = 0;
        if (SocketHandler.GlobalMemoryBufferSize < 0) {
            SocketHandler.GlobalMemoryBufferSize = 0;
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
        if(!this._waitQueue.isEmpty()) {
            this._endWaitingState = true;
            return;
        }
        this._socket.end();
    }

    public endImmediate() : void {
        if(this.isEnd()) {
            return;
        }
        let address = this._socket.remoteAddress;
        let port = this._socket.remotePort;
        this._socket.end();
        this._state = SocketState.End;
        this._event?.(this,{address: address, port: port}, SocketState.End);
        this._waitQueue.clear();
    }


    public destroy() : void {
        if(this._fileCache) {
            this._fileCache.delete();
        }
        if(this._state == SocketState.Closed /*|| this._state == SocketState.Error*/) {
            return;
        }
        this.callAllDrainEvent(this._waitQueue.isEmpty());
        this._socket.removeAllListeners();
        this._socket.destroy();
        this._state = SocketState.Closed;
        this._event(this,{address: this._socket.remoteAddress, port:this._socket.remotePort}, SocketState.Closed);

        this._event = ()=>{};
        this._bundle.clear();
        this.resetBufferSize();
    }


    private static isOverGlobalMemoryBufferSize(size: number) : boolean {
        return SocketHandler.GlobalMemoryBufferSize + size > SocketHandler.MaxGlobalMemoryBufferSize;
    }

    private isOverMemoryBufferSize(size: number) : boolean {
        return (this._memoryBufferSize + size > this._memBufferSizeLimit);
    }


    public sendData(data: Buffer,onWriteComplete? : OnWriteComplete ) : void {
        //23.10.19 수정 - 종료 대기 상태면 데이터를 버린다.
        if(this.isEnd() || this._endWaitingState) {
            onWriteComplete?.(this, false);
            return;
        }

        if(this._memBufferSizeLimit > 0 && ((this.isOverMemoryBufferSize(data.length) || SocketHandler.isOverGlobalMemoryBufferSize(data.length)))) {
            if(!this._fileCache) {
                this._fileCache = FileCache.create(SocketHandler.FileCacheDirPath);
            }

            let record = this._fileCache.writeSync(data);
            // todo : 파일 캐시 실패시 처리
            /**if(record.id == -1) {
                return false;
            }*/

            this._waitQueue.pushBack({buffer: EMPTY_BUFFER, cacheID: record.id, onWriteComplete: onWriteComplete});
        } else  {
            this.appendUsageMemoryBufferSize(data.length);
            this._waitQueue.pushBack({buffer: data, cacheID: -1, onWriteComplete: onWriteComplete});
        }


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


    private sendPopDataRecursive2(force: boolean = false) : void {
        if(this._inRunWriteBuffer && !force) {
            return;
        }
        this._inRunWriteBuffer = true;
        let waitItem = undefined;
        do {
            waitItem = this.popBufferSync();
            if(!waitItem) {
                this._inRunWriteBuffer = false;
                // 종료 대기 상태고, 버퍼 큐가 비어있으면 소켓을 종료한다.
                if(this._endWaitingState) {
                    this._socket.end();
                }
                this.callAllDrainEvent(true);
                return;
            }
            if(this.isEnd()) {
                waitItem.onWriteComplete?.(this, false);
                return;
            }
            let length = waitItem.buffer.length;
            let isFileCache = waitItem.cacheID != -1;
            if(length == 0) {
                this.procError(new Error(" sendPopDataRecursive() - buffer length is zero."));
                return;
            }
            let onWriteComplete = waitItem.onWriteComplete;
            this.writeBuffer(waitItem.buffer, (client, success, err) => {

                onWriteComplete?.(client, success, err);
                if(!success) {
                    this._inRunWriteBuffer = false;
                    this.callAllDrainEvent(this._waitQueue.isEmpty())
                    return;
                }
                this._sendLength += length;
                if(!isFileCache) {
                    this.appendUsageMemoryBufferSize(-length);
                }
            });
        } while (waitItem && !this._isFullNativeBuffer)
    }

    // noinspection JSUnusedLocalSymbols
    private sendPopDataRecursive() : void {
        if(this._inRunWriteBuffer) {
            return;
        }
        this._inRunWriteBuffer = true;




        let waitItem = this.popBufferSync();
        if(!waitItem) {
            this._inRunWriteBuffer = false;
            // 종료 대기 상태고, 버퍼 큐가 비어있으면 소켓을 종료한다.
            if(this._endWaitingState) {
                this._socket.end();
            }
            this.callAllDrainEvent(true);
            return;
        }
        if(this.isEnd()) {
            waitItem.onWriteComplete?.(this, false);
            return;
        }
        let length = waitItem.buffer.length;
        let isFileCache = waitItem.cacheID != -1;
        if(length == 0) {
            this.procError(new Error(" sendPopDataRecursive() - buffer length is zero."));
            return;
        }
        this.writeBuffer(waitItem.buffer, (client, success, err) => {
            waitItem!.onWriteComplete?.(client, success, err);

            if(!success) {
                this.callAllDrainEvent(this._waitQueue.isEmpty())
                return;
            }
            this._sendLength += length;
            if(!isFileCache) {
                this.appendUsageMemoryBufferSize(-length);
            }
        });
    }


    private clearWaitQueue() : void {
        let waitItem = this._waitQueue.popFront()
        while(waitItem) {
            waitItem.onWriteComplete?.(this, false);
            waitItem = this._waitQueue.popFront();
        }
        this._waitQueue.clear();
        this.appendUsageMemoryBufferSize(-this._memoryBufferSize);
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
        if(this._memBufferSizeLimit < 0) {
            return;
        }
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



    private popBufferSync() : WaitItem | undefined {
        let waitItem = this._waitQueue.popFront();
        if(!waitItem) {
            return undefined;
        }
        if(waitItem.cacheID != -1 && this._fileCache) {
            let buffer = this._fileCache?.readSync(waitItem.cacheID);
            this._fileCache?.remove(waitItem.cacheID);
            waitItem.buffer = buffer ?? EMPTY_BUFFER;
            return waitItem;
        }
        return waitItem;
    }




}



interface OnWriteComplete {
    (client: SocketHandler, success: boolean, err? : Error) : void;
}



export {SocketHandler, OnWriteComplete, OnDrainEvent, OnSocketEvent};