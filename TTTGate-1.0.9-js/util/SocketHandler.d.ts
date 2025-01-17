/// <reference types="node" />
/// <reference types="node" />
import net from "net";
import SocketState from "./SocketState";
import ConnectOpt from "./ConnectOpt";
interface OnSocketEvent {
    (handler: SocketHandler, state: SocketState, data?: any): void;
}
interface OnDrainEvent {
    (handler: SocketHandler, success: boolean): void;
}
declare class SocketHandler {
    private static LAST_ID;
    private static MaxGlobalMemoryBufferSize;
    private static GlobalMemoryBufferSize;
    private static FileCacheDirPath;
    private readonly _port;
    private readonly _addr;
    private readonly _tls;
    private readonly _id;
    private _socket;
    private _state;
    private _bundle;
    private _isServer;
    private _fileCache;
    private _waitQueue;
    private _drainEventList;
    private _breakBufferFlush;
    private _sendLength;
    private _receiveLength;
    private _endWaitingState;
    private _event;
    private _memoryBufferSize;
    private _memBufferSizeLimit;
    private _isFullNativeBuffer;
    private _inRunWriteBuffer;
    get isServer(): boolean;
    get socket(): net.Socket;
    static set fileCacheDirPath(path: string);
    set onSocketEvent(event: OnSocketEvent);
    get breakBufferFlush(): boolean;
    get sendLength(): number;
    get receiveLength(): number;
    static get globalMemoryBufferSize(): number;
    static get maxGlobalMemoryBufferSize(): number;
    static set GlobalMemCacheLimit(limit: number);
    setBufferSizeLimit(size: number): void;
    /**
     * 버퍼가 비워졌을 때 한 번만 호출되는 이벤트 리스너를 등록한다.
     * 만약 버퍼가 비어있는 상태라면 즉시 호출된다.
     * @param event
     */
    addOnceDrainListener(event: OnDrainEvent): void;
    static connect(options: ConnectOpt, event: OnSocketEvent): SocketHandler;
    static bound(options: {
        socket: net.Socket;
        port: number;
        addr: string;
        tls: boolean;
        keepAlive: number;
    }, event: OnSocketEvent): SocketHandler;
    get localAddr(): string;
    private constructor();
    get remoteAddress(): string;
    get remotePort(): number;
    setBundle(key: string, value: any): void;
    getBundle(key: string): any;
    deleteBundle(key: string): void;
    hasBundle(key: string): boolean;
    isEnd(): boolean;
    isSecure(): boolean;
    get state(): SocketState;
    get id(): number;
    private initSocket;
    private procError;
    private release;
    private resetBufferSize;
    get port(): number;
    get addr(): string;
    get tls(): boolean;
    end_(): void;
    endImmediate(): void;
    destroy(): void;
    private static isOverGlobalMemoryBufferSize;
    private isOverMemoryBufferSize;
    sendData(data: Buffer, onWriteComplete?: OnWriteComplete): void;
    private callAllDrainEvent;
    private sendPopDataRecursive2;
    private sendPopDataRecursive;
    private clearWaitQueue;
    isConnected(): boolean;
    private writeBuffer;
    private appendUsageMemoryBufferSize;
    private popBufferSync;
}
interface OnWriteComplete {
    (client: SocketHandler, success: boolean, err?: Error): void;
}
export { SocketHandler, OnWriteComplete, OnDrainEvent, OnSocketEvent };
