import BufferWriter from "../util/BufferWriter";
import BufferReader from "../util/BufferReader";
import ConnectOpt from "../util/ConnectOpt";
import Dequeue from "../util/Dequeue";


enum ParsedState {
    Complete,
    Incomplete,
    Error
}


type ParsingResult = {
    packet: CtrlPacket | null ,
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
    Open,
    Data,
    CloseSession,
    NewDataHandlerAndOpen,
    CreatedDataHandlerAndOpenSuccess,
    CreatedDataHandlerAndOpenFailed,

    NonExistent

}

const MAX_PAYLOAD_SIZE = 64000;

class CtrlPacket {

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
    private _ctrlID: number = -1;
    private _sessionID: number = -1;
    private _ackCtrlOpt: {name: string, key: string} | undefined = undefined;

    private _openOpt : OpenOpt | undefined = undefined;


    public static createSyncCtrl() : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.SyncCtrl;
        return packet;
    }

    public static createSyncCtrlAck(id: number) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.SyncCtrlAck;
        packet._ctrlID = id;
        return packet;
    }




    public static createAckCtrl(id: number,name: string, key: string) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.AckCtrl;
        packet._ctrlID = id;
        packet._ackCtrlOpt = {name, key};
        let writer = new BufferWriter();
        writer.writeString(name);
        writer.writeString(key);
        packet._data = writer.toBuffer();
        return packet;
    }

    public static createCloseSession(id: number) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.CloseSession;
        packet._sessionID = id;
        packet._data = CtrlPacket.EMPTY_BUFFER;
        return packet;
    }


    /**
     * 새로운 데이터 핸들러 만들기와 동시에 커넥션을 열기를 요청하는 패킷을 만든다.
     * 서버에서 클라이언트로 보내는 패킷이다.
     * @param sessionID
     * @param opt
     */
    public static createNewDataHandlerAndOpenPacket(ctrlID: number, sessionID: number, opt: OpenOpt) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.NewDataHandlerAndOpen;
        packet._ctrlID = ctrlID;
        packet._sessionID = sessionID;
        packet._openOpt = opt;
        let writer = new BufferWriter();
        writer.writeString(opt.host);
        writer.writeUInt16(opt.port);
        writer.writeBoolean(opt.tls ?? false);
        writer.writeInt32(opt.bufferLimit);
        packet._data = writer.toBuffer();
        return packet;
    }

    /**
     * 새로운 데이터 핸들러 만들기와 동시에 커넥션을 열기를 성공했다는 것을 알리는 패킷을 만든다.
     * 클라이언트에서 서버로 보내는 패킷이다.
     * @param clientID
     */
    public static createCreatedDataHandlerAndOpenSuccessPacket(clientID: number, sessionID: number) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.CreatedDataHandlerAndOpenSuccess;
        packet._ctrlID = clientID;
        packet._data = CtrlPacket.EMPTY_BUFFER;
        return packet;
    }




    public static createSessionData(sessionID: number, data: Buffer) : Array<CtrlPacket> {
        let packets = new Array<CtrlPacket>();
        let offset = 0;
        while(offset < data.length) {
            let packet = new CtrlPacket();
            packet._cmd = CtrlCmd.Data;
            packet._sessionID = sessionID;
            let length = Math.min(data.length - offset, MAX_PAYLOAD_SIZE);
            packet._data = data.subarray(offset, offset + length);
            offset += length;
            packets.push(packet);
        }
        return packets;
    }


    public static createOpenSessionEndPoint(ctrlID: number, sessionID: number, opt: OpenOpt) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.Open;
        packet._sessionID = sessionID;
        packet._ctrlID = ctrlID;
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
        result._ctrlID = reader.readUInt16();
        result._sessionID = reader.readUInt32();
        let dataLength = reader.readUInt32();
        // unt32 max value
        if(dataLength > MAX_PAYLOAD_SIZE + this.HEADER_LEN) {
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

        } else if(result._cmd == CtrlCmd.Open) {
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

    public get ctrlID() : number {
        return this._ctrlID;
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

    private static parseAckCtrlData(data: Buffer) :  {name: string, key: string}  {
        let reader = new BufferReader(data);
        let name = reader.readString();
        let key = reader.readString();
        return {name, key};
    }


    public toBuffer() : Buffer {
        let writer = new BufferWriter();
        writer.writeBuffer(CtrlPacket.PREFIX);
        writer.writeUInt8(this._cmd);
        writer.writeUInt16(this._ctrlID);
        writer.writeUInt32(this._sessionID);
        writer.writeUInt32(this._data.length);
        writer.writeBuffer(this._data);
        return writer.toBuffer();
    }


}

class CtrlPacketStreamer {

    private _dequeue : Dequeue<Buffer> = new Dequeue<Buffer>();

    public feed(buffer: Buffer) : void {
        this._dequeue.pushBack(buffer);
    }

    private toPacketAtComplete(result: ParsingResult) : CtrlPacket {
        if(result.remain && result.remain.length > 0) {
            this._dequeue.pushFront(result.remain!);
        }
        return result.packet!;
    }

    public readPacket() : CtrlPacket | null {
        let buffer = this._dequeue.popFront();
        if(buffer === undefined) {
            return null;
        }
        let result = CtrlPacket.fromBuffer(buffer);
        if(result.state == ParsedState.Complete) {
            return this.toPacketAtComplete(result);
        }
        else if(result.state == ParsedState.Incomplete && this._dequeue.isEmpty()) {
            this._dequeue.pushFront(buffer);
            return null;
        }
        while(result.state == ParsedState.Incomplete && !this._dequeue.isEmpty()) {
            let newBuffer = this._dequeue.popFront()!;
            newBuffer = Buffer.concat([buffer, newBuffer!]);
            result = CtrlPacket.fromBuffer(newBuffer);
            if(result.state == ParsedState.Incomplete && this._dequeue.isEmpty()) {
                this._dequeue.pushFront(newBuffer);
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