import BufferWriter from "../util/BufferWriter";
import BufferReader from "../util/BufferReader";
import ConnectOpt from "../util/ConnectOpt";
import Dequeue from "../util/Dequeue";
import {AckCtrlV2Meta, HandlerWideIdMeta, NewDataHandlerMeta, SyncCtrlAckMeta} from "./ProtocolV2";
import {
    assertAckCtrlV2Meta,
    assertHandlerWideIdMeta,
    assertMessageMeta,
    assertNewDataHandlerMeta,
    assertSyncCtrlAckMeta,
    safeJsonParse
} from "./CtrlMetaGuards";


enum ParsedState {
    Complete,
    Incomplete,
    Error
}


type ParsingResult = {
    packet: CtrlPacket | null,
    remain: Buffer
    state : ParsedState
    error: any

}

interface OpenOpt extends ConnectOpt {
    bufferLimit: number
}


enum CtrlCmd {
    // Server -> Client : SyncCtrl 클라이언트 최초 연결시 TunnelServer에서 보내는 패킷
    SyncCtrl,
    // Client -> Server : SyncCtrl 응답
    SyncCtrlAck,
    AckCtrl,
    OpenSession,
    CloseSession,
    NewDataHandler,
    FailOfOpenSession,
    SuccessOfOpenSession,
    SuccessOfOpenSessionAck,
    Message,
    NonExistent

}

// R2-REQ-01: MAX_PAYLOAD_SIZE는 **순수 페이로드 바이트 한도** (헤더 제외).
// 송·수신 양쪽에서 data 길이 자체에 적용되며, 헤더 길이(HEADER_LEN)는 별도 검사.
const MAX_PAYLOAD_SIZE = 64000;

class CtrlPacket {

    public static readonly PACKET_DELIMITER = 'C';

    private static readonly EMPTY_BUFFER = Buffer.alloc(0);
    public static readonly PREFIX = Buffer.from("CTRL");
    public static readonly PREFIX_LEN = Buffer.byteLength(CtrlPacket.PREFIX);
    // 4 bytes - prefix
    // 1 byte - command
    // 2 bytes - ctrl id
    // 4 bytes - session id
    // 4 bytes - data length
    public static readonly HEADER_LEN = CtrlPacket.PREFIX_LEN + 1 + 2 + 4 + 4;

    private _cmd: CtrlCmd;
    private _data: Buffer = Buffer.alloc(0);
    private _ID: number = 0;
    private _sessionID: number = 0;
    private _ackCtrlOpt: {name: string, key: string, v2?: AckCtrlV2Meta} | undefined = undefined;

    private _openOpt : OpenOpt | undefined = undefined;


    public get waitReceiveLength() : number {
        if(this._cmd != CtrlCmd.CloseSession) {
            return 0;
        }
        return this._data.readUInt32BE(0);
    }


