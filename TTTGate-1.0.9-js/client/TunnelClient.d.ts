/// <reference types="node" />
import { Buffer } from "buffer";
import { OpenOpt } from "../commons/CtrlPacket";
import { ClientOption } from "../types/TunnelingOption";
declare enum CtrlState {
    None = /** 초기 상태 */ 0,
    Connecting = /** 서버와 연결중 */ 1,
    Connected = /** 서버와 연결 완료 */ 2,
    Syncing = 3 /** 서버와 연결 완료 후 Sync 패킷을 보내는중 */
}
type ConnectionState = 'connected' | 'closed';
interface OnCtrlStateCallback {
    (client: TunnelClient, state: ConnectionState, error?: Error): void;
}
interface OnSessionCloseCallback {
    (id: number, waitReceiveLength: number, error?: Error): void;
}
interface OnReceiveDataCallback {
    (id: number, data: Buffer): void;
}
interface OnSessionOpenCallback {
    (id: number, opt: OpenOpt): void;
}
/**
 * Client 는 Ctrl(컨트롤) 클라이언트와 Session.ts(세션) 클라이언트로 구성된다.
 * Ctrl 클라이언트는 서버와 연결을 맺으면 Sync 와 SyncSync 패킷을 받는다. 이후 Ack 패킷을 보내면 연결이 완료된다. 이후 Open 패킷을 받기만한다.
 * Open 패킷을 수신받으면 Session클라이언트를 생성하고, Session.ts 클라이언트는 서버와 연결을 맺는다. 이후 이벤트를 통하여 EndPoint 클라이언트와 연결된다.
 * EndPoint 클라이언트와 연결이 완료되면 Syncronize 패킷을 보낸다.
 *
 *
 */
declare class TunnelClient {
    private readonly _option;
    private _state;
    private _ctrlHandler;
    private _activatedSessionDataHandlerMap;
    private _waitBufferQueueMap;
    private _id;
    private _onCtrlStateCallback?;
    private _onEndPointCloseCallback?;
    private _onConnectEndPointCallback?;
    private _onReceiveDataCallback?;
    set onEndPointCloseCallback(value: OnSessionCloseCallback);
    set onConnectEndPointCallback(value: OnSessionOpenCallback);
    set onReceiveDataCallback(value: OnReceiveDataCallback);
    set onCtrlStateCallback(callback: OnCtrlStateCallback);
    static create(option: ClientOption): TunnelClient;
    private constructor();
    private makeConnectOpt;
    connect(): boolean;
    get state(): CtrlState;
    private failHandshake;
    syncEndpointSession(sessionID: number): boolean;
    private flushWaitBuffer;
    terminateEndPointSession(sessionID: number): void;
    private deleteDataHandler;
    private onCtrlHandlerEvent;
    private destroyAllDataHandler;
    private onReceiveFromCtrlHandler;
    private processReceiveMessage;
    /**
     * 데이터 핸들러를 연결한다. 연결이 완료되면 데이터 핸들러에게 자신의 ID를 알리는 패킷을 보낸다.
     * 패킷 전송이 성공하면 데이터 핸들러는 자신의 상태를 DataHandlerState.ConnectingEndPoint 로 변경하고, EndPoint와 연결을 시도한다.
     * @param handlerID
     * @param sessionID
     * @private
     */
    private connectDataHandler;
    /**
     * 데이터 핸들러가 EndPoint와 연결을 시도한다. 연결이 완료되면 세션을 생성하고, 세션을 서버에 알린다.
     * @param handlerID
     * @param sessionID
     * @param endPointConnectOpt
     * @private
     */
    private connectEndPoint;
    private onReceiveFromDataHandler;
    private sendSyncAndSyncSyncCmd;
    private sendAckCtrl;
    private sendClientSysinfo;
    /**
     * 외부(TTTClient)에서 세션을 종료한다.
     * @param sessionID
     * @param waitForReceiveDataLength
     */
    closeEndPointSession(sessionID: number, waitForReceiveDataLength: number): boolean;
    private sendCloseSession;
    sendData(sessionID: number, data: Buffer): boolean;
    private writeWaitBuffer;
}
export { TunnelClient, ConnectionState };
