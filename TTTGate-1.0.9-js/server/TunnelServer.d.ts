/// <reference types="node" />
import { OpenOpt } from "../commons/CtrlPacket";
import { Buffer } from "buffer";
import { CertInfo } from "./CertificationStore";
import { SysInfo } from "../commons/SysMonitor";
interface OnReceiveDataCallback {
    (id: number, data: Buffer): void;
}
interface OnSessionCloseCallback {
    (id: number, endLength: number): void;
}
interface ClientStatus {
    id: number;
    name: string;
    uptime: number;
    address: string;
    activeSessionCount: number;
}
declare class TunnelServer {
    private readonly _serverOption;
    private _clientHandlerPoolMap;
    private _sessionIDAndCtrlIDMap;
    private _tunnelServer;
    private readonly _key;
    private isRunning;
    private _heartbeatInterval;
    private _nextSelectIdx;
    private _onSessionCloseCallback?;
    private _onReceiveDataCallback?;
    set onSessionCloseCallback(value: OnSessionCloseCallback);
    set onReceiveDataCallback(value: OnReceiveDataCallback);
    private constructor();
    static create(option: {
        port: number;
        tls: boolean;
        key: string;
        keepAlive: number;
    }, certInfo: CertInfo): TunnelServer;
    get port(): number;
    get tls(): boolean;
    start(): Promise<void>;
    /**
     * 클라이언트 체크 인터벌을 종료한다.
     * @private
     */
    private stopClientCheckInterval;
    clientStatuses(): Array<ClientStatus>;
    /**
     * 서버를 종료한다.
     */
    close(): Promise<void>;
    /**
     * 해당 세션의 데이터를 전송한다.
     * 세션에 할당된 데이터 핸들러를 찾아서 데이터를 전송한다.
     * @param sessionId 세션ID
     * @param buffer 전송할 데이터
     * @return 성공여부
     */
    sendBuffer(sessionId: number, buffer: Buffer): boolean;
    /**
     * 세션을 연다.
     * @param sessionID 새로운 세션ID
     * @param opt 연결할 End Point 서버에 대한 정보.
     * @param allowClientNames 허용할 클라이언트 이름 목록. 목록에 포함된 클라이언트만 세션을 연다. 목록이 없으면 모든 클라이언트를 허용한다.
     */
    openSession(sessionID: number, opt: OpenOpt, allowClientNames?: Array<string>): boolean;
    private available;
    private getNextHandlerPool;
    private onServerEvent;
    private onClientHandlerBound;
    private sendSyncCtrlAck;
    private promoteToCtrlHandler;
    private onReceiveAllHandler;
    /**
     * 데이터 핸들러에서 데이터를 받았을때 호출된다.
     * @param handler
     * @param data
     * @private
     */
    private onReceiveDataHandler;
    private findClientHandlerPool;
    /**
     * 컨트롤 핸들러에서 데이터를 받았을때 호출된다.
     * @param handler
     * @param data
     * @private
     */
    private onReceiveCtrlHandler;
    terminateSession(sessionId: number): void;
    private findCtrlHandlerPool;
    closeSession(sessionId: number, waitForLength: number): void;
    private onReceiveCtrlPacket;
    private notMatchedAuthKey;
    /**
     * 클라이언트 핸들러로부터 이벤트를 받았을때 호출된다.
     * Receive 이벤트는 클라이언트로부터 데이터를 받았을때 호출된다.
     * 그 외에는 close 이벤트가 호출된다.
     * @param handler
     * @param state
     * @param data
     */
    private onHandlerEvent;
    private endDataHandler;
    /**
     * 핸들러 풀에서 인자로 받은 ctrlID 에 대항하는 풀을 제거하고, 내부의 모든 세션 종료 메시지를 보낸 후에 연결을 종료한다.
     * @param ctrlID
     * @private
     */
    private destroyClientHandlerPool;
    getClientSysInfo(clientID: number): SysInfo | undefined;
}
export { TunnelServer, ClientStatus };
