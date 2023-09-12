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



    public sendData2(data: Buffer,onWriteComplete? : OnWriteComplete ) : void {
        if(this._state == SocketState.Closed || this.state == SocketState.Error) {
            onWriteComplete?.(this, false);
            return;
        }
        let waitItem = {
            buffer: data,
            cacheID: -1,
            onWriteComplete: onWriteComplete
        }

        this._waitQueue.pushBack(waitItem);

        if(this._writeLock) {

            return;
        }

        if(!this._isBusy) {
            this.sendPop2();
        }


    }

    private _isBusy : boolean = false;
    private _bufferFull : boolean = false;

    private sendPop2() : void {
        let waitItem = this._waitQueue.popFront();
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

        this._isBusy = true;
        if(!this._socket.write(waitItem.buffer, (error) => {
            this._isBusy = false;
            let onWriteComplete = waitItem!.onWriteComplete;
            if(error) {
                console.log(error);
                onWriteComplete?.(this, false, error);
                this.procError(error);
            } else {
                onWriteComplete?.(this, true);
                process.nextTick(()=> {
                    this.sendPop2();
                });

            }

        })) {
            this._isBusy = false;
            /*if(this._failWaitQueue.size() > 1000) {
                console.log(this._failWaitQueue.size())
            }

            this._failWaitQueue.pushBack(new WaitItem(data, onWriteComplete));*/
        }
    }


    public sendData1(data: Buffer,onWriteComplete? : OnWriteComplete ) : void {
        if(this._state == SocketState.Closed || this.state == SocketState.Error) {
            onWriteComplete?.(this, false);
            return;
        }


        this.pushBuffer(data, onWriteComplete).then(async (waitItem) => {
            if(this._writeLock) {
                return;
            }
            await this.sendPop1();
        });



    }

    private async sendPop1() : Promise<void> {

        let waitItem = await this.popBuffer();
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

        let onWriteComplete = waitItem!.onWriteComplete;
        try {
            await this.socketWrite(waitItem!.buffer);
            onWriteComplete?.(this, true);
            setImmediate(async ()=> {
                await this.sendPop1();
            });
        } catch (error) {
            console.log(error);
            onWriteComplete?.(this, false, error as Error);
            this.procError(error);
        }

        /*

        if(!this._socket.write(waitItem.buffer, (error) => {
            let onWriteComplete = waitItem!.onWriteComplete;
            if(error) {
                console.log(error);
                onWriteComplete?.(this, false, error);
                this.procError(error);
            } else {
                onWriteComplete?.(this, true);
                process.nextTick(async ()=> {
                    await this.sendPop();
                });

            }

        })) {
            /*if(this._failWaitQueue.size() > 1000) {
                console.log(this._failWaitQueue.size())
            }

            this._failWaitQueue.pushBack(new WaitItem(data, onWriteComplete));*/
        //}*/
    }





    public sendData5(data: Buffer,onWriteComplete? : OnWriteComplete ) : void {
        if(this._state == SocketState.Closed || this.state == SocketState.Error) {
            onWriteComplete?.(this, false);
            return;
        }


        this.pushBuffer5(data, onWriteComplete);

        if(this._writeLock) {
            return;
        }

        this.sendPop5();


    }

    private _onPop5 : boolean = false;
    private sendPop5()  {
        if(this._onPop5) {
            return;
        }
        this._onPop5 = true;

         this.popBuffer5((waitItem) => {
             if (!waitItem) {
                 if (this._endWait) {
                     this._socket.end();
                 }
                 this._writeLock = false;
                 return;
             }

             if (this.isEnd()) {
                 //this._waitQueue.clear();
                 waitItem.onWriteComplete?.(this, false);
                 return;
             }


             if(!this._socket.write(waitItem.buffer, (error) => {
                 this._onPop5 = false;
                 let onWriteComplete = waitItem!.onWriteComplete;
                 if(error) {
                     console.log(error);
                     onWriteComplete?.(this, false, error);
                     this.procError(error);
                 } else {
                     onWriteComplete?.(this, true);
                     setImmediate( ()=> {
                         this.sendPop5();
                     });

                 }

             })) {
                 this._onPop5 = false;
                 /*if(this._failWaitQueue.size() > 1000) {
                     console.log(this._failWaitQueue.size())
                 }

                 this._failWaitQueue.pushBack(new WaitItem(data, onWriteComplete));*/
             }
         });





    }





    private async socketWrite(data: Buffer) : Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            try {
                if (this._socket.write(data, (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(true);
                    }
                })) {
                    resolve(true);
                }
            } catch (e) {
                reject(e);
            }
        });
    }

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


    private pushBuffer5(buffer: Buffer, onWriteComplete? : OnWriteComplete) : WaitItem {
        let recordID = -1;
        let waitItem = {
            buffer: EMPTY_BUFFER,
            cacheID: 0,
            onWriteComplete: onWriteComplete
        }
        if(SocketHandler.FileCache && SocketHandler.isOverMemoryBufferSize(buffer.length)) {
            SocketHandler.FileCache.write(buffer).then((record) => {
                waitItem.cacheID = record.id;
                this._fileCacheIds.push(recordID);
            });
        } else {
            waitItem.cacheID = -1;
            waitItem.buffer = buffer;
            SocketHandler.CurrentMemoryBufferSize += buffer.length;
        }
        this._waitQueue.pushBack(waitItem);
        return waitItem;
    }


    private popBuffer5(onCallback: onWaitItemComplete , waitItem?: WaitItem) : void {
        if(waitItem == undefined) {
            waitItem = this._waitQueue.popFront();
        }
        if (!waitItem) {
            onCallback(undefined);
            return ;
        }
        if(waitItem.cacheID == 0) {
            setImmediate(async () => {
                this.popBuffer5(onCallback, waitItem);
            });
            return;
        }
        else if(waitItem.cacheID > 0) {
            SocketHandler.FileCache?.read(waitItem.cacheID).then((buffer) => {
                waitItem!.buffer = buffer ?? EMPTY_BUFFER;
                onCallback(waitItem!);
                SocketHandler.FileCache?.remove(waitItem!.cacheID);
            });
            return;
        }
        SocketHandler.CurrentMemoryBufferSize -= waitItem.buffer.length;
        onCallback(waitItem!);


    }


    private async pushBuffer(buffer: Buffer, onWriteComplete? : OnWriteComplete) : Promise<WaitItem> {
        let recordID = -1;
        if(SocketHandler.FileCache && SocketHandler.isOverMemoryBufferSize(buffer.length)) {
            let record = await SocketHandler.FileCache.write(buffer);
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

    private async popBuffer() : Promise<WaitItem | undefined> {
        let waitItem = this._waitQueue.popFront();
        if(!waitItem) {
            return undefined;
        }
        if(waitItem.cacheID != -1 && SocketHandler.FileCache) {
            let buffer = await SocketHandler.FileCache?.read(waitItem.cacheID);
            SocketHandler.FileCache?.remove(waitItem.cacheID);
            waitItem.buffer = buffer ?? EMPTY_BUFFER;
            return waitItem;
        }
        SocketHandler.CurrentMemoryBufferSize -= waitItem.buffer.length;
        return waitItem;
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



        if(!this._isBusy || !this._enableFileCache) {
            this.sendPop3();
        }
        if(this._isBusy) {
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

        this._isBusy = true;
        if(!this._socket.write(waitItem.buffer, (error) => {
            this._isBusy = false;
            let onWriteComplete = waitItem!.onWriteComplete;
            if(error) {
                console.log(error);
                onWriteComplete?.(this, false, error);
                this.procError(error);
            } else {
                onWriteComplete?.(this, true);
                setImmediate( ()=> {
                     this.sendPop3();
                });

            }

        })) {
            if(this._isBusy && !this._bufferFull) {
                this._socket.once('drain', () => {
                    this._bufferFull = false;
                    this.sendPop3();
                });
            }

            /*if(this._failWaitQueue.size() > 1000) {
                console.log(this._failWaitQueue.size())
            }

            this._failWaitQueue.pushBack(new WaitItem(data, onWriteComplete));*/
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