import File from './File';
import fs from 'fs';
import Path from "path";



interface CacheRecord {
    position: number;
    length: number;
    capacity: number;
    id: number;
}

const MIN_CAPACITY = 4096;
const EMPTY_BUFFER = Buffer.allocUnsafe(0);

class FileCache {

    private _lastId: number = 1;
    private readonly _filePath: string;
    private _fileDescriptor: number = -1;

    private _emptyBlocks: Array<CacheRecord> = [];
    private _cacheMap = new Map<number, CacheRecord>();
    private _cacheSize: number = 0;

    private _deleted : boolean = false;


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

    private static convertDateToString(date: Date) : string {
        let year = FileCache.tenDigitNumber(date.getFullYear() % 100);
        let month = FileCache.tenDigitNumber(date.getMonth() + 1);
        let day = FileCache.tenDigitNumber(date.getDate());
        let hour = FileCache.tenDigitNumber(date.getHours());
        let minute = FileCache.tenDigitNumber(date.getMinutes());
        let second = FileCache.tenDigitNumber(date.getSeconds());


        return `${year}${month}${day}${hour}${minute}${second}`;
    }

    private static tenDigitNumber(number: number) : string {
        if(number < 10) {
            return "0" + number;
        }
        return number.toString();
    }


    private constructor(directoryPath: string) {
        this._filePath = Path.join(directoryPath,process.pid + "." +  FileCache.convertDateToString(new Date()) + "." + Math.floor(((Math.random() * 10000000) + 100000000)) + ".cache");
    }

    private reset() : void {
        let file = new File(this._filePath);
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
    }

    private openIfNotFd() : void {
        if(this._fileDescriptor == -1) {
            this.reset();
            this._fileDescriptor = fs.openSync(this._filePath, 'r+');
        }
    }

    public writeSync(buffer: Buffer) : CacheRecord {
        this.openIfNotFd();
        if(this._deleted) {
            return {
                position: -1,
                length: -1,
                capacity: -1,
                id: -1
            };
        }
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
            this._cacheSize += buffer.length;
        }
        fs.writeSync(this._fileDescriptor, buffer, 0, buffer.length, block.position);
        fs.fstatSync(this._fileDescriptor);
        this._cacheMap.set(block.id, block);
        return block;
    }



    public readSync(id : number) : Buffer | undefined {
        if(this._deleted || this._fileDescriptor == -1) {
            return undefined;
        }
        let block = this._cacheMap.get(id);
        if (block == undefined) {
            return undefined;
        }
        let buffer = Buffer.allocUnsafe(block.length);
        fs.readSync(this._fileDescriptor, buffer, 0, block.length, block.position);
        return buffer;
    }

    public  remove(id : number) : boolean {
        if(this._deleted) {
            return false;
        }
        let block = this._cacheMap.get(id);
        if(block == undefined) {
            return false;
        }
        this._cacheMap.delete(id);
        this._emptyBlocks.push(block);
        if(this._cacheMap.size == 0) {
            this._emptyBlocks = [];
            this._cacheSize = 0;
        }
        return true;
    }

    public delete() : void {
        if(this._deleted || this._fileDescriptor == -1)  {
            return;
        }
        this._deleted = true;
        this._cacheMap = new Map<number, CacheRecord>();
        this._emptyBlocks = [];
        this._cacheSize = 0;
        fs.close(this._fileDescriptor, () => {
            this._fileDescriptor = -1;
            fs.unlink(this._filePath, () => {});
        });
    }



}


export {FileCache, CacheRecord};