    public static createSyncCtrl() : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.SyncCtrl;
        return packet;
    }

    public static createSyncCtrlAck(id: number, meta?: SyncCtrlAckMeta) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.SyncCtrlAck;
        packet._ID = id;
        if(meta) {
            packet._data = Buffer.from(JSON.stringify(meta), "utf-8");
        }
        return packet;
    }


    public static message(id: number, message: { type: string, payload: object | string }) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.Message;
        packet._ID = id;
        packet._data = Buffer.from(JSON.stringify(message));
        return packet;
    }

    public static getMessageFromPacket(packet : CtrlPacket) : { type: string, payload: object | string } {
        if(packet._cmd != CtrlCmd.Message) {
            throw new Error("Invalid packet type");
        }
        // R2-REQ-04: 가드 + prototype pollution 차단.
        return safeJsonParse(packet._data, assertMessageMeta);
    }



    public static createAckCtrl(id: number,name: string, key: string, v2?: AckCtrlV2Meta) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.AckCtrl;
        packet._ID = id;
        packet._ackCtrlOpt = {name, key, v2};
        let writer = new BufferWriter();
        writer.writeString(name);
        writer.writeString(key);
        if(v2) {
            writer.writeString(JSON.stringify(v2));
        }
        packet._data = writer.toBuffer();
        return packet;
    }

    public static closeSession(handlerID: number, sessionID: number, waitReceiveLength: number, meta?: HandlerWideIdMeta) : CtrlPacket {
        let packet = CtrlPacket.createNoDataPacket(CtrlCmd.CloseSession, handlerID, sessionID, meta);
        packet._data = Buffer.alloc(4);
        packet._data.writeUInt32BE(waitReceiveLength);
        if(meta) {
            packet._data = Buffer.concat([packet._data, Buffer.from(JSON.stringify(meta), "utf-8")]);
        }
        return packet;
    }


    /**
     * 새로운 데이터 핸들러 만들기와 동시에 커넥션을 열기를 요청하는 패킷을 만든다.
     * 서버에서 클라이언트로 보내는 패킷이다.
     * @param ctrlID 컨드롤 핸들러 ID
     * @param sessionID 세션 핸들러 ID
     * @param opt
     */
    public static newDataHandler(ctrlID: number, sessionID: number, meta?: NewDataHandlerMeta) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.NewDataHandler;
        packet._ID = ctrlID;
        packet._sessionID = sessionID;
        if(meta) {
            packet._data = Buffer.from(JSON.stringify(meta), "utf-8");
        }
        return packet;
    }


    public static resultOfOpenSession(handlerID: number, sessionID: number, isSuccess: boolean, meta?: HandlerWideIdMeta) : CtrlPacket {
        return CtrlPacket.createNoDataPacket(!isSuccess ? CtrlCmd.FailOfOpenSession : CtrlCmd.SuccessOfOpenSession, handlerID, sessionID, meta);
    }

    public static resultOfOpenSessionAck(handlerID: number, sessionID: number, meta?: HandlerWideIdMeta) : CtrlPacket {
        return CtrlPacket.createNoDataPacket(CtrlCmd.SuccessOfOpenSessionAck, handlerID, sessionID, meta);
    }


    private static createNoDataPacket(cmd: CtrlCmd, ctrlID: number, sessionID: number, meta?: HandlerWideIdMeta) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = cmd;
        packet._ID = ctrlID;
        packet._sessionID = sessionID;
        packet._data = meta ? Buffer.from(JSON.stringify(meta), "utf-8") : CtrlPacket.EMPTY_BUFFER;
        return packet;
    }




    public static connectEndPoint(ctrlID: number, sessionID: number, opt: OpenOpt) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.OpenSession;
        packet._sessionID = sessionID;
        packet._ID = ctrlID;
        packet._openOpt = opt;

        opt.tls = opt.tls == undefined ? false : opt.tls;
        //opt.protocol = opt.protocol || "tcp";
        let writer = new BufferWriter();
        writer.writeString(opt.host);
        writer.writeUInt16(opt.port);
        writer.writeBoolean(opt.tls);
        writer.writeInt32(opt.bufferLimit);
        //writer.writeString(opt.protocol);
        packet._data = writer.toBuffer();
        return packet;
    }

    public get ackKey() : string | undefined {
        return this._ackCtrlOpt?.key;
    }

    public get clientName() : string | undefined {
        return this._ackCtrlOpt?.name;
    }

    public get ackCtrlV2Meta() : AckCtrlV2Meta | undefined {
        return this._ackCtrlOpt?.v2;
    }

    public get syncCtrlAckMeta() : SyncCtrlAckMeta | undefined {
        if(this._cmd != CtrlCmd.SyncCtrlAck || this._data.length == 0) {
            return undefined;
        }
        // R2-REQ-04: 가드 적용.
        return safeJsonParse(this._data, assertSyncCtrlAckMeta);
    }

    public get newDataHandlerMeta() : NewDataHandlerMeta | undefined {
        if(this._cmd != CtrlCmd.NewDataHandler || this._data.length == 0) {
            return undefined;
        }
        // R2-REQ-04: 가드 적용.
        return safeJsonParse(this._data, assertNewDataHandlerMeta);
    }

    public get handlerWideIdMeta() : HandlerWideIdMeta | undefined {
        if(
            this._cmd == CtrlCmd.FailOfOpenSession
            || this._cmd == CtrlCmd.SuccessOfOpenSession
            || this._cmd == CtrlCmd.SuccessOfOpenSessionAck
        ) {
            if(this._data.length == 0) {
                return undefined;
            }
            // R2-REQ-04: 가드 적용 (3개 CtrlCmd 공용).
            return safeJsonParse(this._data, assertHandlerWideIdMeta);
        }
        if(this._cmd == CtrlCmd.CloseSession) {
            if(this._data.length <= 4) {
                return undefined;
            }
            // R2-REQ-04: 가드 적용 (CloseSession은 앞 4B가 waitReceiveLength).
            return safeJsonParse(this._data.subarray(4), assertHandlerWideIdMeta);
        }
        return undefined;
    }



    public static fromBuffer(buffer: Buffer) : ParsingResult {
        let result = new CtrlPacket();
        let emptyBuffer = CtrlPacket.EMPTY_BUFFER;
        if(buffer.length < CtrlPacket.HEADER_LEN) {
            return {packet: null, remain: emptyBuffer, state: ParsedState.Incomplete, error: null};
        }
        let reader = new BufferReader(buffer);
        let prefix = reader.readBuffer(CtrlPacket.PREFIX_LEN);
        if(prefix.compare(CtrlPacket.PREFIX) !== 0) {
            return {packet: null, remain: emptyBuffer, state: ParsedState.Error, error: new Error("Invalid prefix")};
        }
        result._cmd = reader.readUInt8();
        if(result._cmd < CtrlCmd.SyncCtrl || result._cmd >= CtrlCmd.NonExistent) {
            return {packet: null, remain: emptyBuffer, state: ParsedState.Error, error: new Error("Invalid command")};
        }
        result._ID = reader.readUInt16();
        result._sessionID = reader.readUInt32();
        let dataLength = reader.readUInt32();
        // R2-REQ-01: 순수 페이로드 한도 (헤더 제외). NF-03-eval1: this.HEADER_LEN dead 참조 제거.
        if(dataLength > MAX_PAYLOAD_SIZE) {
            return {packet: null, remain: emptyBuffer, state: ParsedState.Error, error: new Error("Data length too large")};
        }
        if(result._cmd == CtrlCmd.SyncCtrl && dataLength != 0) {
            return {packet: null, remain: emptyBuffer, state: ParsedState.Error, error: new Error("SyncCtrl must have empty data")};
        }
        if(buffer.length < CtrlPacket.HEADER_LEN + dataLength) {
            return {packet: null, remain: emptyBuffer, state: ParsedState.Incomplete,  error: null};
        }
        result._data = reader.readBuffer(dataLength);
        if(result._cmd == CtrlCmd.AckCtrl) {
            result._ackCtrlOpt = CtrlPacket.parseAckCtrlData(result._data);

        } else if(result._cmd == CtrlCmd.OpenSession) {
            result._openOpt = CtrlPacket.parseOpenData(result._data);
        }
        return {packet: result, remain: reader.readBufferToEnd(), state: ParsedState.Complete,  error: null};
    }

    public get cmd() : CtrlCmd {
        return this._cmd;
    }

    public get sessionID() : number {
        return this._sessionID;
    }

    public get ID() : number {
        return this._ID;
    }

    public get data() : Buffer {
        return this._data;
    }

    public get openOpt() : OpenOpt | undefined {
        return this._openOpt;
    }

    private static parseOpenData(data: Buffer) : OpenOpt {
        let reader = new BufferReader(data);
        let host = reader.readString();
        let port = reader.readUInt16();
        let tls = reader.readBoolean();
        let bufferLimit = reader.readInt32();
        return {host, port,bufferLimit, tls: tls};
    }

    private static parseAckCtrlData(data: Buffer) :  {name: string, key: string, v2?: AckCtrlV2Meta}  {
        let reader = new BufferReader(data);
        let name = reader.readString();
        let key = reader.readString();
        if(reader.readable() > 0) {
            try {
                // R2-REQ-04: 가드 + prototype pollution 차단. 실패 시 기존 fallback 유지 (v2 없는 경우로 취급).
                let meta = safeJsonParse(reader.readString(), assertAckCtrlV2Meta);
                return {name, key, v2: meta};
            } catch {
                return {name, key};
            }
        }
        return {name, key};
    }


    public toBuffer() : Buffer {
        // R2-REQ-01: 송신 측 순수 페이로드 한도 가드.
        if(this._data.length > MAX_PAYLOAD_SIZE) {
            throw new RangeError(`CtrlPacket payload exceeds MAX_PAYLOAD_SIZE (${this._data.length} > ${MAX_PAYLOAD_SIZE})`);
        }
        let writer = new BufferWriter();
        writer.writeBuffer(CtrlPacket.PREFIX);
        writer.writeUInt8(this._cmd);
        writer.writeUInt16(this._ID & 0xffff);
        writer.writeUInt32(this._sessionID);
        writer.writeUInt32(this._data.length);
        writer.writeBuffer(this._data);
        return writer.toBuffer();
    }


}

