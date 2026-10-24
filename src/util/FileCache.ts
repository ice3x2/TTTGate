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
/** 캐시 파일 이름: <pid>.<yyMMddHHmmss>.<난수>.cache */
const CACHE_FILE_PATTERN = /^(\d+)\.\d+\.\d+\.cache$/;
const EMPTY_BUFFER = Buffer.allocUnsafe(0);

class FileCache {

    /** #258: 이 프로세스가 만들어 아직 지우지 않은 캐시 파일 경로. 시작 시 정리는 이 파일만 남긴다. */
    private static readonly OwnedPaths = new Set<string>();

    private _lastId: number = 1;
    private readonly _filePath: string;
    private _fileDescriptor: number = -1;

    private _emptyBlocks: Array<CacheRecord> = [];
    private _cacheMap = new Map<number, CacheRecord>();
    private _cacheSize: number = 0;

    private _deleted : boolean = false;

    public get cacheSize(): number {
        return this._cacheSize;
    }

    public get filePath(): string {
        return this._filePath;
    }


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

    /**
     * #258: 폴더에서 살아 있지 않은 프로세스가 남긴 캐시 파일을 지우고 지운 경로를 돌려준다.
     * 캐시 파일은 deleteSync 로만 지우므로, 넘친 상태에서 죽거나 종료한 프로세스의 파일은 그대로 남는다.
     * 이름이 캐시 형식이 아니거나 PID 가 살아 있으면(다른 사용자의 프로세스 포함) 지우지 않는다.
     * 자기 PID 이름이라도 이 프로세스가 만들지 않은 파일은 같은 PID 로 돌던 이전 실행의 것이다(컨테이너 재시작). 지운다.
     */
    public static sweepStale(directoryPath: string) : string[] {
        let names: string[];
        try {
            names = fs.readdirSync(directoryPath);
        } catch {
            return [];
        }
        const removed: string[] = [];
        for(const name of names) {
            const match = CACHE_FILE_PATTERN.exec(name);
            if(!match) continue;
            const pid = Number(match[1]);
            const filePath = Path.join(directoryPath, name);
            if(pid === process.pid ? FileCache.OwnedPaths.has(Path.resolve(filePath)) : FileCache.isProcessAlive(pid)) continue;
            try {
                fs.unlinkSync(filePath);
                removed.push(filePath);
            } catch {}
        }
        return removed;
    }

    private static isProcessAlive(pid: number) : boolean {
        try {
            process.kill(pid, 0);
            return true;
        } catch (e) {
            // EPERM: 살아 있지만 신호를 보낼 권한이 없다(다른 사용자의 프로세스).
            return (e as NodeJS.ErrnoException).code === 'EPERM';
        }
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
        FileCache.OwnedPaths.add(Path.resolve(this._filePath));
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
            block.id = this._lastId++;
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
        let offset = 0;
        while(offset < block.length) {
            const bytesRead = fs.readSync(this._fileDescriptor, buffer, offset, block.length - offset, block.position + offset);
            if(bytesRead === 0) {
                throw new Error(`Incomplete file cache record ${id}: read ${offset} of ${block.length} bytes`);
            }
            offset += bytesRead;
        }
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
            // 남은 기록이 없으면 디스크도 비운다. 그러지 않으면 핸들러가 살아 있는 동안 파일이 줄지 않아,
            // 전체 파일 캐시 집계(살아 있는 바이트)가 0 이어도 디스크에는 넘쳤던 크기가 남는다(#258).
            if(this._fileDescriptor != -1) {
                try {
                    fs.ftruncateSync(this._fileDescriptor, 0);
                } catch {}
            }
        }
        return true;
    }

    public delete() : void {
        this.deleteSync();
    }

    public deleteSync() : void {
        if(this._deleted)  {
            return;
        }
        this._deleted = true;
        FileCache.OwnedPaths.delete(Path.resolve(this._filePath));
        this._cacheMap = new Map<number, CacheRecord>();
        this._emptyBlocks = [];
        this._cacheSize = 0;
        if(this._fileDescriptor != -1) {
            try {
                fs.closeSync(this._fileDescriptor);
            } catch {}
            this._fileDescriptor = -1;
        }
        try {
            fs.unlinkSync(this._filePath);
        } catch {}
    }



}


export {FileCache, CacheRecord};
