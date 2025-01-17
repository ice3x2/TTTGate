/// <reference types="node" />
declare class BufferWriter {
    private _buffer;
    private _pos;
    constructor(capacity?: number);
    writeByte(value: number): void;
    writeUIntLE(value: number, length: number): void;
    writeIntLE(value: number, length: number): void;
    writeUIntBE(value: number, length: number): void;
    writeIntBE(value: number, length: number): void;
    writeBuffer(buffer: Buffer): void;
    writeString(str: string): void;
    writeUInt8(value: number): void;
    writeUInt16(value: number): void;
    writeUInt32(value: number): void;
    writeInt8(value: number): void;
    writeInt16(value: number): void;
    writeInt32(value: number): void;
    writeInt64(value: bigint): void;
    writeFloatLE(value: number): void;
    writeDoubleLE(value: number): void;
    writeFloat(value: number): void;
    writeDouble(value: number): void;
    writeBoolean(value: boolean): void;
    ensureCapacity(length: number): void;
    toBuffer(): Buffer;
}
export default BufferWriter;
