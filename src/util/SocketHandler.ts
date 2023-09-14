import net, {Socket} from "net";
import Dequeue from "./Dequeue";
import SocketState from "./SocketState";
import ConnectOpt from "./ConnectOpt";
import * as tls from "tls";
import {FileCache, CacheRecord} from "./FileCache";
import Path from "path";
import {logger} from "../commons/Logger";
import ObjectUtil from "./ObjectUtil";





type FileCacheRecordID = number;

interface onWaitItemComplete {
    (waitItem: WaitItem| undefined) : void;
}

type WaitItem = {
    buffer: Buffer;
    cacheID : FileCacheRecordID;
    onWriteComplete : OnWriteComplete | undefined;
}

const EMPTY_BUFFER = Buffer.alloc(0);



interface OnSocketEvent {
    (handler: SocketHandler, state: SocketState, data?: any) : void;
}

interface CacheOption {
    fileCache?: boolean;
    maxMemCacheSize?: number;
    enable : boolean;
    fileCacheDirectory?: string;
}



// noinspection JSUnusedGlobalSymbols
class SocketHandler {

    private static LAST_ID: number = 1;


    private static MaxGlobalMemoryBufferSize: number = 1024 * 1024 * 512; // 512MB
    private static GlobalMemoryBufferSize: number = 0;

    private static TempDir: string = Path.join(process.cwd(), "tmp");


    private readonly _port: number;
    private readonly _addr: string;
    private readonly _tls : boolean;


    private readonly _id: number = SocketHandler.LAST_ID++;
    private _socket: net.Socket
    private _state: SocketState = SocketState.None;
    private _bundle: Map<string, any> = new Map<string, any>();
    private _isServer : boolean = false;




    private _event: OnSocketEvent;

    private _waitQueue: Dequeue<WaitItem> = new Dequeue<WaitItem>();


    private _endWait : boolean = false;

    private _fileCache : FileCache | null = null;
    private _bufferFull : boolean = false;

    private _memoryBufferSize: number = 0;
    private _unavailableState: boolean = false;

    private _cacheOption: CacheOption = {
        fileCache: false,
        maxMemCacheSize: 10 * 1024 * 1024,
        enable: false,
        fileCacheDirectory: SocketHandler.TempDir
    }


    public get isServer() : boolean {
        return this._isServer;
    }


    public get socket() : net.Socket {
        return this._socket;
    }

    public set onSocketEvent(event: OnSocketEvent) {
        this._event = event;
    }

    public static set DefaultCacheDirectory(path: string) {
        SocketHandler.TempDir = path;
    }



    public static set GlobalMemCacheLimit(limit: number) {
        SocketHandler.GlobalMemoryBufferSize = limit;
        logger.info(`SocketHandler:: set GlobalMemCacheLimit(${limit / 1024 / 1024}MiB)`);
    }

    public setCacheOption(option?: CacheOption) : void {
        if(option == undefined) {
            return;
        }
        option = ObjectUtil.cloneDeep(option);
        if(option.fileCache == undefined) option.fileCache = this._cacheOption.fileCache;
        if(option.fileCacheDirectory == undefined) option.fileCacheDirectory = this._cacheOption.fileCacheDirectory;
        if(option.maxMemCacheSize == undefined) option.maxMemCacheSize = this._cacheOption.maxMemCacheSize;
        this._cacheOption = option;
        if(this._cacheOption.enable && this._cacheOption.fileCache) {
            this._fileCache = FileCache.create(this._cacheOption.fileCacheDirectory!);
        }
    }






    public static connect(options: ConnectOpt, event : OnSocketEvent) : SocketHandler {
        let handlerRef: Array<SocketHandler> = [];


        let connected = () => {
            if(handlerRef.length > 0 && handlerRef[0]._state == SocketState.None) {
                event(handlerRef[0], SocketState.Connected);
            }
        }

        let socket : net.Socket;
        if(options.tls == true) {
            let option = {port: options.port, host: options.host, allowHalfOpen: false , keepAlive: true,noDelay: true, rejectUnauthorized: false};
            socket = tls.connect(option, connected);
        } else {
            let option = {port: options.port, host: options.host, allowHalfOpen: false , keepAlive: true,noDelay: true};
            socket = net.connect(option, connected);
        }

        let handler = new SocketHandler(socket, options.port, options.host, options.tls ?? false, event);
        handlerRef.push(handler);
        return handler;
    }