type CtrlStreamerOptions = {
    onOverflow?: (err: Error) => void;
    maxPendingBytes?: number;
};

class CtrlPacketStreamer {

    // R2-REQ-03: 불완전 패킷 누적 DoS 방지. 기본 상한 = 헤더 + 페이로드*2.
    public static readonly DEFAULT_MAX_PENDING_BYTES = CtrlPacket.HEADER_LEN + MAX_PAYLOAD_SIZE * 2;

    private _dequeue : Dequeue<Buffer> = new Dequeue<Buffer>();
    private _pendingBytes : number = 0;
    private readonly _maxPendingBytes : number;
    private readonly _onOverflow : ((err: Error) => void) | undefined;

    public constructor(options?: CtrlStreamerOptions) {
        this._maxPendingBytes = options?.maxPendingBytes ?? CtrlPacketStreamer.DEFAULT_MAX_PENDING_BYTES;
        this._onOverflow = options?.onOverflow;
    }

    private _overflow(incoming: number) : Error {
        return new RangeError(`CtrlPacketStreamer pending bytes overflow (pending=${this._pendingBytes}, incoming=${incoming}, max=${this._maxPendingBytes})`);
    }

    private _handleOverflow(incoming: number) : void {
        const err = this._overflow(incoming);
        this._dequeue.clear();
        this._pendingBytes = 0;
        if(this._onOverflow) {
            this._onOverflow(err);
            return;
        }
        // NF-02: 기본 동작은 RangeError throw (하위 호환).
        throw err;
    }

