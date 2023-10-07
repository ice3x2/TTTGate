import net, {Socket} from "net";
import SocketState from "./SocketState";
import ConnectOpt from "./ConnectOpt";
import * as tls from "tls";
import {logger} from "../commons/Logger";
import Path from "path";
import {CacheRecord, FileCache} from "./FileCache";
import Dequeue from "./Dequeue";
import Errors from "./Errors";



interface OnSocketEvent {
    (handler: SocketHandler, state: SocketState, data?: any) : void;
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

    private static MaxGlobalMemoryBufferSize: number = 1024 * 1024 * 512; // 512MB
    private static GlobalMemoryBufferSize: number = 0;

    private _fileCacheDirPath : string = Path.join(process.cwd(),"cache");


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

    private _endWaitingState = false;

    private _event: OnSocketEvent;



    private _memoryBufferSize: number = 0;
    private _memBufferSizeLimit: number = -1;



    public get isServer() : boolean {
        return this._isServer;
    }


    public get socket() : net.Socket {
        return this._socket;
    }

    public set onSocketEvent(event: OnSocketEvent) {
        this._event = event;
    }


    public static get globalMemoryBufferSize() : number {
        return SocketHandler.GlobalMemoryBufferSize;
    }

    public static get maxGlobalMemoryBufferSize() : number {
        return SocketHandler.MaxGlobalMemoryBufferSize;
    }

    public static set GlobalMemCacheLimit(limit: number) {
        SocketHandler.MaxGlobalMemoryBufferSize = limit;
        logger.info(`SocketHandler:: set GlobalMemCacheLimit(${limit / 1024 / 1024}MiB)`);
    }

    public setBufferSizeLimit(size: number) : void {
        this._memBufferSizeLimit = size;

    }



    public static connect(options: ConnectOpt, event : OnSocketEvent) : SocketHandler {
        let handlerRef: Array<SocketHandler> = [];

        let connected = () => {
            if(handlerRef.length > 0 && handlerRef[0]._state == SocketState.None) {
                event(handlerRef[0], SocketState.Connected);
            }
        }

        let socket : net.Socket;
        if(options.tls && options.tls === true) {
            let option = {port: options.port, host: options.host, allowHalfOpen: false , /*keepAlive: true,*/noDelay: true, rejectUnauthorized: false};
            socket = tls.connect(option, connected);
        } else {
            let option = {port: options.port, host: options.host, allowHalfOpen: false , /*keepAlive: true,*/noDelay: true};
            socket = net.connect(option, connected);
        }

        let handler = new SocketHandler(socket, options.port, options.host, options.tls ?? false, event);
        handlerRef.push(handler);
        return handler;
    }

    public static bound(options: {socket: net.Socket, port: number, addr: string, tls: boolean }, event: OnSocketEvent) : SocketHandler {
        options.socket.setNoDelay(true);
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
        socket.on('close', ()=> {
            if(this._state != SocketState.Closed /* && this._state != SocketState.Error*/) {
                this._state = SocketState.Closed;
                this._event(this, SocketState.Closed);
            }
            this.release();
        });
        socket.on('data',(data) => {
            if(!this.isEnd()) {
                this._event(this, SocketState.Receive, data);
            }
        });
        socket.on('end', ()=> {
            if(!this.isEnd()) {
                this._state = SocketState.End;
                this._event(this, SocketState.End);
            }

        });
    }

    private procError(error: Error, logging? : boolean) : void {
        if(logging !== false) {
            logger.error(`SocketHandler:: procError() - ${error.message}`);
            logger.error(Errors.toString(error));
        }

        if(this._state != SocketState.Closed) {
            this._state = SocketState.Closed;
            this._event(this, SocketState.Closed, error);
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
        this._socket.end();
        this._state = SocketState.End;
        this._event?.(this, SocketState.End);
        this._waitQueue.clear();
    }


    public destroy() : void {
        if(this._state == SocketState.Closed /*|| this._state == SocketState.Error*/) {
            return;
        }
        this._socket.removeAllListeners();
        this._socket.destroy();

        this._state = SocketState.Closed;
        this._event(this, SocketState.Closed);

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
        /*if(this._bufferSizeLimit < 0) {
            this.writeBuffer(data, (client, success, err) => {
                onWriteComplete?.(client, success, err);
            });
            return;
        }*/

        if(this.isOverMemoryBufferSize(data.length)) {
            /*this.procError(new Error(`SocketHandler:: sendData() - over memory buffer size(${this._memoryBufferSize + data.length}/${this._bufferSizeLimit})`));
            onWriteComplete?.(this, false);
            return;*/
        } else if(SocketHandler.isOverGlobalMemoryBufferSize(data.length)) {
            /*this.procError(new Error(`SocketHandler:: sendData() - over global memory buffer size(${SocketHandler.GlobalMemoryBufferSize + data.length}/${SocketHandler.MaxGlobalMemoryBufferSize})`));
            onWriteComplete?.(this, false);
            return;*/
        }

        if(this.isEnd()) {
            onWriteComplete?.(this, false);
            return;
        }

        let isEmptyBuffer = this._waitQueue.isEmpty();
        if(this._memBufferSizeLimit > 0 && (this.isOverMemoryBufferSize(data.length) || SocketHandler.isOverGlobalMemoryBufferSize(data.length))) {
            if(!this._fileCache) {
                this._fileCache = FileCache.create(this._fileCacheDirPath);
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

        if(this._waitQueue.size() == 1) {
            process.nextTick(()=> {
                this.sendPopDataRecursive();
            });
        }


    }

    private sendPopDataRecursive() : void {
        if(this._waitQueue.isEmpty() || this.isEnd()) {
            return;
        }
        let waitItem = this.popBufferSync();
        if(!waitItem) {
            // 종료 대기 상태고, 버퍼 큐가 비어있으면 소켓을 종료한다.
            if(this._endWaitingState) {
                this._socket.end();
            }
            return;
        }
        let length = waitItem.buffer.length;
        if(length == 0) {
            this.procError(new Error("SocketHandler:: sendPopDataRecursive() - buffer length is zero."));
            return;
        }
        this.writeBuffer(waitItem.buffer, (client, success, err) => {
            waitItem!.onWriteComplete?.(client, success, err);
            if(!success) {
                return;
            }
            this.appendUsageMemoryBufferSize(-length);
            process.nextTick(()=> {
                this.sendPopDataRecursive();
            });
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


    private  writeBuffer(buffer: Buffer,onWriteComplete?: OnWriteComplete) : void {


        if(this.isEnd()) {
            onWriteComplete?.(this, false);
            return;
        }


            try {
                this._socket.write(buffer, (error) => {
                    if (error) {
                        if (this.isEnd()) {
                            onWriteComplete?.(this, false);
                            return;
                        }
                        logger.warn(`SocketHandler:: writeBuffer() - socket.write() error(${error.message})`);
                        logger.warn(error.stack);
                        this.procError(error, false);
                        onWriteComplete?.(this, false, error);
                        return;
                    }
                    onWriteComplete?.(this, true);
                });
            } catch(e) {
                logger.warn(`SocketHandler:: writeBuffer() - socket.write() error(${e})`);
                onWriteComplete?.(this, false);
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



export {SocketHandler, OnWriteComplete};