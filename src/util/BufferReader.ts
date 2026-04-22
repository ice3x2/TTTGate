import {Buffer} from "buffer";


class BufferReader {


    private _buffer: Array<Buffer> = [];
    private _offset: number = 0;
    private _readable: number = 0;
    private _currentBuffer: Buffer | null = null;

    constructor(buffer? : Buffer) {
        if(buffer !== undefined) {
            this.feed(buffer);
        }
    }

    public feed(buffer: Buffer): void {
        this._buffer.push(buffer);
        this._readable += buffer.length;
    }

    public readBoolean(): boolean {
        return this.readUInt8() !== 0;
    }




    private readBytes(length: number): Buffer {
        if (this._currentBuffer === null || this._currentBuffer.length - this._offset < length) {
            if (this._buffer.length === 0) {
                throw new Error("Not enough data in the buffer to read");
            }
            let oldBuffer = this._currentBuffer;
            let oldOffset = this._offset;
            this._currentBuffer = this._buffer.shift()!;
            this._offset = 0;
            if (oldBuffer !== null && oldOffset != oldBuffer.length) {
                oldBuffer = oldBuffer.subarray(oldOffset);
                this._currentBuffer = Buffer.concat([oldBuffer, this._currentBuffer]);
                if(this._currentBuffer.length < length) {
                    return this.readBytes(length);
                }
            }
        }
        const result = this._currentBuffer.slice(this._offset, this._offset + length);
        this._offset += length;
        this._readable -= length;
        if(this._currentBuffer.length === this._offset) {
            let newBuffer = this._buffer.shift();
            if(newBuffer !== undefined) {
                this._currentBuffer = newBuffer;
                this._offset = 0;
            }
        }
        return result;
    }

    public readable(): number {
        return this._readable;
    }

    public readString(): string {
        const length = this.readUInt16();
        const bytes = this.readBytes(length);
        return bytes.toString("utf8");
    }




    public readUIntLE(length: number): number {
        const bytes = this.readBytes(length);
        let value = 0;
        for (let i = 0; i < bytes.length; i++) {
            value += bytes[i] * Math.pow(256, i);
        }
        return value;
    }

    public readIntLE(length: number): number {
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

    // BE 기본 메서드 (R2-REQ-02): 공식 Node.js Buffer BE API로 환원.
    // NF-01: readInt8/readUInt8은 readIntLE/readUIntLE 위임 체인을 제거하고 직접 호출.
    public readInt8(): number {
        const bytes = this.readBytes(1);
        return bytes.readInt8(0);
    }

    public readInt16(): number {
        const bytes = this.readBytes(2);
        return bytes.readInt16BE(0);
    }

    public readInt32(): number {
        const bytes = this.readBytes(4);
        return bytes.readInt32BE(0);
    }

    public readFloat(): number {
        const bytes = this.readBytes(4);
        return bytes.readFloatBE(0);
    }

    public readDouble(): number {
        const bytes = this.readBytes(8);
        return bytes.readDoubleBE(0);
    }

    public readUInt8(): number {
        const bytes = this.readBytes(1);
        return bytes.readUInt8(0);
    }

    public readUInt16(): number {
        const bytes = this.readBytes(2);
        return bytes.readUInt16BE(0);
    }

    public readUInt32(): number {
        const bytes = this.readBytes(4);
        return bytes.readUInt32BE(0);
    }

    // 명시적 LE suffix 메서드 (R2-REQ-02).
    public readInt16LE(): number {
        const bytes = this.readBytes(2);
        return bytes.readInt16LE(0);
    }

    public readInt32LE(): number {
        const bytes = this.readBytes(4);
        return bytes.readInt32LE(0);
    }

    public readUInt16LE(): number {
        const bytes = this.readBytes(2);
        return bytes.readUInt16LE(0);
    }

    public readUInt32LE(): number {
        const bytes = this.readBytes(4);
        return bytes.readUInt32LE(0);
    }

    public readUInt64(): BigInt {
        const bytes = this.readBytes(8);
        return bytes.readBigUInt64BE(0)
    }

    public readInt64(): bigint {
        const bytes = this.readBytes(8);
        return bytes.readBigInt64BE(0);
    }





    public readUInt(length: number): number {
        const bytes = this.readBytes(length);
        let value = 0;
        for (let i = 0; i < bytes.length; i++) {
            value += bytes[i] * Math.pow(256, bytes.length - i - 1);
        }
        return value;
    }



    public readBuffer(length: number): Buffer {
        return this.readBytes(length);
    }

    public readBufferToEnd(): Buffer {
        return this.readBytes(this._readable);
    }

}

export default BufferReader;

