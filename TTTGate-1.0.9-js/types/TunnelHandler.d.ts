/// <reference types="node" />
import { SocketHandler } from "../util/SocketHandler";
import { CtrlPacketStreamer } from "../commons/CtrlPacket";
declare enum CtrlState {
    Connected = /** 서버와 연결 완료 */ 0,
    Syncing = /** 서버와 연결 완료 후 Sync 패킷을 보내는중 */ 1
}
declare enum DataHandlerState {
    None = /** 초기 상태 */ 0,
    Initializing = /** 서버와 연결하여 자신이 데이터 핸들러 라는 것을 알리는중 */ 1,
    ConnectingEndPoint = /** 서버와 연결은 되어있고 세션도 있지만 엔드포인트와 연결중 */ 2,
    OnlineSession = /** 서버와 연결은 되어있고 세션도 있고 엔드포인트와 연결 완료 */ 3,
    Terminated = 4 /** 종료됨 */
}
declare enum HandlerType {
    Control = 0,
    Data = 1,
    Unknown = 2
}
type TunnelHandler = SocketHandler & {
    handlerType?: HandlerType;
    initialized?: boolean;
};
type TunnelControlHandler = TunnelHandler & {
    packetStreamer?: CtrlPacketStreamer;
    handlerType?: HandlerType.Control;
    ctrlState?: CtrlState;
};
type TunnelDataHandler = TunnelHandler & {
    sessionID?: number;
    handlerID?: number;
    ctrlID?: number;
    leftOverBuffer?: Buffer;
    dataHandlerState?: DataHandlerState;
    handlerType?: HandlerType.Data;
};
export { DataHandlerState, HandlerType, TunnelHandler, TunnelDataHandler, TunnelControlHandler, CtrlState };
