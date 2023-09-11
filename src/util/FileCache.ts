import File from './File';
import fs from 'fs';



interface CacheRecord {
    position: number;
    length: number;
    capacity: number;
    id: number;
}

const MIN_CAPACITY = 4096;
const EMPTY_BUFFER = Buffer.allocUnsafe(0);

class FileCache {

    private _lastId: number = 0;
    private readonly _filePath: string;
    private readonly _fileDescriptor: number;

    private _emptyBlocks: Array<CacheRecord> = [];
    private _cacheMap = new Map<number, CacheRecord>();
    private _cacheSize: number = 0;

    private findEmptyBlock(length: number) : CacheRecord | null {
        for(let i = 0; i < this._emptyBlocks.length; i++) {
            let block = this._emptyBlocks[i];
            if(block.capacity >= length) {
                this._emptyBlocks.splice(i, 1);
                return block;
            }
        }
        return null;
    }


    public static create(filePath: string) : FileCache {
        return new FileCache(filePath);
    }


    private constructor(filePath: string) {
        this._filePath = filePath;
        let file = new File(filePath);
        let parent = file.getParentFile();
        if(!parent.isDirectory()) {
            parent.mkdirs();
        }
        if(!parent.isDirectory()) {
            throw new Error("can not create directory " + parent.toString());
        }
        if(file.isFile()) {
            file.delete();
        }
        file.createNewFile();
        if(!file.canWrite() || !file.canRead()) {
            throw new Error("can not read or write file " + file.toString());
        }
        this._fileDescriptor = fs.openSync(file.toString(), 'r+');

    }

    public writeSync(buffer: Buffer) : CacheRecord {
        let block = this.findEmptyBlock(buffer.length);
        let length = buffer.length;

        if(block != null) {
            block.length = length;
            if(length < block.capacity) {
                buffer = Buffer.concat([buffer, Buffer.allocUnsafe(block.capacity - buffer.length)]);
            }
        } else {
            if(length < MIN_CAPACITY) {
                buffer = Buffer.concat([buffer, Buffer.allocUnsafe(MIN_CAPACITY - buffer.length)]);
            }
            block = {
                position: this._cacheSize,
                length: length,
                capacity: buffer.length,
                id: this._lastId++
            };
        }
        fs.writeSync(this._fileDescriptor, buffer, 0, buffer.length, block.position);
        this._cacheMap.set(block.id, block);
        return block;
    }

    public async write(buffer: Buffer) : Promise<CacheRecord> {

            let block = this.findEmptyBlock(buffer.length);
            let length = buffer.length;


            if(block != null) {
                block.length = length;
                if(length < block.capacity) {
                    buffer = Buffer.concat([buffer, Buffer.allocUnsafe(block.capacity - buffer.length)]);
                }
            } else {
                if(length < MIN_CAPACITY) {
                    buffer = Buffer.concat([buffer, Buffer.allocUnsafe(MIN_CAPACITY - buffer.length)]);
                }
                block = {
                    position: this._cacheSize,
                    length: length,
                    capacity: buffer.length,
                    id: this._lastId++
                };
            }
        await this.writeAll(this._fileDescriptor, block.position, buffer);
            this._cacheMap.set(block.id, block);
        return block;

    }

    private async writeAll(fd: number,pos: number, buffer: Buffer) : Promise<void> {
        let written = 0;
        while(written < buffer.length) {
           written += await this.writeBuffer(fd, pos, buffer);
        }
    }

    private async writeBuffer(fd: number, pos: number, buffer: Buffer) : Promise<number> {
        return new Promise<number>((resolve, reject) => {
            fs.write(fd, buffer, 0, buffer.length, pos, (err, written, buffer) => {
                if(err) {
                    reject(err);
                } else {
                    resolve(written);
                }
            });
        });
    }

    private async readAll(fd: number, pos: number, length: number) : Promise<Buffer> {
        let buffer = EMPTY_BUFFER;
        let read = 0;
        while(read < length) {
            let readBuffer = await this.readBuffer(fd, pos, length);
            read += readBuffer.length;
            buffer = Buffer.concat([buffer, readBuffer]);
        }
        return buffer;
    }

    private async readBuffer(fd: number, pos: number, length: number) : Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            let buffer = Buffer.allocUnsafe(length);
            fs.read(fd, buffer, 0, length, pos, (err, bytesRead, buffer) => {
                if(err) {
                    reject(err);
                } else {
                    buffer = buffer.subarray(0, bytesRead);
                    resolve(buffer);
                }
            });
        });
    }



    public async read(id : number) : Promise<Buffer | undefined> {
            let block = this._cacheMap.get(id);
            if(block == undefined) {
                return undefined;
            }
            return await this.readAll(this._fileDescriptor, block.position, block.length);
    }

    public  readSync(id : number) : Buffer | undefined {
        let block = this._cacheMap.get(id);
        if (block == undefined) {
            return undefined;
        }
        let buffer = Buffer.allocUnsafe(block.length);
        fs.readSync(this._fileDescriptor, buffer, 0, block.length, block.position);
        return buffer;
    }

    public  remove(id : number) : boolean {
        let block = this._cacheMap.get(id);
        if(block == undefined) {
            return false;
        }
        this._cacheMap.delete(id);
        this._emptyBlocks.push(block);
        return true;
    }


}


export {FileCache, CacheRecord};
