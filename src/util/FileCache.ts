import File from './File';
import fs from 'fs';



interface Record {
    position: number;
    length: number;
    capacity: number;
    id: number;
}

const MIN_CAPACITY = 12;


class FileCache {

    private _lastId: number = 0;
    private readonly _filePath: string;
    private readonly _fileDescriptor: number;

    private _emptyBlocks: Array<Record> = [];
    private _cacheMap = new Map<number, Record>();
    private _cacheSize: number = 0;

    private findEmptyBlock(length: number) : Record | null {
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

    public async write(buffer: Buffer) : Promise<Record> {
        return new Promise<Record>((resolve, reject) => {
            let block = this.findEmptyBlock(buffer.length);
            let length = buffer.length;


            if(block != null) {
                block.length = length;
                if(length < block.capacity) {
                    buffer = Buffer.concat([buffer, Buffer.allocUnsafe(block.capacity - buffer.length)]);
                }

                fs.write(this._fileDescriptor, buffer, 0, block.capacity, block.position, (err, written, buffer) => {
                    if(err) {
                        reject(err);
                    } else {
                        this._cacheMap.set(block!.id, block!);
                        resolve(block!);
                    }
                });
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
                fs.write(this._fileDescriptor, buffer, 0, buffer.length, this._cacheSize, (err, written, buffer) => {
                    if(err) {
                        reject(err);
                    } else {
                        this._cacheMap.set(block!.id, block!);
                        this._cacheSize += buffer.length;
                        resolve(block!);
                    }
                });
            }
        });
    }

    public async read(id : number) : Promise<Buffer | undefined> {
        return new Promise<Buffer | undefined>((resolve, reject) => {
            let block = this._cacheMap.get(id);
            if(block == undefined) {
                resolve(undefined);
                return;
            }
            let buffer = Buffer.allocUnsafe(block.length);
            fs.read(this._fileDescriptor, buffer, 0, block.length, block.position, (err, bytesRead, buffer) => {
                if(err) {
                    reject(err);
                } else {
                    resolve(buffer);
                }
            });
        });
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


export {FileCache, Record};