    public feed(buffer: Buffer) : void {
        if(this._pendingBytes + buffer.length > this._maxPendingBytes) {
            this._handleOverflow(buffer.length);
            return;
        }
        this._dequeue.pushBack(buffer);
        this._pendingBytes += buffer.length;
    }

    private toPacketAtComplete(result: ParsingResult) : CtrlPacket {
        if(result.remain && result.remain.length > 0) {
            this._dequeue.pushFront(result.remain!);
            this._pendingBytes += result.remain.length;
        }
        return result.packet!;
    }

    private _popFront() : Buffer | undefined {
        const b = this._dequeue.popFront();
        if(b !== undefined) this._pendingBytes -= b.length;
        return b;
    }

    private _pushFront(b: Buffer) : void {
        this._dequeue.pushFront(b);
        this._pendingBytes += b.length;
    }

    public readPacket() : CtrlPacket | null {
        let buffer = this._popFront();
        if(buffer === undefined) {
            return null;
        }
        let result = CtrlPacket.fromBuffer(buffer);
        if(result.state == ParsedState.Complete) {
            return this.toPacketAtComplete(result);
        }
        else if(result.state == ParsedState.Incomplete && this._dequeue.isEmpty()) {
            this._pushFront(buffer);
            return null;
        }
        while(result.state == ParsedState.Incomplete && !this._dequeue.isEmpty()) {
            let nextBuffer = this._popFront()!;
            // R2-REQ-03: Buffer.concat 전 상한 재확인 (누적 공격 방어).
            if(buffer.length + nextBuffer.length > this._maxPendingBytes) {
                this._handleOverflow(nextBuffer.length);
                return null;
            }
            let newBuffer = Buffer.concat([buffer, nextBuffer]);
            result = CtrlPacket.fromBuffer(newBuffer);
            if(result.state == ParsedState.Incomplete && this._dequeue.isEmpty()) {
                this._pushFront(newBuffer);
                return null;
            } else if(result.state == ParsedState.Complete) {
                return this.toPacketAtComplete(result);
            }
            buffer = newBuffer;
        }

        throw result.error;
    }



    /**
     *
     * @param buffer
     * @returns CtrlPacket list. 만약 buffer에 여러개의 패킷이 들어있다면 여러개의 패킷을 반환한다. 아닐경우 빈 리스트를 반한한다.
     */
    public readCtrlPacketList(buffer: Buffer) : Array<CtrlPacket>{
        this.feed(buffer);
        let packets = new Array<CtrlPacket>();
        let packet : CtrlPacket | null = null;
        do {
            packet = this.readPacket();
            if(packet) packets.push(packet);
        } while (packet);
        return packets;
    }
 }

export { CtrlPacket, CtrlCmd, ParsedState, ParsingResult, CtrlPacketStreamer, OpenOpt};
