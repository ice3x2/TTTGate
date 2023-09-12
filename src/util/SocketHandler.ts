import net, {Socket} from "net";
import Dequeue from "./Dequeue";
import SocketState from "./SocketState";
import {ConnectOpt} from "../option/ConnectOpt";
import * as tls from "tls";
import {FileCache, CacheRecord} from "./FileCache";





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


// noinspection JSUnusedGlobalSymbols
class SocketHandler {

    private static LAST_ID: number = 1;


    private static MaxMemoryBufferSize: number = 0;
    private static CurrentMemoryBufferSize: number = 0;
    private static FileCache : FileCache | null = null;


    private readonly _port: number;
    private readonly _addr: string;
    private readonly _tls : boolean;


    private readonly _id: number = SocketHandler.LAST_ID++;
    private _socket: net.Socket
    private _state: SocketState = SocketState.None;
    private _bundle: Map<string, any> = new Map<string, any>();
    private _isServer : boolean = false;

    private _enableFileCache : boolean = false;


    private _event: OnSocketEvent;

    private _waitQueue: Dequeue<WaitItem> = new Dequeue<WaitItem>();
    private _fileCacheIds: Array<FileCacheRecordID> = [];

    private _writeLock : boolean = false;
    private _endWait : boolean = false;


    public static set fileCache(fileCache: FileCache)  {
        SocketHandler.FileCache = fileCache;
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


    public set enableFileCache(value: boolean) {
        this._enableFileCache = value;
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
        process.nextTick(()=> {
            if(this._writeLock || !this._waitQueue.isEmpty()) {
                return;
            }
            this._socket.end();
        });
    }

    public close(callback? : () => void) : void {
        this._waitQueue.clear();
        this._socket.end(callback);
    }

    private static isOverMemoryBufferSize(size: number) : boolean {
        return SocketHandler.CurrentMemoryBufferSize + size > SocketHandler.MaxMemoryBufferSize;
    }




    public sendData(data: Buffer,onWriteComplete? : OnWriteComplete ) : void {
        this.sendData3(data, onWriteComplete);
    }


    //private _isBusy : boolean = false;
    private _writeCount : number = 0;
    private _bufferFull : boolean = false;





    public isConnected() : boolean {
        return this._state == SocketState.Connected;
    }


    private clearWaitQueue() : void {
        if(SocketHandler.FileCache) {
            this._fileCacheIds.forEach((id) => {
                SocketHandler.FileCache?.remove(id);
            });
            this._fileCacheIds = [];
        }
        this._waitQueue.clear();
    }







    public sendData3(data: Buffer,onWriteComplete? : OnWriteComplete ) : void {
        if(this._state == SocketState.Closed || this.state == SocketState.Error) {
            onWriteComplete?.(this, false);
            return;
        }

        this.pushBufferSync(data, onWriteComplete);
        if(this._writeLock) {
            return;
        }



        if(!this._bufferFull || !this._enableFileCache) {
            this.sendPop3();
        }
        if(this._bufferFull && !this._waitQueue.isEmpty() && this._waitQueue.size() % 100 == 0) {
            console.log("queue: " + this._waitQueue.size());
        }


    }

    private  sendPop3() : void {

        let waitItem =  this.popBufferSync();
        if(!waitItem) {
            if(this._endWait) {
                this._socket.end();
            }
            this._writeLock = false;
            return;
        }

        if(this.isEnd()) {
            //this._waitQueue.clear();
            waitItem.onWriteComplete?.(this, false);
            return;
        }


        this._writeCount++;
        if(!this._socket.write(waitItem.buffer, (error) => {
            --this._writeCount;
            let onWriteComplete = waitItem!.onWriteComplete;
            if(error) {
                console.log(error);
                onWriteComplete?.(this, false, error);
                this.procError(error);
            } else {
                onWriteComplete?.(this, true);
                this.sendPopRecursion();
            }
        })) {
            if(!this._bufferFull) {
                this._bufferFull = true;
                this._socket.once('drain', () => {
                    this._bufferFull = false;

                    this.sendPopRecursion();

                    console.log('drain, left queue: ' + this._waitQueue.size());




                });
            }

            /*if(this._failWaitQueue.size() > 1000) {
                console.log(this._failWaitQueue.size())
            }

            this._failWaitQueue.pushBack(new WaitItem(data, onWriteComplete));*/
        }
    }

    private sendPopRecursion() : void {
        if(this._enableFileCache) {
            setImmediate(() => {
                this.sendPop3();
            });
        } else {
            process.nextTick(()=> {
                this.sendPop3();
            });
        }
    }



    private pushBufferSync(buffer: Buffer, onWriteComplete? : OnWriteComplete) : WaitItem {
        let recordID = -1;
        if(this._enableFileCache && SocketHandler.FileCache && !this._waitQueue.isEmpty()  && SocketHandler.isOverMemoryBufferSize(buffer.length) ) {
            let record = SocketHandler.FileCache.writeSync(buffer);
            recordID = record.id;
            this._fileCacheIds.push(recordID);
        } else {
            SocketHandler.CurrentMemoryBufferSize += buffer.length;
        }
        let waitItem = {
            buffer: recordID != -1 ? EMPTY_BUFFER : buffer,
            cacheID: recordID,
            onWriteComplete: onWriteComplete
        }

        this._waitQueue.pushBack(waitItem);
        return waitItem;
    }

    private  popBufferSync() : WaitItem | undefined {
        let waitItem = this._waitQueue.popFront();
        if(!waitItem) {
            return undefined;
        }
        if(waitItem.cacheID != -1 && SocketHandler.FileCache) {
            let buffer = SocketHandler.FileCache?.readSync(waitItem.cacheID);
            SocketHandler.FileCache?.remove(waitItem.cacheID);
            waitItem.buffer = buffer ?? EMPTY_BUFFER;
            return waitItem;
        }
        SocketHandler.CurrentMemoryBufferSize -= waitItem.buffer.length;
        return waitItem;
    }

}



interface OnWriteComplete {
    (client: SocketHandler, success: boolean, err? : Error) : void;
}



export default SocketHandler;