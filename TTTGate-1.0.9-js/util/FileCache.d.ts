/// <reference types="node" />
interface CacheRecord {
    position: number;
    length: number;
    capacity: number;
    id: number;
}
declare class FileCache {
    private _lastId;
    private readonly _filePath;
    private _fileDescriptor;
    private _emptyBlocks;
    private _cacheMap;
    private _cacheSize;
    private _deleted;
    private findEmptyBlock;
    static create(filePath: string): FileCache;
    private static convertDateToString;
    private static tenDigitNumber;
    private constructor();
    private reset;
    private openIfNotFd;
    writeSync(buffer: Buffer): CacheRecord;
    readSync(id: number): Buffer | undefined;
    remove(id: number): boolean;
    delete(): void;
}
export { FileCache, CacheRecord };
