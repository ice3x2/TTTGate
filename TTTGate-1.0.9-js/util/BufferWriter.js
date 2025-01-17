"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class BufferWriter {
    _buffer;
    _pos = 0;
    constructor(capacity = 32) {
        this._buffer = Buffer.alloc(capacity);
    }
    writeByte(value) {
        this._buffer.readUInt8();
        this.ensureCapacity(1);
        this._buffer[this._pos++] = value;
    }
    writeUIntLE(value, length) {
        this.ensureCapacity(length);
        this._buffer.writeUIntLE(value, this._pos, length);
        this._pos += length;
    }
    writeIntLE(value, length) {
        this.ensureCapacity(length);
        this._buffer.writeIntLE(value, this._pos, length);
        this._pos += length;
    }
    writeUIntBE(value, length) {
        this.ensureCapacity(length);
        this._buffer.writeUIntBE(value, this._pos, length);
        this._pos += length;
    }
    writeIntBE(value, length) {
        this.ensureCapacity(length);
        this._buffer.writeIntBE(value, this._pos, length);
        this._pos += length;
    }
    writeBuffer(buffer) {
        this.ensureCapacity(buffer.length);
        buffer.copy(this._buffer, this._pos);
        this._pos += buffer.length;
    }
    writeString(str) {
        let stringBuffer = Buffer.from(str);
        this.writeUInt16(stringBuffer.length);
        this.writeBuffer(stringBuffer);
    }
    writeUInt8(value) {
        this.writeUIntBE(value, 1);
    }
    writeUInt16(value) {
        this.writeUIntBE(value, 2);
    }
    writeUInt32(value) {
        this.writeUIntBE(value, 4);
    }
    writeInt8(value) {
        this.writeIntBE(value, 1);
    }
    writeInt16(value) {
        this.writeIntBE(value, 2);
    }
    writeInt32(value) {
        this.writeIntBE(value, 4);
    }
    writeInt64(value) {
        this._buffer.writeBigInt64BE(value, this._pos);
        this._pos += 8;
    }
    writeFloatLE(value) {
        this.ensureCapacity(4);
        this._buffer.writeFloatLE(value, this._pos);
        this._pos += 4;
    }
    writeDoubleLE(value) {
        this.ensureCapacity(8);
        this._buffer.writeDoubleLE(value, this._pos);
        this._pos += 8;
    }
    writeFloat(value) {
        this.ensureCapacity(4);
        this._buffer.writeFloatBE(value, this._pos);
        this._pos += 4;
    }
    writeDouble(value) {
        this.ensureCapacity(8);
        this._buffer.writeDoubleBE(value, this._pos);
        this._pos += 8;
    }
    writeBoolean(value) {
        this.writeUInt8(value ? 1 : 0);
    }
    ensureCapacity(length) {
        if (this._buffer.length - this._pos < length) {
            let oldBuffer = this._buffer;
            this._buffer = Buffer.alloc(oldBuffer.length * 2 + length);
            oldBuffer.copy(this._buffer);
        }
    }
    toBuffer() {
        return this._buffer.subarray(0, this._pos);
    }
}
exports.default = BufferWriter;
