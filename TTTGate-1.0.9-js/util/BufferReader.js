"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const buffer_1 = require("buffer");
class BufferReader {
    _buffer = [];
    _offset = 0;
    _readable = 0;
    _currentBuffer = null;
    constructor(buffer) {
        if (buffer !== undefined) {
            this.feed(buffer);
        }
    }
    feed(buffer) {
        this._buffer.push(buffer);
        this._readable += buffer.length;
    }
    readBoolean() {
        return this.readUInt8() !== 0;
    }
    readBytes(length) {
        if (this._currentBuffer === null || this._currentBuffer.length - this._offset < length) {
            if (this._buffer.length === 0) {
                throw new Error("Not enough data in the buffer to read");
            }
            let oldBuffer = this._currentBuffer;
            let oldOffset = this._offset;
            this._currentBuffer = this._buffer.shift();
            this._offset = 0;
            if (oldBuffer !== null && oldOffset != oldBuffer.length) {
                oldBuffer = oldBuffer.subarray(oldOffset);
                this._currentBuffer = buffer_1.Buffer.concat([oldBuffer, this._currentBuffer]);
                if (this._currentBuffer.length < length) {
                    return this.readBytes(length);
                }
            }
        }
        const result = this._currentBuffer.slice(this._offset, this._offset + length);
        this._offset += length;
        this._readable -= length;
        if (this._currentBuffer.length === this._offset) {
            let newBuffer = this._buffer.shift();
            if (newBuffer !== undefined) {
                this._currentBuffer = newBuffer;
                this._offset = 0;
            }
        }
        return result;
    }
    readable() {
        return this._readable;
    }
    readString() {
        const length = this.readUInt16();
        const bytes = this.readBytes(length);
        return bytes.toString("utf8");
    }
    readUIntLE(length) {
        const bytes = this.readBytes(length);
        let value = 0;
        for (let i = 0; i < bytes.length; i++) {
            value += bytes[i] * Math.pow(256, i);
        }
        return value;
    }
    readIntLE(length) {
        const bytes = this.readBytes(length);
        let value = 0;
        for (let i = 0; i < bytes.length; i++) {
            value += bytes[i] * Math.pow(256, i);
        }
        // If the most significant bit is 1, it's a negative number
        if (bytes[length - 1] & 0x80) {
            value -= Math.pow(256, length);
        }
        return value;
    }
    readInt8() {
        return this.readIntLE(1);
    }
    readInt16() {
        const bytes = this.readBytes(2);
        return bytes[0] * 256 + bytes[1];
    }
    readInt32() {
        const bytes = this.readBytes(4);
        return bytes[0] * Math.pow(256, 3) + bytes[1] * Math.pow(256, 2) + bytes[2] * 256 + bytes[3];
    }
    readFloat() {
        const bytes = this.readBytes(4);
        return bytes.readFloatBE(0);
    }
    readDouble() {
        const bytes = this.readBytes(8);
        return bytes.readDoubleBE(0);
    }
    readUInt8() {
        return this.readUIntLE(1);
    }
    readUInt16() {
        const bytes = this.readBytes(2);
        return bytes[0] * 256 + bytes[1];
    }
    readUInt32() {
        const bytes = this.readBytes(4);
        return bytes.readUInt32BE(0);
    }
    readUInt64() {
        const bytes = this.readBytes(8);
        return bytes.readBigUInt64BE(0);
    }
    readInt64() {
        const bytes = this.readBytes(8);
        return bytes.readBigInt64BE(0);
    }
    readUInt(length) {
        const bytes = this.readBytes(length);
        let value = 0;
        for (let i = 0; i < bytes.length; i++) {
            value += bytes[i] * Math.pow(256, bytes.length - i - 1);
        }
        return value;
    }
    readBuffer(length) {
        return this.readBytes(length);
    }
    readBufferToEnd() {
        return this.readBytes(this._readable);
    }
}
exports.default = BufferReader;
