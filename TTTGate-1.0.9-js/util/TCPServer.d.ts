import { SocketHandler } from "./SocketHandler";
import SocketState from "./SocketState";
interface OnServerEvent {
    (server: TCPServer, state: SocketState, handler?: SocketHandler): void;
}
interface OnSocketEvent {
    (handler: SocketHandler, state: SocketState, data?: any): void;
}
interface ServerOption {
    port: number;
    tls?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
    keepAlive?: number;
}
declare class TCPServer {
    static readonly DEFAULT_KEEP_ALIVE: number;
    private readonly _options;
    private _server;
    private _idHandlerMap;
    private _onServerEvent?;
    private _onHandlerEvent?;
    private _state;
    private _bundle;
    private _error;
    isEnd(): boolean;
    getError(): any;
    isListen(): boolean;
    setOnServerEvent(event: OnServerEvent): void;
    setBundle(key: string, value: any): void;
    getBundle(key: string): any;
    deleteBundle(key: string): void;
    get port(): number;
    setOnHandlerEvent(event: OnSocketEvent): void;
    private constructor();
    private onBind;
    static create(options: ServerOption): TCPServer;
    start(callback?: (err?: Error) => void): void;
    stop(callback?: (err?: Error) => void): void;
    private release;
}
export { TCPServer, OnServerEvent, OnSocketEvent, ServerOption };
