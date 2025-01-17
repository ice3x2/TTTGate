"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileCache = void 0;
const File_1 = __importDefault(require("./File"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const MIN_CAPACITY = 4096;
const EMPTY_BUFFER = Buffer.allocUnsafe(0);
class FileCache {
    _lastId = 1;
    _filePath;
    _fileDescriptor = -1;
    _emptyBlocks = [];
    _cacheMap = new Map();
    _cacheSize = 0;
    _deleted = false;
    findEmptyBlock(length) {
        for (let i = 0; i < this._emptyBlocks.length; i++) {
            let block = this._emptyBlocks[i];
            if (block.capacity >= length) {
                this._emptyBlocks.splice(i, 1);
                return block;
            }
        }
        return null;
    }
    static create(filePath) {
        return new FileCache(filePath);
    }
    static convertDateToString(date) {
        let year = FileCache.tenDigitNumber(date.getFullYear() % 100);
        let month = FileCache.tenDigitNumber(date.getMonth() + 1);
        let day = FileCache.tenDigitNumber(date.getDate());
        let hour = FileCache.tenDigitNumber(date.getHours());
        let minute = FileCache.tenDigitNumber(date.getMinutes());
        let second = FileCache.tenDigitNumber(date.getSeconds());
        return `${year}${month}${day}${hour}${minute}${second}`;
    }
    static tenDigitNumber(number) {
        if (number < 10) {
            return "0" + number;
        }
        return number.toString();
    }
    constructor(directoryPath) {
        this._filePath = path_1.default.join(directoryPath, process.pid + "." + FileCache.convertDateToString(new Date()) + "." + Math.floor(((Math.random() * 10000000) + 100000000)) + ".cache");
    }
    reset() {
        let file = new File_1.default(this._filePath);
        let parent = file.getParentFile();
        if (!parent.isDirectory()) {
            parent.mkdirs();
        }
        if (!parent.isDirectory()) {
            throw new Error("can not create directory " + parent.toString());
        }
        if (file.isFile()) {
            file.delete();
        }
        file.createNewFile();
        if (!file.canWrite() || !file.canRead()) {
            throw new Error("can not read or write file " + file.toString());
        }
    }
    openIfNotFd() {
        if (this._fileDescriptor == -1) {
            this.reset();
            this._fileDescriptor = fs_1.default.openSync(this._filePath, 'r+');
        }
    }
    writeSync(buffer) {
        this.openIfNotFd();
        if (this._deleted) {
            return {
                position: -1,
                length: -1,
                capacity: -1,
                id: -1
            };
        }
        let block = this.findEmptyBlock(buffer.length);
        let length = buffer.length;
        if (block != null) {
            block.length = length;
            if (length < block.capacity) {
                buffer = Buffer.concat([buffer, Buffer.allocUnsafe(block.capacity - buffer.length)]);
            }
        }
        else {
            if (length < MIN_CAPACITY) {
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
        fs_1.default.writeSync(this._fileDescriptor, buffer, 0, buffer.length, block.position);
        fs_1.default.fstatSync(this._fileDescriptor);
        this._cacheMap.set(block.id, block);
        return block;
    }
    readSync(id) {
        if (this._deleted || this._fileDescriptor == -1) {
            return undefined;
        }
        let block = this._cacheMap.get(id);
        if (block == undefined) {
            return undefined;
        }
        let buffer = Buffer.allocUnsafe(block.length);
        fs_1.default.readSync(this._fileDescriptor, buffer, 0, block.length, block.position);
        return buffer;
    }
    remove(id) {
        if (this._deleted) {
            return false;
        }
        let block = this._cacheMap.get(id);
        if (block == undefined) {
            return false;
        }
        this._cacheMap.delete(id);
        this._emptyBlocks.push(block);
        if (this._cacheMap.size == 0) {
            this._emptyBlocks = [];
            this._cacheSize = 0;
        }
        return true;
    }
    delete() {
        if (this._deleted || this._fileDescriptor == -1) {
            return;
        }
        this._deleted = true;
        this._cacheMap = new Map();
        this._emptyBlocks = [];
        this._cacheSize = 0;
        fs_1.default.close(this._fileDescriptor, () => {
            this._fileDescriptor = -1;
            fs_1.default.unlink(this._filePath, () => { });
        });
    }
}
exports.FileCache = FileCache;
