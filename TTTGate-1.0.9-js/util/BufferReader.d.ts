/// <reference types="node" />
import { Buffer } from "buffer";
declare class BufferReader {
    private _buffer;
    private _offset;
    private _readable;
    private _currentBuffer;
    constructor(buffer?: Buffer);
    feed(buffer: Buffer): void;
    readBoolean(): boolean;
    private readBytes;
    readable(): number;
    readString(): string;
    readUIntLE(length: number): number;
    readIntLE(length: number): number;
    readInt8(): number;
    readInt16(): number;
    readInt32(): number;
    readFloat(): number;
    readDouble(): number;
    readUInt8(): number;
    readUInt16(): number;
    readUInt32(): number;
    readUInt64(): BigInt;
    readInt64(): bigint;
    readUInt(length: number): number;
    readBuffer(length: number): Buffer;
    readBufferToEnd(): Buffer;
}
export default BufferReader;
