"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class DataStatePacket {
    static PACKET_DELIMITER = 'D';
    static PREFIX = "DATA_STATE";
    static PREFIX_LENGTH = Buffer.byteLength(DataStatePacket.PREFIX);
    static LENGTH = DataStatePacket.PREFIX_LENGTH + 4 + 4 + 4; // 10(DATA_STATE) + 4(CTRL_ID) + 4(HANDLER_ID) + 4(FIRST_SESSION_ID)
    _handlerID;
    _ctrlID;
    _firstSessionID;
    constructor() { }
    get handlerID() { return this._handlerID; }
    get ctrlID() { return this._ctrlID; }
    get firstSessionID() { return this._firstSessionID; }
    static create(ctrlID, handlerID, firstSessionID) {
        let packet = new DataStatePacket();
        packet._handlerID = handlerID;
        packet._ctrlID = ctrlID;
        packet._firstSessionID = firstSessionID;
        return packet;
    }
    toBuffer() {
        let buffer = Buffer.alloc(DataStatePacket.LENGTH);
        buffer.write(DataStatePacket.PREFIX, 0, DataStatePacket.PREFIX_LENGTH);
        buffer.writeUInt32BE(this._ctrlID, DataStatePacket.PREFIX.length);
        buffer.writeUInt32BE(this._handlerID, DataStatePacket.PREFIX.length + 4);
        buffer.writeUInt32BE(this._firstSessionID, DataStatePacket.PREFIX.length + 8);
        return buffer;
    }
    static fromBuffer(buffer) {
        if (buffer.length < DataStatePacket.LENGTH) {
            return { packet: undefined, remainBuffer: buffer };
        }
        let prefix = buffer.toString('utf-8', 0, DataStatePacket.PREFIX_LENGTH);
        if (prefix != DataStatePacket.PREFIX) {
            throw new Error(`fromBuffer: invalid prefix: ${prefix}`);
        }
        let packet = new DataStatePacket();
        packet._ctrlID = buffer.readUInt32BE(DataStatePacket.PREFIX_LENGTH);
        packet._handlerID = buffer.readUInt32BE(DataStatePacket.PREFIX_LENGTH + 4);
        packet._firstSessionID = buffer.readUInt32BE(DataStatePacket.PREFIX_LENGTH + 8);
        return { packet: packet, remainBuffer: buffer.subarray(DataStatePacket.LENGTH) };
    }
}
exports.default = DataStatePacket;
