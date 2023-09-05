

class BufferWriter {
    private _buffer : Buffer;

    private _pos : number = 0;

    public constructor(capacity : number = 32) {
        this._buffer = Buffer.alloc(capacity);

    }


    public writeByte(value : number) : void {
        this._buffer.readUInt8()
        this.ensureCapacity(1);
        this._buffer[this._pos++] = value;
    }

    public writeUIntLE(value : number, length : number) : void {
        this.ensureCapacity(length);
        this._buffer.writeUIntLE(value, this._pos, length);
        this._pos += length;
    }

    public writeIntLE(value : number, length : number) : void {
        this.ensureCapacity(length);
        this._buffer.writeIntLE(value, this._pos, length);
        this._pos += length;
    }

    public writeUIntBE(value : number, length : number) : void {
        this.ensureCapacity(length);
        this._buffer.writeUIntBE(value, this._pos, length);
        this._pos += length;
    }

    public writeIntBE(value : number, length : number) : void {
        this.ensureCapacity(length);
        this._buffer.writeIntBE(value, this._pos, length);
        this._pos += length;
    }

    public writeBuffer(buffer : Buffer) : void {
        this.ensureCapacity(buffer.length);
        buffer.copy(this._buffer, this._pos);
        this._pos += buffer.length;
    }

    public writeString(str : string) : void {
        let stringBuffer = Buffer.from(str);
        this.writeUInt16(stringBuffer.length);
        this.writeBuffer(stringBuffer);
    }

    public writeUInt8(value : number) : void {
        this.writeUIntBE(value, 1);
    }

    public writeUInt16(value : number) : void {
        this.writeUIntBE(value, 2);
    }

    public writeUInt32(value : number) : void {
        this.writeUIntBE(value, 4);
    }



    public writeInt8(value : number) : void {
        this.writeIntBE(value, 1);
    }

    public writeInt16(value : number) : void {
        this.writeIntBE(value, 2);
    }

    public writeInt32(value : number) : void {
        this.writeIntBE(value, 4);
    }

    public writeInt64(value : bigint) : void {
        this._buffer.writeBigInt64BE(value, this._pos);
        this._pos += 8;
    }

    public writeFloatLE(value : number) : void {
        this.ensureCapacity(4);
        this._buffer.writeFloatLE(value, this._pos);
        this._pos += 4;
    }


    public writeDoubleLE(value : number) : void {
        this.ensureCapacity(8);
        this._buffer.writeDoubleLE(value, this._pos);
        this._pos += 8;
    }

    public writeFloat(value : number) : void {
        this.ensureCapacity(4);
        this._buffer.writeFloatBE(value, this._pos);
        this._pos += 4;
    }

    public writeDouble(value : number) : void {
        this.ensureCapacity(8);
        this._buffer.writeDoubleBE(value, this._pos);
        this._pos += 8;
    }

    public writeBoolean(value : boolean) : void {
        this.writeUInt8(value ? 1 : 0);
    }


    public ensureCapacity(length : number) : void {
        if(this._buffer.length - this._pos < length) {
            let oldBuffer = this._buffer;
            this._buffer = Buffer.alloc(oldBuffer.length * 2 + length);
            oldBuffer.copy(this._buffer);
        }
    }

    public toBuffer() : Buffer {
        return this._buffer.subarray(0, this._pos);
    }




}

export default BufferWriter;