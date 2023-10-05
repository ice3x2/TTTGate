import net, {Socket} from "net";
import SocketState from "./SocketState";
import ConnectOpt from "./ConnectOpt";
import * as tls from "tls";
import {logger} from "../commons/Logger";



interface OnSocketEvent {
    (handler: SocketHandler, state: SocketState, data?: any) : void;
}

// noinspection JSUnusedGlobalSymbols
class SocketHandler {

    private static LAST_ID: number = 0;

    private static MaxGlobalMemoryBufferSize: number = 1024 * 1024 * 512; // 512MB
    private static GlobalMemoryBufferSize: number = 0;


    private readonly _port: number;
    private readonly _addr: string;
    private readonly _tls : boolean;

    private readonly _id: number = ++SocketHandler.LAST_ID;
    private _socket: net.Socket
    private _state: SocketState = SocketState.None;
    private _bundle: Map<string, any> = new Map<string, any>();
    private _isServer : boolean = false;


    private _event: OnSocketEvent;



    private _memoryBufferSize: number = 0;
    private _bufferSizeLimit: number = -1;



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
        this._bufferSizeLimit = size;

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
            this._event(this, SocketState.Receive, data);
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
            logger.error(error.stack);
        }
        //if(!this.isEnd()) {
            this._event(this, SocketState.Closed, error);
        //}
        this._state = SocketState.Closed;
        this.release();
    }

    private release() : void {
        this._socket.removeAllListeners();
        this._state = SocketState.Closed;
        this._socket.destroy();
        this._event = ()=>{};
        this._bundle.clear();
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



    public end() : void {
        setImmediate(()=> {
            this._socket.end();
        });
    }

    public destroy() : void {
        if(this._state == SocketState.Closed /*|| this._state == SocketState.Error*/) {
            return;
        }
        this._socket.removeAllListeners();
        this._socket.destroy();
        this._event(this, SocketState.Closed);
        this._state = SocketState.Closed;
        this._event = ()=>{};
        this._bundle.clear();
        this.resetBufferSize();
    }


    private static isOverGlobalMemoryBufferSize(size: number) : boolean {
        return SocketHandler.GlobalMemoryBufferSize + size > SocketHandler.MaxGlobalMemoryBufferSize;
    }

    private isOverMemoryBufferSize(size: number) : boolean {
        return (this._memoryBufferSize + size > this._bufferSizeLimit);
    }


    public sendData(data: Buffer,onWriteComplete? : OnWriteComplete ) : void {
        if(this._bufferSizeLimit > 0) {
            if(this.isOverMemoryBufferSize(data.length)) {
                this.procError(new Error(`SocketHandler:: sendData() - over memory buffer size(${this._memoryBufferSize + data.length}/${this._bufferSizeLimit})`));
                onWriteComplete?.(this, false);
                return;
            } else if(SocketHandler.isOverGlobalMemoryBufferSize(data.length)) {
                this.procError(new Error(`SocketHandler:: sendData() - over global memory buffer size(${SocketHandler.GlobalMemoryBufferSize + data.length}/${SocketHandler.MaxGlobalMemoryBufferSize})`));
                onWriteComplete?.(this, false);
                return;
            }
        }
        process.nextTick(()=> {
            this.writeBuffer(data, onWriteComplete);
        });
    }


    public isConnected() : boolean {
        return this._state == SocketState.Connected;
    }



    private  writeBuffer(buffer: Buffer,onWriteComplete?: OnWriteComplete) : void {


        if(this.isEnd()) {
            onWriteComplete?.(this, false);
            return;
        }

        let length = buffer.length;
        if(this._bufferSizeLimit > 0) {
            this.appendUsageMemoryBufferSize(length);
        }

            try {
                this._socket.write(buffer, (error) => {
                    if (this._bufferSizeLimit > 0) {
                        this.appendUsageMemoryBufferSize(-length);
                    }

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
        if(this._bufferSizeLimit < 0) {
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



}



interface OnWriteComplete {
    (client: SocketHandler, success: boolean, err? : Error) : void;
}



export {SocketHandler, OnWriteComplete};