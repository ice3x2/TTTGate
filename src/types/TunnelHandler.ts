import {SocketHandler} from "../util/SocketHandler";
import {CtrlPacketStreamer} from "../commons/CtrlPacket";
import {ControlProtocolMode} from "../types/TunnelingOption";


enum CtrlState {
    Connected,  /** 서버와 연결 완료 */
    Syncing, /** 서버와 연결 완료 후 Sync 패킷을 보내는중 */
}


enum DataHandlerState {
    None, /** 초기 상태 */
    Initializing, /** 서버와 연결하여 자신이 데이터 핸들러 라는 것을 알리는중 */
    ConnectingEndPoint, /** 서버와 연결은 되어있고 세션도 있지만 엔드포인트와 연결중 */
    OnlineSession, /** 서버와 연결은 되어있고 세션도 있고 엔드포인트와 연결 완료 */
    Terminated /** 종료됨 */
}

enum HandlerType {
    Control,
    Data,
    Unknown
}


type TunnelHandler = SocketHandler & {
    handlerType?: HandlerType;
    initialized?: boolean;
}

type TunnelControlHandler = TunnelHandler & {
    packetStreamer?: CtrlPacketStreamer;
    handlerType?: HandlerType.Control;
    ctrlState?: CtrlState;
    clientId?: string;
    displayName?: string;
    protocolVersion?: number;
    capabilities?: string[];
    controlProtocolMode?: ControlProtocolMode;
}

type TunnelDataHandler = TunnelHandler & {
    sessionID?: number;
    handlerID?: number;
    ctrlID?: number;
    bindingToken?: string;
    leftOverBuffer?: Buffer;
    dataHandlerState?: DataHandlerState;
    handlerType?: HandlerType.Data;
    /** #253: 이 데이터 연결에서 받아 외부 쪽으로 넘긴 바이트 수. 연결이 끊기면 외부 쪽 종료 길이로 쓴다. */
    forwardedLength?: number;
    /** #253: 클라이언트가 이 세션의 CloseSession 을 보냈다. 뒤이은 데이터 연결의 끊김은 정상 종료다. */
    closeReceived?: boolean;
    /** #254: (클라이언트) 출력이 빌 때 끝점을 닫으려고 기다리는 CloseSession 의 count. 기다리는 동안만 값이 있다. */
    pendingCloseCount?: number;
    /** #257: (클라이언트) 정상 종료를 대기 버퍼를 다 보낸 뒤로 미뤘다. Ack 뒤 flush 가 끝나면 닫는다. */
    endAfterFlush?: boolean;
}



export {
    DataHandlerState,
    HandlerType,
    TunnelHandler,
    TunnelDataHandler,
    TunnelControlHandler,
    CtrlState
}
