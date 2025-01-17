"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CtrlPacketStreamer = exports.ParsedState = exports.CtrlCmd = exports.CtrlPacket = void 0;
const BufferWriter_1 = __importDefault(require("../util/BufferWriter"));
const BufferReader_1 = __importDefault(require("../util/BufferReader"));
const Dequeue_1 = __importDefault(require("../util/Dequeue"));
var ParsedState;
(function (ParsedState) {
    ParsedState[ParsedState["Complete"] = 0] = "Complete";
    ParsedState[ParsedState["Incomplete"] = 1] = "Incomplete";
    ParsedState[ParsedState["Error"] = 2] = "Error";
})(ParsedState || (exports.ParsedState = ParsedState = {}));
var CtrlCmd;
(function (CtrlCmd) {
    // Server -> Client : SyncCtrl 클라이언트 최초 연결시 TunnelServer에서 보내는 패킷
    CtrlCmd[CtrlCmd["SyncCtrl"] = 0] = "SyncCtrl";
    // Client -> Server : SyncCtrl 응답
    CtrlCmd[CtrlCmd["SyncCtrlAck"] = 1] = "SyncCtrlAck";
    CtrlCmd[CtrlCmd["AckCtrl"] = 2] = "AckCtrl";
    CtrlCmd[CtrlCmd["OpenSession"] = 3] = "OpenSession";
    CtrlCmd[CtrlCmd["CloseSession"] = 4] = "CloseSession";
    CtrlCmd[CtrlCmd["NewDataHandler"] = 5] = "NewDataHandler";
    CtrlCmd[CtrlCmd["FailOfOpenSession"] = 6] = "FailOfOpenSession";
    CtrlCmd[CtrlCmd["SuccessOfOpenSession"] = 7] = "SuccessOfOpenSession";
    CtrlCmd[CtrlCmd["SuccessOfOpenSessionAck"] = 8] = "SuccessOfOpenSessionAck";
    CtrlCmd[CtrlCmd["Message"] = 9] = "Message";
    CtrlCmd[CtrlCmd["NonExistent"] = 10] = "NonExistent";
})(CtrlCmd || (exports.CtrlCmd = CtrlCmd = {}));
const MAX_PAYLOAD_SIZE = 64000;
class CtrlPacket {
    static PACKET_DELIMITER = 'C';
    static EMPTY_BUFFER = Buffer.alloc(0);
    static PREFIX = Buffer.from("CTRL");
    static PREFIX_LEN = Buffer.byteLength(CtrlPacket.PREFIX);
    // 4 bytes - prefix
    // 1 byte - command
    // 2 bytes - ctrl id
    // 4 bytes - session id
    // 4 bytes - data length
    static HEADER_LEN = CtrlPacket.PREFIX_LEN + 1 + 2 + 4 + 4;
    _cmd;
    _data = Buffer.alloc(0);
    _ID = 0;
    _sessionID = 0;
    _ackCtrlOpt = undefined;
    _openOpt = undefined;
    get waitReceiveLength() {
        if (this._cmd != CtrlCmd.CloseSession) {
            return 0;
        }
        return this._data.readUInt32BE(0);
    }
    static createSyncCtrl() {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.SyncCtrl;
        return packet;
    }
    static createSyncCtrlAck(id) {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.SyncCtrlAck;
        packet._ID = id;
        return packet;
    }
    static message(id, message) {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.Message;
        packet._ID = id;
        packet._data = Buffer.from(JSON.stringify(message));
        return packet;
    }
    static getMessageFromPacket(packet) {
        if (packet._cmd != CtrlCmd.Message) {
            throw new Error("Invalid packet type");
        }
        return JSON.parse(packet._data.toString());
    }
    static createAckCtrl(id, name, key) {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.AckCtrl;
        packet._ID = id;
        packet._ackCtrlOpt = { name, key };
        let writer = new BufferWriter_1.default();
        writer.writeString(name);
        writer.writeString(key);
        packet._data = writer.toBuffer();
        return packet;
    }
    static closeSession(handlerID, sessionID, waitReceiveLength) {
        let packet = CtrlPacket.createNoDataPacket(CtrlCmd.CloseSession, handlerID, sessionID);
        packet._data = Buffer.alloc(4);
        packet._data.writeUInt32BE(waitReceiveLength);
        return packet;
    }
    /**
     * 새로운 데이터 핸들러 만들기와 동시에 커넥션을 열기를 요청하는 패킷을 만든다.
     * 서버에서 클라이언트로 보내는 패킷이다.
     * @param ctrlID 컨드롤 핸들러 ID
     * @param sessionID 세션 핸들러 ID
     * @param opt
     */
    static newDataHandler(ctrlID, sessionID) {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.NewDataHandler;
        packet._ID = ctrlID;
        packet._sessionID = sessionID;
        return packet;
    }
    static resultOfOpenSession(handlerID, sessionID, isSuccess) {
        return CtrlPacket.createNoDataPacket(!isSuccess ? CtrlCmd.FailOfOpenSession : CtrlCmd.SuccessOfOpenSession, handlerID, sessionID);
    }
    static resultOfOpenSessionAck(handlerID, sessionID) {
        return CtrlPacket.createNoDataPacket(CtrlCmd.SuccessOfOpenSessionAck, handlerID, sessionID);
    }
    static createNoDataPacket(cmd, ctrlID, sessionID) {
        let packet = new CtrlPacket();
        packet._cmd = cmd;
        packet._ID = ctrlID;
        packet._sessionID = sessionID;
        packet._data = CtrlPacket.EMPTY_BUFFER;
        return packet;
    }
    static connectEndPoint(ctrlID, sessionID, opt) {
        let packet = new CtrlPacket();
        packet._cmd = CtrlCmd.OpenSession;
        packet._sessionID = sessionID;
        packet._ID = ctrlID;
        packet._openOpt = opt;
        opt.tls = opt.tls == undefined ? false : opt.tls;
        //opt.protocol = opt.protocol || "tcp";
        let writer = new BufferWriter_1.default();
        writer.writeString(opt.host);
        writer.writeUInt16(opt.port);
        writer.writeBoolean(opt.tls);
        writer.writeInt32(opt.bufferLimit);
        //writer.writeString(opt.protocol);
        packet._data = writer.toBuffer();
        return packet;
    }
    get ackKey() {
        return this._ackCtrlOpt?.key;
    }
    get clientName() {
        return this._ackCtrlOpt?.name;
    }
    static fromBuffer(buffer) {
        let result = new CtrlPacket();
        let emptyBuffer = CtrlPacket.EMPTY_BUFFER;
        if (buffer.length < CtrlPacket.HEADER_LEN) {
            return { packet: null, remain: emptyBuffer, state: ParsedState.Incomplete, error: null };
        }
        let reader = new BufferReader_1.default(buffer);
        let prefix = reader.readBuffer(CtrlPacket.PREFIX_LEN);
        if (prefix.compare(CtrlPacket.PREFIX) !== 0) {
            return { packet: null, remain: emptyBuffer, state: ParsedState.Error, error: new Error("Invalid prefix") };
        }
        result._cmd = reader.readUInt8();
        if (result._cmd < CtrlCmd.SyncCtrl || result._cmd >= CtrlCmd.NonExistent) {
            return { packet: null, remain: emptyBuffer, state: ParsedState.Error, error: new Error("Invalid command") };
        }
        result._ID = reader.readUInt16();
        result._sessionID = reader.readUInt32();
        let dataLength = reader.readUInt32();
        // unt32 max value
        if (dataLength > MAX_PAYLOAD_SIZE + this.HEADER_LEN) {
            return { packet: null, remain: emptyBuffer, state: ParsedState.Error, error: new Error("Data length too large") };
        }
        if (result._cmd == CtrlCmd.SyncCtrl && dataLength != 0) {
            return { packet: null, remain: emptyBuffer, state: ParsedState.Error, error: new Error("SyncCtrl must have empty data") };
        }
        if (buffer.length < CtrlPacket.HEADER_LEN + dataLength) {
            return { packet: null, remain: emptyBuffer, state: ParsedState.Incomplete, error: null };
        }
        result._data = reader.readBuffer(dataLength);
        if (result._cmd == CtrlCmd.AckCtrl) {
            result._ackCtrlOpt = CtrlPacket.parseAckCtrlData(result._data);
        }
        else if (result._cmd == CtrlCmd.OpenSession) {
            result._openOpt = CtrlPacket.parseOpenData(result._data);
        }
        return { packet: result, remain: reader.readBufferToEnd(), state: ParsedState.Complete, error: null };
    }
    get cmd() {
        return this._cmd;
    }
    get sessionID() {
        return this._sessionID;
    }
    get ID() {
        return this._ID;
    }
    get data() {
        return this._data;
    }
    get openOpt() {
        return this._openOpt;
    }
    static parseOpenData(data) {
        let reader = new BufferReader_1.default(data);
        let host = reader.readString();
        let port = reader.readUInt16();
        let tls = reader.readBoolean();
        let bufferLimit = reader.readInt32();
        return { host, port, bufferLimit, tls: tls };
    }
    static parseAckCtrlData(data) {
        let reader = new BufferReader_1.default(data);
        let name = reader.readString();
        let key = reader.readString();
        return { name, key };
    }
    toBuffer() {
        let writer = new BufferWriter_1.default();
        writer.writeBuffer(CtrlPacket.PREFIX);
        writer.writeUInt8(this._cmd);
        writer.writeUInt16(this._ID);
        writer.writeUInt32(this._sessionID);
        writer.writeUInt32(this._data.length);
        writer.writeBuffer(this._data);
        return writer.toBuffer();
    }
}
exports.CtrlPacket = CtrlPacket;
class CtrlPacketStreamer {
    _dequeue = new Dequeue_1.default();
    feed(buffer) {
        this._dequeue.pushBack(buffer);
    }
    toPacketAtComplete(result) {
        if (result.remain && result.remain.length > 0) {
            this._dequeue.pushFront(result.remain);
        }
        return result.packet;
    }
    readPacket() {
        let buffer = this._dequeue.popFront();
        if (buffer === undefined) {
            return null;
        }
        let result = CtrlPacket.fromBuffer(buffer);
        if (result.state == ParsedState.Complete) {
            return this.toPacketAtComplete(result);
        }
        else if (result.state == ParsedState.Incomplete && this._dequeue.isEmpty()) {
            this._dequeue.pushFront(buffer);
            return null;
        }
        while (result.state == ParsedState.Incomplete && !this._dequeue.isEmpty()) {
            let newBuffer = this._dequeue.popFront();
            newBuffer = Buffer.concat([buffer, newBuffer]);
            result = CtrlPacket.fromBuffer(newBuffer);
            if (result.state == ParsedState.Incomplete && this._dequeue.isEmpty()) {
                this._dequeue.pushFront(newBuffer);
                return null;
            }
            else if (result.state == ParsedState.Complete) {
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
    readCtrlPacketList(buffer) {
        this.feed(buffer);
        let packets = new Array();
        let packet = null;
        do {
            packet = this.readPacket();
            if (packet)
                packets.push(packet);
        } while (packet);
        return packets;
    }
}
exports.CtrlPacketStreamer = CtrlPacketStreamer;
