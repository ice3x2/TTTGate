import {SocketHandler} from "../util/SocketHandler";
import {CtrlPacketStreamer} from "../commons/CtrlPacket";


enum CtrlState {
    None, /** 초기 상태 */
    Connecting, /** 서버와 연결중 */
    Connected,  /** 서버와 연결 완료 */
    Syncing, /** 서버와 연결 완료 후 Sync 패킷을 보내는중 */
    halfOpened, /** 서버 전용: */
}


enum DataHandlerState {
    None, /** 초기 상태 */
    Wait, /** 서버와 연결은 되어있지만 세션은 없음 */
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
    ctrlID?: number;
}

type TunnelDataHandler = TunnelHandler & {
    sessionID?: number;
    handlerID?: number;
    ctrlID?: number;
    leftOverBuffer?: Buffer;
    dataHandlerState?: DataHandlerState;
    handlerType?: HandlerType.Data;
}



export {
    DataHandlerState,
    HandlerType,
    TunnelHandler,
    TunnelDataHandler,
    TunnelControlHandler,
    CtrlState
}


