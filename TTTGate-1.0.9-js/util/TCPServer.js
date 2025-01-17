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
exports.TCPServer = void 0;
const net_1 = __importDefault(require("net"));
const SocketHandler_1 = require("./SocketHandler");
const SocketState_1 = __importDefault(require("./SocketState"));
const tls = __importStar(require("tls"));
const LoggerFactory_1 = __importDefault(require("../util/logger/LoggerFactory"));
const logger = LoggerFactory_1.default.getLogger('', 'TCPServer');
const DEFAULT_KEEP_ALIVE = 10000;
;
class TCPServer {
    static DEFAULT_KEEP_ALIVE = DEFAULT_KEEP_ALIVE;
    _options;
    _server;
    _idHandlerMap = new Map();
    _onServerEvent;
    _onHandlerEvent;
    _state = SocketState_1.default.None;
    _bundle = new Map();
    _error = undefined;
    isEnd() {
        return this._state == SocketState_1.default.Closed || this._state == SocketState_1.default.End;
    }
    getError() {
        return this._error;
    }
    isListen() {
        return this._state == SocketState_1.default.Listen;
    }
    setOnServerEvent(event) {
        this._onServerEvent = event;
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
    get port() {
        return this._options.port;
    }
    setOnHandlerEvent(event) {
        this._onHandlerEvent = event;
    }
    constructor(options) {
        options.tls = options.tls ?? false;
        this._options = options;
        this._options.keepAlive = this._options.keepAlive ?? DEFAULT_KEEP_ALIVE;
        if (options.tls) {
            let tlsOption = {
                key: options.key,
                cert: options.cert,
                secureProtocol: 'TLSv1_2_server_method'
            };
            if (options.ca) {
                tlsOption.ca = options.ca;
            }
            this._server = tls.createServer(tlsOption, this.onBind);
        }
        else {
            this._server = net_1.default.createServer(this.onBind);
        }
        this._server.on('error', (error) => {
            this._error = error;
            if (!this.isEnd()) {
                logger.error(`TCPServer: error: ${error}`);
                this._state = SocketState_1.default.Closed;
                this._onServerEvent?.(this, SocketState_1.default.Closed);
                this.release();
            }
            this._state = SocketState_1.default.Closed;
        });
        this._server.on('close', () => {
            if (!this.isEnd()) {
                this._state = SocketState_1.default.Closed;
                this._onServerEvent?.(this, SocketState_1.default.Closed);
                this.release();
            }
            this._state = SocketState_1.default.Closed;
        });
        this._server.on('listening', () => {
            if (this._state == SocketState_1.default.Starting) {
                this._state = SocketState_1.default.Listen;
                this._onServerEvent?.(this, SocketState_1.default.Listen);
            }
        });
    }
    onBind = (socket) => {
        let option = { socket: socket, port: this._options.port, addr: "127.0.0.1", tls: this._options.tls ?? false, keepAlive: this._options.keepAlive ?? DEFAULT_KEEP_ALIVE };
        let handler = SocketHandler_1.SocketHandler.bound(option, (handler, state, data) => {
            if (state == SocketState_1.default.Closed || /*state == SocketState.Error ||*/ state == SocketState_1.default.End) {
                this._idHandlerMap.delete(handler.id);
            }
            this._onHandlerEvent?.(handler, state, data);
        });
        this._idHandlerMap.set(handler.id, handler);
        this._onServerEvent?.(this, SocketState_1.default.Bound, handler);
    };
    static create(options) {
        return new TCPServer(options);
    }
    start(callback) {
        if (this.isEnd()) {
            this._server = net_1.default.createServer(this.onBind);
            this._state = SocketState_1.default.None;
        }
        if (this._state == SocketState_1.default.None) {
            if (callback) {
                this._server.once('listening', () => {
                    callback(undefined);
                });
                this._server.once('error', (err) => {
                    callback(err);
                });
            }
            this._state = SocketState_1.default.Starting;
            this._server.listen(this._options.port);
        }
    }
    stop(callback) {
        if (!this.isEnd()) {
            this._idHandlerMap.forEach((handler) => {
                handler.destroy();
            });
            this._server.once('close', () => {
                callback?.(undefined);
                this.release();
            });
            this._server.on('error', (err) => {
                callback?.(err);
                this.release();
            });
            this._server.close();
        }
        else if (callback) {
            callback(new Error("Server is already closed"));
        }
    }
    release() {
        this._server.removeAllListeners();
        this._onServerEvent = undefined;
        this._onHandlerEvent = undefined;
    }
}
exports.TCPServer = TCPServer;
