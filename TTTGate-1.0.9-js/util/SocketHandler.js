"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketHandler = void 0;
const net_1 = __importDefault(require("net"));
const SocketState_1 = __importDefault(require("./SocketState"));
const tls = __importStar(require("tls"));
const path_1 = __importDefault(require("path"));
const Dequeue_1 = __importDefault(require("./Dequeue"));
const Errors_1 = __importDefault(require("./Errors"));
const FileCache_1 = require("./FileCache");
const LoggerFactory_1 = __importDefault(require("../util/logger/LoggerFactory"));
const logger = LoggerFactory_1.default.getLogger('', 'SocketHandler');
const MIN_KEEP_ALIVE = 500;
const EMPTY_BUFFER = Buffer.alloc(0);
// noinspection JSUnusedGlobalSymbols
class SocketHandler {
    static LAST_ID = 0;
    static MaxGlobalMemoryBufferSize = 1024 * 1024 * 128; // 128MB
    static GlobalMemoryBufferSize = 0;
    static FileCacheDirPath = path_1.default.join(process.cwd(), "cache");
    _port;
    _addr;
    _tls;
    _id = ++SocketHandler.LAST_ID;
    _socket;
    _state = SocketState_1.default.None;
    _bundle = new Map();
    _isServer = false;
    _fileCache = null;
    _waitQueue = new Dequeue_1.default();
    _drainEventList = [];
    _breakBufferFlush = false;
    _sendLength = 0;
    _receiveLength = 0;
    _endWaitingState = false;
    _event;
    _memoryBufferSize = 0;
    _memBufferSizeLimit = -1;
    _isFullNativeBuffer = false;
    _inRunWriteBuffer = false;
    get isServer() {
        return this._isServer;
    }
    get socket() {
        return this._socket;
    }
    static set fileCacheDirPath(path) {
        this.FileCacheDirPath = path;
    }
    set onSocketEvent(event) {
        this._event = event;
    }
    get breakBufferFlush() {
        return this._breakBufferFlush;
    }
    get sendLength() {
        return this._sendLength;
    }
    get receiveLength() {
        return this._receiveLength;
    }
    static get globalMemoryBufferSize() {
        return SocketHandler.GlobalMemoryBufferSize;
    }
    static get maxGlobalMemoryBufferSize() {
        return SocketHandler.MaxGlobalMemoryBufferSize;
    }
    static set GlobalMemCacheLimit(limit) {
        SocketHandler.MaxGlobalMemoryBufferSize = limit;
        logger.info(`set GlobalMemCacheLimit(${limit / 1024 / 1024}MiB)`);
    }
    setBufferSizeLimit(size) {
        this._memBufferSizeLimit = size;
    }
    /**
     * 버퍼가 비워졌을 때 한 번만 호출되는 이벤트 리스너를 등록한다.
     * 만약 버퍼가 비어있는 상태라면 즉시 호출된다.
     * @param event
     */
    addOnceDrainListener(event) {
        if (this._waitQueue.isEmpty() || this.isEnd()) {
            event(this, true);
            return;
        }
        this._drainEventList.push(event);
    }
    static connect(options, event) {
        let handlerRef = [];
        options.keepalive = options.keepalive ?? 60000;
        let connected = () => {
            if (handlerRef.length > 0 && handlerRef[0]._state == SocketState_1.default.None) {
                handlerRef[0]._state = SocketState_1.default.Connected;
                event(handlerRef[0], SocketState_1.default.Connected);
            }
        };
        let socket;
        // noinspection PointlessBooleanExpressionJS
        if (options.tls && options.tls === true) {
            let option = { port: options.port, host: options.host, allowHalfOpen: false, keepAlive: options.keepalive > 0, keepAliveInitialDelay: Math.max(options.keepalive, MIN_KEEP_ALIVE), noDelay: true, rejectUnauthorized: false };
            socket = tls.connect(option, connected);
        }
        else {
            let option = { port: options.port, host: options.host, allowHalfOpen: false, keepAlive: options.keepalive > 0, keepAliveInitialDelay: Math.max(options.keepalive, MIN_KEEP_ALIVE), noDelay: true, rejectUnauthorized: false };
            socket = net_1.default.connect(option, connected);
        }
        let handler = new SocketHandler(socket, options.port, options.host, options.tls ?? false, event);
        handlerRef.push(handler);
        return handler;
    }
    static bound(options, event) {
        options.socket.setNoDelay(true);
        if (options.keepAlive > 0) {
            options.socket.setKeepAlive(true, options.keepAlive);
        }
        let handler = new SocketHandler(options.socket, options.port, options.addr, options.tls, event);
        handler._state = SocketState_1.default.Connected;
        handler._isServer = true;
        return handler;
    }
    get localAddr() {
        return this._socket.localAddress ?? '';
    }
    constructor(socket, port, addr, tls, event) {
        this._port = port;
        this._addr = addr;
        this._tls = tls;
        this._socket = socket;
        this._event = event;
        this.initSocket(socket);
    }
    get remoteAddress() {
        return this._socket.remoteAddress ?? '';
    }
    get remotePort() {
        return this._socket.remotePort ?? 0;
    }
    setBundle(key, value) {
        this._bundle.set(key, value);
    }
    getBundle(key) {
        return this._bundle.get(key);
    }
    deleteBundle(key) {
        this._bundle.delete(key);
    }
    hasBundle(key) {
        return this._bundle.has(key);
    }
    isEnd() {
        return this._state == SocketState_1.default.Closed || this._state == SocketState_1.default.End; /* || this._state == SocketState.Error; */
    }
    isSecure() {
        return this._tls;
    }
    get state() {
        return this._state;
    }
    get id() {
        return this._id;
    }
    initSocket(socket) {
        this._socket = socket;
        socket.on('connect', () => {
            if (this._state != SocketState_1.default.Connected) {
                this._state = SocketState_1.default.Connected;
                this._event(this, SocketState_1.default.Connected);
            }
        });
        socket.on('error', (error) => {
            console.error(error);
            this.procError(error);
        });
        socket.on('drain', () => {
            if (this._isFullNativeBuffer && this._inRunWriteBuffer) {
                this._isFullNativeBuffer = false;
                setImmediate(() => {
                    this.sendPopDataRecursive2(true);
                });
            }
        });
        socket.on('close', () => {
            this.callAllDrainEvent(this._waitQueue.isEmpty());
            if (this._state != SocketState_1.default.Closed /* && this._state != SocketState.Error*/) {
                this._breakBufferFlush = !this._waitQueue.isEmpty();
                this._state = SocketState_1.default.Closed;
                this._event(this, SocketState_1.default.Closed);
            }
            this.release();
        });
        socket.on('data', (data) => {
            this._receiveLength += data.length;
            if (!this.isEnd()) {
                try {
                    this._event(this, SocketState_1.default.Receive, data);
                }
                catch (e) {
                    this.procError(e);
                }
            }
        });
        socket.on('end', () => {
            if (!this.isEnd()) {
                this._state = SocketState_1.default.End;
                this._breakBufferFlush = !this._waitQueue.isEmpty();
                this._event(this, SocketState_1.default.End);
                //23.10.19 수정
                this._waitQueue.clear();
            }
        });
    }
    procError(error, logging) {
        if (logging !== false) {
            logger.error(`procError() - ${error.message}`);
            logger.error(Errors_1.default.toString(error));
        }
        this._breakBufferFlush = !this._waitQueue.isEmpty();
        this.callAllDrainEvent(this._waitQueue.isEmpty());
        if (this._state != SocketState_1.default.Closed) {
            this._state = SocketState_1.default.Closed;
            this._event(this, SocketState_1.default.Closed, error);
        }
        this.release();
    }
    release() {
        this.clearWaitQueue();
        this._socket.removeAllListeners();
        this._state = SocketState_1.default.Closed;
        this._socket.destroy();
        this._event = () => { };
        this._bundle.clear();
        this._waitQueue.clear();
        this._fileCache?.delete();
        this.resetBufferSize();
    }
    resetBufferSize() {
        SocketHandler.GlobalMemoryBufferSize -= this._memoryBufferSize;
        this._memoryBufferSize = 0;
        if (SocketHandler.GlobalMemoryBufferSize < 0) {
            SocketHandler.GlobalMemoryBufferSize = 0;
        }
    }
    get port() {
        return this._port;
    }
    get addr() {
        return this._addr;
    }
    get tls() {
        return this._tls;
    }
    end_() {
        if (this._endWaitingState || this.isEnd()) {
            return;
        }
        if (!this._waitQueue.isEmpty()) {
            this._endWaitingState = true;
            return;
        }
        this._socket.end();
    }
    endImmediate() {
        if (this.isEnd()) {
            return;
        }
        this._socket.end();
        this._state = SocketState_1.default.End;
        this._event?.(this, SocketState_1.default.End);
        this._waitQueue.clear();
    }
    destroy() {
        if (this._fileCache) {
            this._fileCache.delete();
        }
        if (this._state == SocketState_1.default.Closed /*|| this._state == SocketState.Error*/) {
            return;
        }
        this.callAllDrainEvent(this._waitQueue.isEmpty());
        this._socket.removeAllListeners();
        this._socket.destroy();
        this._state = SocketState_1.default.Closed;
        this._event(this, SocketState_1.default.Closed);
        this._event = () => { };
        this._bundle.clear();
        this.resetBufferSize();
    }
    static isOverGlobalMemoryBufferSize(size) {
        return SocketHandler.GlobalMemoryBufferSize + size > SocketHandler.MaxGlobalMemoryBufferSize;
    }
    isOverMemoryBufferSize(size) {
        return (this._memoryBufferSize + size > this._memBufferSizeLimit);
    }
    sendData(data, onWriteComplete) {
        //23.10.19 수정 - 종료 대기 상태면 데이터를 버린다.
        if (this.isEnd() || this._endWaitingState) {
            onWriteComplete?.(this, false);
            return;
        }
        if (this._memBufferSizeLimit > 0 && ((this.isOverMemoryBufferSize(data.length) || SocketHandler.isOverGlobalMemoryBufferSize(data.length)))) {
            if (!this._fileCache) {
                this._fileCache = FileCache_1.FileCache.create(SocketHandler.FileCacheDirPath);
            }
            let record = this._fileCache.writeSync(data);
            // todo : 파일 캐시 실패시 처리
            /**if(record.id == -1) {
                return false;
            }*/
            this._waitQueue.pushBack({ buffer: EMPTY_BUFFER, cacheID: record.id, onWriteComplete: onWriteComplete });
        }
        else {
            this.appendUsageMemoryBufferSize(data.length);
            this._waitQueue.pushBack({ buffer: data, cacheID: -1, onWriteComplete: onWriteComplete });
        }
        this.sendPopDataRecursive2();
    }
    callAllDrainEvent(success) {
        while (this._drainEventList.length > 0) {
            let event = this._drainEventList.shift();
            if (event) {
                event(this, success);
            }
        }
    }
    sendPopDataRecursive2(force = false) {
        if (this._inRunWriteBuffer && !force) {
            return;
        }
        this._inRunWriteBuffer = true;
        let waitItem = undefined;
        do {
            waitItem = this.popBufferSync();
            if (!waitItem) {
                this._inRunWriteBuffer = false;
                // 종료 대기 상태고, 버퍼 큐가 비어있으면 소켓을 종료한다.
                if (this._endWaitingState) {
                    this._socket.end();
                }
                this.callAllDrainEvent(true);
                return;
            }
            if (this.isEnd()) {
                waitItem.onWriteComplete?.(this, false);
                return;
            }
            let length = waitItem.buffer.length;
            let isFileCache = waitItem.cacheID != -1;
            if (length == 0) {
                this.procError(new Error(" sendPopDataRecursive() - buffer length is zero."));
                return;
            }
            let onWriteComplete = waitItem.onWriteComplete;
            this.writeBuffer(waitItem.buffer, (client, success, err) => {
                onWriteComplete?.(client, success, err);
                if (!success) {
                    this._inRunWriteBuffer = false;
                    this.callAllDrainEvent(this._waitQueue.isEmpty());
                    return;
                }
                this._sendLength += length;
                if (!isFileCache) {
                    this.appendUsageMemoryBufferSize(-length);
                }
            });
        } while (waitItem && !this._isFullNativeBuffer);
    }
    // noinspection JSUnusedLocalSymbols
    sendPopDataRecursive() {
        if (this._inRunWriteBuffer) {
            return;
        }
        this._inRunWriteBuffer = true;
        let waitItem = this.popBufferSync();
        if (!waitItem) {
            this._inRunWriteBuffer = false;
            // 종료 대기 상태고, 버퍼 큐가 비어있으면 소켓을 종료한다.
            if (this._endWaitingState) {
                this._socket.end();
            }
            this.callAllDrainEvent(true);
            return;
        }
        if (this.isEnd()) {
            waitItem.onWriteComplete?.(this, false);
            return;
        }
        let length = waitItem.buffer.length;
        let isFileCache = waitItem.cacheID != -1;
        if (length == 0) {
            this.procError(new Error(" sendPopDataRecursive() - buffer length is zero."));
            return;
        }
        this.writeBuffer(waitItem.buffer, (client, success, err) => {
            waitItem.onWriteComplete?.(client, success, err);
            if (!success) {
                this.callAllDrainEvent(this._waitQueue.isEmpty());
                return;
            }
            this._sendLength += length;
            if (!isFileCache) {
                this.appendUsageMemoryBufferSize(-length);
            }
        });
    }
    clearWaitQueue() {
        let waitItem = this._waitQueue.popFront();
        while (waitItem) {
            waitItem.onWriteComplete?.(this, false);
            waitItem = this._waitQueue.popFront();
        }
        this._waitQueue.clear();
        this.appendUsageMemoryBufferSize(-this._memoryBufferSize);
    }
    isConnected() {
        return this._state == SocketState_1.default.Connected;
    }
    writeBuffer(buffer, onWriteComplete) {
        if (this.isEnd()) {
            onWriteComplete?.(this, false);
            return;
        }
        try {
            this._isFullNativeBuffer = !this._socket.write(buffer, (error) => {
                if (error) {
                    if (this.isEnd()) {
                        onWriteComplete?.(this, false);
                        return;
                    }
                    logger.warn(`writeBuffer() - socket.write() error(${error.message})`, error);
                    this.procError(error, false);
                    onWriteComplete?.(this, false, error);
                    return;
                }
                onWriteComplete?.(this, true);
            });
        }
        catch (e) {
            logger.warn(`writeBuffer() - socket.write() error(${e})`);
            onWriteComplete?.(this, false);
            this.procError(e, false);
        }
    }
    appendUsageMemoryBufferSize(size) {
        if (this._memBufferSizeLimit < 0) {
            return;
        }
        this._memoryBufferSize += size;
        if (this._memoryBufferSize < 0) {
            this._memoryBufferSize = 0;
        }
        SocketHandler.GlobalMemoryBufferSize += size;
        if (SocketHandler.GlobalMemoryBufferSize < 0) {
            SocketHandler.GlobalMemoryBufferSize = 0;
        }
        else if (SocketHandler.GlobalMemoryBufferSize > SocketHandler.MaxGlobalMemoryBufferSize) {
            SocketHandler.GlobalMemoryBufferSize = SocketHandler.MaxGlobalMemoryBufferSize;
        }
    }
    popBufferSync() {
        let waitItem = this._waitQueue.popFront();
        if (!waitItem) {
            return undefined;
        }
        if (waitItem.cacheID != -1 && this._fileCache) {
            let buffer = this._fileCache?.readSync(waitItem.cacheID);
            this._fileCache?.remove(waitItem.cacheID);
            waitItem.buffer = buffer ?? EMPTY_BUFFER;
            return waitItem;
        }
        return waitItem;
    }
}
exports.SocketHandler = SocketHandler;
