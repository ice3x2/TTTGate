import BufferWriter from "../util/BufferWriter";
import BufferReader from "../util/BufferReader";
import {ConnectOpt} from "../option/ConnectOpt";
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


enum CtrlCmd {
    // Server -> Client : SyncCtrl 클라이언트 최초 연결시 TunnelServer에서 보내는 패킷
    SyncCtrl,
    // Client -> Server : SyncCtrl 응답
    SyncSyncCtrl,
    AckCtrl,

    Open,
    Synchronized,
    Data,
    Close,
    Failed
}

class CtrlPacket {

    private static readonly EMPTY_BUFFER = Buffer.alloc(0);
    public static readonly PREFIX = Buffer.from("CTRL");
    public static readonly PREFIX_LEN = Buffer.byteLength(CtrlPacket.PREFIX);
    // 4 bytes - prefix
    // 1 byte - command
    // 4 bytes - id
    // 4 bytes - data length
    public static readonly HEADER_LEN = CtrlPacket.PREFIX_LEN + 1 + 4 + 4;

    private _cmd: CtrlCmd;
    private _data: Buffer = Buffer.alloc(0);
    private _id: number = -1;
    private _ackCtrlOpt: {ip: string, key: string} | undefined = undefined;

    private _openOpt : ConnectOpt | undefined = undefined;


    public static createSyncCtrl(id: number) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.SyncCtrl;
        packet._id = id;
        return packet;
    }

    public static createSyncSyncCtrl(id: number) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.SyncSyncCtrl;
        packet._id = id;
        return packet;
    }


    public static createSynchronized(id: number) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.Synchronized;
        packet._id = id;
        return packet;
    }

    public static createFailed(id: number) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.Failed;
        packet._id = id;
        return packet;
    }


    public static createAckCtrl(id: number,ip: string, key: string) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.AckCtrl;
        packet._id = id;
        packet._ackCtrlOpt = {ip, key};
        let writer = new BufferWriter();
        writer.writeString(ip);
        writer.writeString(key);
        packet._data = writer.toBuffer();
        return packet;
    }

    public static createCloseCtrl(id: number) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.Close;
        packet._id = id;
        packet._data = CtrlPacket.EMPTY_BUFFER;
        return packet;
    }

    public static createDataCtrl(id: number, data: Buffer) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.Data;
        packet._id = id;
        packet._data = data;
        return packet;
    }

    public static createOpen( id: number, opt: ConnectOpt) : CtrlPacket {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.Open;
        packet._id = id;
        packet._openOpt = opt;

        opt.tls = opt.tls == undefined ? false : opt.tls;
        //opt.protocol = opt.protocol || "tcp";
        let writer = new BufferWriter();
        writer.writeString(opt.host);
        writer.writeUInt16(opt.port);
        writer.writeBoolean(opt.tls);
        //writer.writeString(opt.protocol);
        packet._data = writer.toBuffer();
        return packet;
    }

    public get ackKey() : string | undefined {
        return this._ackCtrlOpt?.key;
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
        if(result._cmd < CtrlCmd.SyncCtrl || result._cmd > CtrlCmd.Failed) {
            return {packet: null, remain: emptyBuffer, state: ParsedState.Error, error: new Error("Invalid command")};
        }
        result._id = reader.readUInt32();
        let dataLength = reader.readUInt32();
        // unt32 max value
        if(dataLength > 4294967295) {
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

    public get id() : number {
        return this._id;
    }

    public get data() : Buffer {
        return this._data;
    }

    public get openOpt() : ConnectOpt | undefined {
        return this._openOpt;
    }

    private static parseOpenData(data: Buffer) : ConnectOpt {
        let reader = new BufferReader(data);
        let host = reader.readString();
        let port = reader.readUInt16();
        let tls = reader.readBoolean();
        return {host, port, tls: tls};
    }

    private static parseAckCtrlData(data: Buffer) :  {ip: string, key: string}  {
        let reader = new BufferReader(data);
        let ip = reader.readString();
        let key = reader.readString();
        return {ip, key};
    }


    public toBuffer() : Buffer {
        let writer = new BufferWriter();
        writer.writeBuffer(CtrlPacket.PREFIX);
        writer.writeUInt8(this._cmd);
        writer.writeUInt32(this._id);
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

export { CtrlPacket, CtrlCmd, ParsedState, ParsingResult, CtrlPacketStreamer};