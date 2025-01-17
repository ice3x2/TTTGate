"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const SocketHandler_1 = require("../util/SocketHandler");
const SocketState_1 = __importDefault(require("../util/SocketState"));
const timers_1 = require("timers");
const LoggerFactory_1 = __importDefault(require("../util/logger/LoggerFactory"));
const logger = LoggerFactory_1.default.getLogger('client', 'EndPointClientPool');
const ID_BUNDLE_KEY = "i";
const SESSION_CLEANUP_INTERVAL = 10000;
class EndPointClientPool {
    _connectOptMap = new Map();
    _endPointClientMap = new Map();
    _onEndPointClientStateChangeCallback = null;
    _onEndPointTerminateCallback = null;
    _sessionCleanupIntervalID = null;
    _closeWaitTimeout = 60 * 1000;
    constructor() {
        this.startSessionCleanup();
    }
    startSessionCleanup() {
        if (this._sessionCleanupIntervalID)
            (0, timers_1.clearInterval)(this._sessionCleanupIntervalID);
        let now = Date.now();
        this._sessionCleanupIntervalID = setInterval(() => {
            let closeWaitHandlerList = Array.from(this._endPointClientMap.values())
                .filter((handler) => {
                return !!handler.closeWait;
            });
            closeWaitHandlerList.forEach((handler) => {
                this.closeIfSatisfiedLength(handler, now - handler.lastSendTime > this._closeWaitTimeout);
            });
        }, SESSION_CLEANUP_INTERVAL);
    }
    set onEndPointClientStateChangeCallback(callback) {
        this._onEndPointClientStateChangeCallback = callback;
    }
    set onEndPointTerminateCallback(callback) {
        this._onEndPointTerminateCallback = callback;
    }
    open(sessionID, connectOpt) {
        this._connectOptMap.set(sessionID, connectOpt);
        logger.info("Connect to endpoint: (sessionID " + sessionID + ") " + connectOpt.host + ":" + connectOpt.port);
        let endPointClient = SocketHandler_1.SocketHandler.connect(connectOpt, (client, state, data) => {
            client.setBufferSizeLimit(connectOpt.bufferLimit);
            this.onEndPointHandlerEvent(sessionID, client, state, data);
        });
        endPointClient.closeWait = false;
        endPointClient.lastSendTime = Date.now();
        endPointClient.endLength = 0;
        endPointClient.sessionID = sessionID;
        this._endPointClientMap.set(sessionID, endPointClient);
    }
    close(id, endLength) {
        let endPointClient = this._endPointClientMap.get(id);
        if (endPointClient) {
            endPointClient.endLength = endLength;
            endPointClient.closeWait = true;
            this.closeIfSatisfiedLength(endPointClient);
            return true;
        }
        return false;
    }
    closeIfSatisfiedLength(endPointClient, force = false) {
        if (endPointClient.closeWait) {
            let i = 100;
            i++;
        }
        if ((endPointClient.closeWait && endPointClient.endLength <= endPointClient.sendLength) || force) {
            this._endPointClientMap.delete(endPointClient.sessionID);
            endPointClient.end_();
            this._onEndPointTerminateCallback?.(endPointClient.sessionID);
        }
    }
    send(id, data) {
        let endPointClient = this._endPointClientMap.get(id);
        if (endPointClient) {
            endPointClient.lastSendTime = Date.now();
            endPointClient.sendData(data, (handler /*, success: boolean*/) => {
                this.closeIfSatisfiedLength(handler);
            });
        }
    }
    onEndPointHandlerEvent = (sessionID, client, state, data) => {
        if (!client.hasBundle(ID_BUNDLE_KEY)) {
            client.setBundle(ID_BUNDLE_KEY, sessionID);
        }
        if (this._connectOptMap.has(sessionID)) {
            // 임시 조건문
            if (state == SocketState_1.default.Connected) {
                logger.info("Successfully connected to endpoint: (sessionID " + sessionID + ") " + this._connectOptMap.get(sessionID)?.host + ":" + this._connectOptMap.get(sessionID)?.port);
            }
            let handler = client;
            this._onEndPointClientStateChangeCallback?.(sessionID, state, { data: data, receiveLength: handler.breakBufferFlush ? 0 : handler.receiveLength });
            if (!this._endPointClientMap.has(sessionID)) {
                this._endPointClientMap.set(sessionID, client);
            }
        }
        else {
            logger.warn(`Invalid sessionID(${sessionID}). Terminates the connection. (addr: ${client.remoteAddress}:${client.remotePort})`);
            client.end_();
        }
        if (SocketState_1.default.End == state || SocketState_1.default.Closed == state /*|| SocketState.Error == state*/) {
            logger.info("Disconnected from endpoint: (sessionID " + sessionID + ") " + this._connectOptMap.get(sessionID)?.host + ":" + this._connectOptMap.get(sessionID)?.port);
            let hasSession = this._endPointClientMap.has(sessionID);
            this._endPointClientMap.delete(sessionID);
            this._connectOptMap.delete(sessionID);
            if (hasSession) {
                let handler = client;
                this._onEndPointClientStateChangeCallback?.(sessionID, state, { receiveLength: handler.breakBufferFlush ? 0 : handler.receiveLength });
                setImmediate(() => {
                    this._onEndPointTerminateCallback?.(sessionID);
                });
            }
        }
    };
    closeAll() {
        this._onEndPointClientStateChangeCallback = null;
        this._endPointClientMap.forEach((client /*, key: number*/) => {
            client.destroy();
        });
        this._endPointClientMap.clear();
    }
}
exports.default = EndPointClientPool;
