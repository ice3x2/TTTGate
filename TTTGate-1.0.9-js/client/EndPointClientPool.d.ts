/// <reference types="node" />
import { Buffer } from "buffer";
import { OpenOpt } from "../commons/CtrlPacket";
interface OnEndPointClientStateChangeCallback {
    (id: number, state: number, bundle?: {
        data?: Buffer;
        receiveLength: number;
    }): void;
}
interface OnEndPointTerminateCallback {
    (id: number): void;
}
declare class EndPointClientPool {
    private _connectOptMap;
    private _endPointClientMap;
    private _onEndPointClientStateChangeCallback;
    private _onEndPointTerminateCallback;
    private _sessionCleanupIntervalID;
    private _closeWaitTimeout;
    constructor();
    private startSessionCleanup;
    set onEndPointClientStateChangeCallback(callback: OnEndPointClientStateChangeCallback);
    set onEndPointTerminateCallback(callback: OnEndPointTerminateCallback);
    open(sessionID: number, connectOpt: OpenOpt): void;
    close(id: number, endLength: number): boolean;
    private closeIfSatisfiedLength;
    send(id: number, data: Buffer): void;
    private onEndPointHandlerEvent;
    closeAll(): void;
}
export default EndPointClientPool;
