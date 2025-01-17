/// <reference types="node" />
import { SocketHandler } from "../util/SocketHandler";
import { CtrlPacket, OpenOpt } from "../commons/CtrlPacket";
import { TunnelControlHandler, TunnelDataHandler } from "../types/TunnelHandler";
import { Buffer } from "buffer";
import { SysInfo } from "../commons/SysMonitor";
interface OnSessionCloseCallback {
    (id: number, endLength: number): void;
}
interface OnDataReceiveCallback {
    (sessionID: number, data: Buffer): void;
}
declare class ClientHandlerPool {
    private static LAST_DATA_HANDLER_ID;
    private readonly _createTime;
    private readonly _remoteAddress;
    private readonly _id;
    private readonly _controlHandler;
    private _name;
    private _activatedSessionHandlerMap_;
    private _waitingDataBufferQueueMap;
    private _bufferSize;
    private _pendingSessionIDMap;
    private _onSessionCloseCallback?;
    private _onDataReceiveCallback?;
    private _sysInfo;
    static create(id: number, controlHandler: SocketHandler): ClientHandlerPool;
    private constructor();
    endDataHandler(handler: TunnelDataHandler): void;
    get sysInfo(): SysInfo;
    set onSessionCloseCallback(callback: OnSessionCloseCallback);
    set onReceiveDataCallback(callback: OnDataReceiveCallback);
    get createTime(): number;
    get address(): string;
    get activatedSessionCount(): number;
    get pendingSessionCount(): number;
    /**
     * 데이터 핸들러가 세션을 닫으라는 명령을 받았을때 호출된다.
     * @param sessionID
     * @param endLength
     * @private
     */
    private closeSessionAndCallback;
    putNewDataHandler(dataHandler: TunnelDataHandler): void;
    isSessionOpened(sessionID: number): boolean;
    /**
     * 세션이 열린직후 호출된다.
     * End point server 에 연결 직전까지 External port server 에서 받은 데이터를 버퍼에 저장했다가,
     * 세션이 열리면 일괄 전송한다.
     * @param sessionID
     * @private
     */
    private flushWaitBuffer;
    pushReceiveBuffer(sessionID: number, data: Buffer): boolean;
    private findSessionIDByDataHandler;
    set name(name: string);
    get id(): number;
    get name(): string;
    getAllSessionIDs(): Array<number>;
    sendConnectEndPoint(sessionID: number, opt: OpenOpt): void;
    /**
     * TunnelServer 에서 CtrlHandler 에 대한 데이터 이벤트를 받아서 처리한다.
     * @param handler
     * @param packet
     */
    delegateReceivePacketOfControlHandler(handler: TunnelControlHandler, packet: CtrlPacket): void;
    private burnWaitBuffer;
    /**
     * 데이터 핸들러 상태를 'OnlineSession' 또는 'Wait' 으로 변경한다.
     * 만약 세션 연결에 성공하면 'OnlineSession' 으로 변경하고, 실패하면 'Wait' 으로 변경한다.
     * @param handlerID
     * @param sessionID
     * @param connected
     * @private
     */
    private promoteDataHandler;
    /**
     * 데이터를 전송한다. 만약 세션이 존재하지 않으면 false를 반환한다.
     * @param sessionID
     * @param data
     */
    sendBuffer(sessionID: number, data: Buffer): boolean;
    sendSuccessOpenSessionAck(sessionID: number): void;
    /**
     * ExternalPortServer 로부터 세션을 닫으라는 명령을 받았을때 호출된다. (ExternalPortServer 의 핸들러가 close 될 때)
     * @param sessionID
     * @param waitForLength
     */
    sendCloseSession(sessionID: number, waitForLength: number): void;
    /**
     * 컨트롤 핸들러로부터 세션을 닫으라는 명령을 받았을때 호출된다.
     * @param handlerID
     * @param sessionID
     * @param endLength
     */
    private releaseSession_;
    /**
     * 새로운 데이터 핸들러를 만들고, 컨트롤러 핸들러에게 세션을 열라는 명령을 보낸다.
     * @param dataHandlerID 새로운 데이터 핸들러의 ID
     * @param sessionId 세션 ID
     * @private
     */
    private sendNewDataHandler;
    terminateSession(sessionID: number): void;
    /**
     * 사용 가능한 데이터 핸들러가 있는 상황에서, 컨트롤러 핸들러에게 세션을 열라는 명령을 보낸다.=
     * @param dataHandlerID 데이터 핸들러 ID
     * @param sessionId 세션 ID
     * @param opt 세션 옵션
     * @private
     */
    private sendConnectEndPointPacket;
    end(): void;
}
export { ClientHandlerPool };