    public static bound(options: {socket: net.Socket, port: number, addr: string, tls: boolean }, event: OnSocketEvent) : SocketHandler {
        options.socket.setKeepAlive(true, 4000);
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

    public isUnavailable() : boolean {
        return this._unavailableState;
    }

    public isEnd() : boolean {
        return this._state == SocketState.Closed || this._state == SocketState.End || this._state == SocketState.Error;
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
            if(this._state != SocketState.Closed && this._state != SocketState.Error) {
                this._state = SocketState.Closed;
                this._event(this, SocketState.Closed);
            }
            this.release();
        });
        socket.on('data',(data) => {
            this._event(this, SocketState.Receive, data);
        });
        socket.on('end', ()=> {
            if(!this.isEnd()) {
                this._state = SocketState.End;
                this._event(this, SocketState.End);
            }
            this.clearWaitQueue();
        });
    }

    private procError(error: any) : void {
        if(!this.isEnd()) {
            this._event(this, SocketState.Error, error);
        }
        this._state = SocketState.Error;
        this.release();
    }

    private release() : void {
        this._socket.removeAllListeners();
        this._socket.destroy();
        this._state = SocketState.Closed;
        this._event = ()=>{};
        this.clearWaitQueue();
        this._bundle.clear();

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



    public end() : void {
        this._endWait = true;
        setImmediate(()=> {
            if(!this._waitQueue.isEmpty() && !this._unavailableState) {
                return;
            }
            this._socket.end();
        });
    }

    public close(callback? : () => void) : void {
        this.clearWaitQueue();
        this._socket.end(callback);
    }

    private static isOverGlobalMemoryBufferSize(size: number) : boolean {
        return SocketHandler.GlobalMemoryBufferSize + size > SocketHandler.MaxGlobalMemoryBufferSize;
    }



    private isOverMemoryBufferSize(size: number) : boolean {
        return this._memoryBufferSize + size > this._cacheOption.maxMemCacheSize! || SocketHandler.isOverGlobalMemoryBufferSize(size);
    }




    public sendData(data: Buffer,onWriteComplete? : OnWriteComplete ) : void {
        this.pushSendData(data, onWriteComplete);
    }


    public isConnected() : boolean {
        return this._state == SocketState.Connected;
    }


    private clearWaitQueue() : void {
        if(this._memoryBufferSize > 0) {
            this.appendUsageMemoryBufferSize(-this._memoryBufferSize);
        }

        if(this._fileCache) {
            this._fileCache.delete();
        }
        this._waitQueue.clear();
    }




    public pushSendData(data: Buffer, onWriteComplete? : OnWriteComplete ) : void {
        if(this._unavailableState || this._state == SocketState.Closed || this.state == SocketState.Error) {
            onWriteComplete?.(this, false);
            return;
        }

        if(!this.pushBufferSync(data, onWriteComplete)) {
            onWriteComplete?.(this, false);
            return;
        }


        if(!this._bufferFull || !this._cacheOption.enable) {
            this.popDataAndSend();
        }
        /*if(this._bufferFull && !this._waitQueue.isEmpty() && this._waitQueue.size() % 1000 == 0) {
            console.log("queue: " + this._waitQueue.size());
        }*/

    }

    private  popDataAndSend() : void {

        let waitItem =  this.popBufferSync();
        if(!waitItem) {
            if(this._endWait) {
                this._socket.end();
            }
            return;
        }

        if(this.isEnd() || this._unavailableState) {
            //this._waitQueue.clear();
            waitItem.onWriteComplete?.(this, false);
            return;
        }


            if (!this._socket.write(waitItem.buffer, (error) => {
                let onWriteComplete = waitItem!.onWriteComplete;
                if (error) {
                    if (this._endWait) {
                        this.clearWaitQueue();
                    }
                    onWriteComplete?.(this, false, error);
                    this.procError(error);
                } else {
                    onWriteComplete?.(this, true);
                    this.sendPopRecursion();
                }
            })) {
                if (!this._cacheOption.enable) {
                    return;
                }
                if (!this._bufferFull) {
                    this._bufferFull = true;
                    this._socket.once('drain', () => {
                        this._bufferFull = false;
                        this.sendPopRecursion();
                    });
                }
            }

    }

    private sendPopRecursion() : void {
        if(this._cacheOption.enable && this._cacheOption.fileCache) {
            setImmediate(() => {
                this.popDataAndSend();
            });
        } else {
            process.nextTick(()=> {
                this.popDataAndSend();
            });
        }
    }

    private appendUsageMemoryBufferSize(size: number) : void {
        SocketHandler.GlobalMemoryBufferSize += size;
        this._memoryBufferSize += size;
        if(SocketHandler.GlobalMemoryBufferSize < 0) {
            SocketHandler.GlobalMemoryBufferSize = 0;
        }
        if(this._memoryBufferSize < 0) {
            this._memoryBufferSize = 0;
        }
    }



    private pushBufferSync(buffer: Buffer, onWriteComplete? : OnWriteComplete) : boolean {
        let recordID = -1;

        if(this._cacheOption.fileCache && this._fileCache && !this._waitQueue.isEmpty()  && this.isOverMemoryBufferSize(buffer.length)) {
            let record = this._fileCache.writeSync(buffer);
            if(record.id == -1) {
                return false;
            }
            recordID = record.id;
        } else {
            if(this._cacheOption.enable && this._waitQueue.size() > 1 && this.isOverMemoryBufferSize(buffer.length)) {
                if(SocketHandler.isOverGlobalMemoryBufferSize(buffer.length)) {
                    logger.error(`SocketHandler: global memory buffer size is over. size: ${SocketHandler.GlobalMemoryBufferSize}, max: ${SocketHandler.MaxGlobalMemoryBufferSize}`);
                } else {
                    logger.error(`SocketHandler: ${this._id}  memory buffer size is over. size: ${this._memoryBufferSize}, max: ${this._cacheOption.maxMemCacheSize!}`);
                }
                this.appendUsageMemoryBufferSize(-this._memoryBufferSize);
                this._unavailableState = true;
                this.end();
                return false;
            }
            this.appendUsageMemoryBufferSize(buffer.length);
        }
        let waitItem = {
            buffer: recordID != -1 ? EMPTY_BUFFER : buffer,
            cacheID: recordID,
            onWriteComplete: onWriteComplete
        }

        this._waitQueue.pushBack(waitItem);
        return true;
    }



    private  popBufferSync() : WaitItem | undefined {
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
        this.appendUsageMemoryBufferSize(-waitItem.buffer.length);
        return waitItem;
    }

}



interface OnWriteComplete {
    (client: SocketHandler, success: boolean, err? : Error) : void;
}



export {SocketHandler, CacheOption};