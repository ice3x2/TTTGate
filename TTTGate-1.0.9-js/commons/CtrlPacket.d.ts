/// <reference types="node" />
import ConnectOpt from "../util/ConnectOpt";
declare enum ParsedState {
    Complete = 0,
    Incomplete = 1,
    Error = 2
}
type ParsingResult = {
    packet: CtrlPacket | null;
    remain: Buffer;
    state: ParsedState;
    error: any;
};
interface OpenOpt extends ConnectOpt {
    bufferLimit: number;
}
declare enum CtrlCmd {
    SyncCtrl = 0,
    SyncCtrlAck = 1,
    AckCtrl = 2,
    OpenSession = 3,
    CloseSession = 4,
    NewDataHandler = 5,
    FailOfOpenSession = 6,
    SuccessOfOpenSession = 7,
    SuccessOfOpenSessionAck = 8,
    Message = 9,
    NonExistent = 10
}
declare class CtrlPacket {
    static readonly PACKET_DELIMITER = "C";
    private static readonly EMPTY_BUFFER;
    static readonly PREFIX: Buffer;
    static readonly PREFIX_LEN: number;
    static readonly HEADER_LEN: number;
    private _cmd;
    private _data;
    private _ID;
    private _sessionID;
    private _ackCtrlOpt;
    private _openOpt;
    get waitReceiveLength(): number;
    static createSyncCtrl(): CtrlPacket;
    static createSyncCtrlAck(id: number): CtrlPacket;
    static message(id: number, message: {
        type: string;
        payload: object | string;
    }): CtrlPacket;
    static getMessageFromPacket(packet: CtrlPacket): {
        type: string;
        payload: object | string;
    };
    static createAckCtrl(id: number, name: string, key: string): CtrlPacket;
    static closeSession(handlerID: number, sessionID: number, waitReceiveLength: number): CtrlPacket;
    /**
     * 새로운 데이터 핸들러 만들기와 동시에 커넥션을 열기를 요청하는 패킷을 만든다.
     * 서버에서 클라이언트로 보내는 패킷이다.
     * @param ctrlID 컨드롤 핸들러 ID
     * @param sessionID 세션 핸들러 ID
     * @param opt
     */
    static newDataHandler(ctrlID: number, sessionID: number): CtrlPacket;
    static resultOfOpenSession(handlerID: number, sessionID: number, isSuccess: boolean): CtrlPacket;
    static resultOfOpenSessionAck(handlerID: number, sessionID: number): CtrlPacket;
    private static createNoDataPacket;
    static connectEndPoint(ctrlID: number, sessionID: number, opt: OpenOpt): CtrlPacket;
    get ackKey(): string | undefined;
    get clientName(): string | undefined;
    static fromBuffer(buffer: Buffer): ParsingResult;
    get cmd(): CtrlCmd;
    get sessionID(): number;
    get ID(): number;
    get data(): Buffer;
    get openOpt(): OpenOpt | undefined;
    private static parseOpenData;
    private static parseAckCtrlData;
    toBuffer(): Buffer;
}
declare class CtrlPacketStreamer {
    private _dequeue;
    feed(buffer: Buffer): void;
    private toPacketAtComplete;
    readPacket(): CtrlPacket | null;
    /**
     *
     * @param buffer
     * @returns CtrlPacket list. 만약 buffer에 여러개의 패킷이 들어있다면 여러개의 패킷을 반환한다. 아닐경우 빈 리스트를 반한한다.
     */
    readCtrlPacketList(buffer: Buffer): Array<CtrlPacket>;
}
export { CtrlPacket, CtrlCmd, ParsedState, ParsingResult, CtrlPacketStreamer, OpenOpt };
