import net, {Socket} from "net";
import Dequeue from "./Dequeue";
import SocketState from "./SocketState";
import {ConnectOpt} from "../option/ConnectOpt";
import * as tls from "tls";






class WaitItem {
    public buffer: Buffer;
    public onWriteComplete : OnWriteComplete | undefined;

    constructor(buffer: Buffer, onWriteComplete?: OnWriteComplete) {
        this.buffer = buffer;
        this.onWriteComplete = onWriteComplete;
    }
}



interface OnSocketEvent {
    (handler: SocketHandler, state: SocketState, data?: any) : void;
}


// noinspection JSUnusedGlobalSymbols
class SocketHandler {

    private static LAST_ID: number = 1;

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

    private _writeLock : boolean = false;
    private _endWait : boolean = false;


    public get isServer() : boolean {
        return this._isServer;
    }


    public get socket() : net.Socket {
        return this._socket;
    }

    public set onSocketEvent(event: OnSocketEvent) {
        this._event = event;
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
            this._waitQueue.clear();
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
        this._waitQueue.clear();
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




    private _bufferLength : number = 0;

    public sendData(data: Buffer,onWriteComplete? : OnWriteComplete ) : void {
        if(this._state == SocketState.Closed || this.state == SocketState.Error) {
            onWriteComplete?.(this, false);
            return;
        }
        this._waitQueue.pushBack(new WaitItem(data!, onWriteComplete));

        this._bufferLength += data!.length;

        if(this._writeLock) {

            return;
        }

        this.sendPop();


    }

    private sendPop() : void {
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

        this._bufferLength -= waitItem.buffer.length;
        if(!this._socket.write(waitItem.buffer, (error) => {
            let onWriteComplete = waitItem!.onWriteComplete;
            if(error) {
                console.log(error);
                onWriteComplete?.(this, false, error);
                this.procError(error);
            } else {
                onWriteComplete?.(this, true);
                process.nextTick(()=> {
                    this.sendPop();
                });

            }

        })) {
            /*if(this._failWaitQueue.size() > 1000) {
                console.log(this._failWaitQueue.size())
            }

            this._failWaitQueue.pushBack(new WaitItem(data, onWriteComplete));*/
        }
    }



    public isConnected() : boolean {
        return this._state == SocketState.Connected;
    }
}



interface OnWriteComplete {
    (client: SocketHandler, success: boolean, err? : Error) : void;
}



export default SocketHandler;