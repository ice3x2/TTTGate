/// <reference types="node" />
import SocketState from "../util/SocketState";
import { TunnelingOption } from "../types/TunnelingOption";
import { CertInfo } from "./CertificationStore";
interface NewSessionCallback {
    (sessionID: number, opt: TunnelingOption): void;
}
interface OnHandlerEventCallback {
    (sessionID: number, state: SocketState, bundle?: {
        data?: Buffer;
        receiveLength: number;
    }): void;
}
interface OnTerminateSessionCallback {
    (sessionID: number): void;
}
type ExternalPortServerStatus = {
    port: number;
    online: boolean;
    sessions: number;
    uptime: number;
    active: boolean;
    activeStart: number;
    activeTimeout: number;
    rx: number;
    tx: number;
};
declare class ExternalPortServerPool {
    private _portServerMap;
    private _statusMap;
    private _handlerMap;
    private _activeTimeoutMap;
    private _onNewSessionCallback;
    private _onHandlerEventCallback;
    private _onTerminateSessionCallback;
    private _closeWaitTimeout;
    private static LAST_SESSION_ID;
    private _sessionCleanupIntervalID;
    static create(options: Array<TunnelingOption>): ExternalPortServerPool;
    private constructor();
    private startSessionCleanup;
    startServer(option: TunnelingOption, certInfo?: CertInfo): Promise<boolean>;
    private optionNormalization;
    set OnNewSessionCallback(callback: NewSessionCallback);
    set OnHandlerEventCallback(callback: OnHandlerEventCallback);
    set OnTerminateSessionCallback(callback: OnTerminateSessionCallback);
    getServerStatus(port: number): ExternalPortServerStatus;
    send(id: number, data: Buffer): boolean;
    private onSendDataCallback;
    closeSession(id: number, endLength: number): void;
    private closeIfSatisfiedLength;
    private onHandlerEvent;
    private onServerEvent;
    private initEndPointInfo;
    private updateCount;
    stop(port: number): Promise<boolean>;
    private destroyHandlers;
    private removeHandlerByForwardPort;
    inactive(port: number): Promise<boolean>;
    setActiveTimeout(port: number, timeout: number): boolean;
    active(port: number, timeout?: number): Promise<boolean>;
    stopAll(): Promise<void>;
}
export { ExternalPortServerPool, ExternalPortServerStatus };
