"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExternalPortServerPool = void 0;
const TCPServer_1 = require("../util/TCPServer");
const SocketState_1 = __importDefault(require("../util/SocketState"));
const HttpHandler_1 = __importDefault(require("./http/HttpHandler"));
const ObjectUtil_1 = __importDefault(require("../util/ObjectUtil"));
const timers_1 = require("timers");
const LoggerFactory_1 = __importDefault(require("../util/logger/LoggerFactory"));
const logger = LoggerFactory_1.default.getLogger('server', 'ExternalPortServerPool');
const OPTION_BUNDLE_KEY = "portTunnelOption";
const PORT_BUNDLE_KEY = "portNumber";
const SESSION_ID_BUNDLE_KEY = "ID";
const SESSION_CLEANUP_INTERVAL = 10000;
class ExternalPortServerPool {
    _portServerMap = new Map();
    _statusMap = new Map();
    _handlerMap = new Map();
    _activeTimeoutMap = new Map();
    _onNewSessionCallback = null;
    _onHandlerEventCallback = null;
    _onTerminateSessionCallback = null;
    _closeWaitTimeout = 60 * 1000;
    static LAST_SESSION_ID = 1;
    _sessionCleanupIntervalID = null;
    static create(options) {
        return new ExternalPortServerPool(options);
    }
    constructor(options) {
        for (let option of options) {
            try {
                option = this.optionNormalization(option);
            }
            catch (e) {
                console.error(e);
            }
        }
        this.startSessionCleanup();
    }
    startSessionCleanup() {
        if (this._sessionCleanupIntervalID)
            (0, timers_1.clearInterval)(this._sessionCleanupIntervalID);
        let now = Date.now();
        this._sessionCleanupIntervalID = setInterval(() => {
            let closeWaitHandlerList = Array.from(this._handlerMap.values())
                .filter((handler) => {
                return !!handler.closeWait;
            });
            closeWaitHandlerList.forEach((handler) => {
                this.closeIfSatisfiedLength(handler, now - handler.lastSendTime > this._closeWaitTimeout);
            });
        }, SESSION_CLEANUP_INTERVAL);
    }
    async startServer(option, certInfo) {
        let server = this._portServerMap.get(option.forwardPort);
        if (server && !server.isEnd()) {
            return false;
        }
        option.keepAlive = option.keepAlive ?? TCPServer_1.TCPServer.DEFAULT_KEEP_ALIVE;
        if (option.keepAlive > 0) {
            option.keepAlive = Math.max(option.keepAlive, 500);
        }
        return new Promise((resolve, reject) => {
            let options = {
                port: option.forwardPort,
                tls: option.tls,
                key: certInfo?.key.value,
                cert: certInfo?.cert.value,
                ca: certInfo?.ca.value == '' ? undefined : certInfo?.ca.value,
                keepAlive: option.keepAlive
            };
            let portServer = TCPServer_1.TCPServer.create(options);
            portServer.setOnServerEvent(this.onServerEvent);
            portServer.setOnHandlerEvent(this.onHandlerEvent);
            portServer.setBundle(OPTION_BUNDLE_KEY, option);
            if (!option.inactiveOnStartup)
                option.inactiveOnStartup = false;
            this._statusMap.set(option.forwardPort, { port: option.forwardPort, online: false, sessions: 0, rx: 0, tx: 0, uptime: 0,
                active: !option.inactiveOnStartup, activeTimeout: 0, activeStart: option.inactiveOnStartup ? Date.now() : 0 });
            portServer.start((err) => {
                if (err) {
                    logger.error(`startServer - port: ${option.forwardPort}`, err);
                    reject(err);
                    return;
                }
                let status = this._statusMap.get(option.forwardPort);
                if (status) {
                    status.online = true;
                    status.uptime = Date.now();
                }
                let simpleOption = ObjectUtil_1.default.cloneDeep(option);
                delete simpleOption['certInfo'];
                logger.info(`startServer - port: ${option.forwardPort}, option: ${JSON.stringify(simpleOption)}`);
                this._portServerMap.set(option.forwardPort, portServer);
                resolve(true);
            });
        });
    }
    optionNormalization(option) {
        if (option.tls == undefined) {
            option.tls = false;
        }
        if (option.protocol == "http" && option.destinationPort == undefined) {
            option.destinationPort = 80;
        }
        else if (option.protocol == "https") {
            if (option.destinationPort == undefined)
                option.destinationPort = 443;
            option.tls = true;
        }
        if (option.destinationPort == undefined) {
            throw new Error("DestinationPort is undefined");
        }
        return option;
    }
    set OnNewSessionCallback(callback) {
        this._onNewSessionCallback = callback;
    }
    set OnHandlerEventCallback(callback) {
        this._onHandlerEventCallback = callback;
    }
    set OnTerminateSessionCallback(callback) {
        this._onTerminateSessionCallback = callback;
    }
    getServerStatus(port) {
        let status = this._statusMap.get(port);
        if (!status) {
            return { port: port, online: false, sessions: 0, rx: 0, tx: 0, uptime: 0, active: false, activeTimeout: 0, activeStart: 0 };
        }
        return status;
    }
    send(id, data) {
        let handler = this._handlerMap.get(id);
        if (handler) {
            handler.lastSendTime = Date.now();
            handler.sendData(data, (handler, success) => {
                this.onSendDataCallback(handler, success);
            });
            let portNumber = handler.getBundle(PORT_BUNDLE_KEY);
            let status = this._statusMap.get(portNumber);
            if (status) {
                status.tx += data.length;
            }
            return true;
        }
        return false;
    }
    onSendDataCallback = (handler, success) => {
        if (success) {
            this.closeIfSatisfiedLength(handler);
        }
    };
    closeSession(id, endLength) {
        let handler = this._handlerMap.get(id);
        if (handler) {
            handler.endLength = endLength;
            handler.closeWait = true;
            this.closeIfSatisfiedLength(handler);
        }
    }
    closeIfSatisfiedLength(endPointClient, force = false) {
        if ((endPointClient.closeWait && endPointClient.endLength <= endPointClient.sendLength) || force) {
            endPointClient.onSocketEvent = function () { };
            endPointClient.end_();
            logger.info(`End client - sessionID:${endPointClient.sessionID}, left connections: ${this._handlerMap.size}`);
            this._handlerMap.delete(endPointClient.sessionID);
            this._onTerminateSessionCallback?.(endPointClient.sessionID);
        }
    }
    onHandlerEvent = (handler, state, data) => {
        let sessionID = handler.getBundle(SESSION_ID_BUNDLE_KEY);
        if (SocketState_1.default.Receive == state) {
            let portNumber = handler.getBundle(PORT_BUNDLE_KEY);
            let status = this._statusMap.get(portNumber);
            if (status) {
                status.rx += data.length;
            }
            this._onHandlerEventCallback?.(sessionID, state, { data: data, receiveLength: handler.receiveLength });
        }
        else if (sessionID && (state == SocketState_1.default.End || state == SocketState_1.default.Closed)) {
            this.updateCount(handler.getBundle(OPTION_BUNDLE_KEY).forwardPort, false);
            if (this._handlerMap.has(sessionID)) {
                this._onHandlerEventCallback?.(sessionID, SocketState_1.default.Closed, {
                    data: data,
                    receiveLength: handler.breakBufferFlush ? 0 : handler.receiveLength
                });
                this._handlerMap.delete(sessionID);
            }
            setImmediate(() => {
                this._onTerminateSessionCallback?.(sessionID);
            });
            logger.info(`End - id: ${sessionID}, port: ${handler.getBundle(OPTION_BUNDLE_KEY).forwardPort}`);
            handler.destroy();
        }
        else if (SocketState_1.default.Closed == state) {
        }
    };
    onServerEvent = (server, state, handlerOpt) => {
        if (SocketState_1.default.Listen == state) {
            logger.info(`Listen - port: ${server.port}`);
        }
        if (server.isEnd()) {
            let error = server.getError();
            if (error) {
                logger.error(`Error - port: ${server.port}`, error);
            }
            else
                logger.info(`End - port: ${server.port}`);
            let destPort = server.getBundle(OPTION_BUNDLE_KEY).destinationPort;
            this._portServerMap.delete(destPort);
        }
        else if (state == SocketState_1.default.Bound) {
            let handler = handlerOpt;
            let sessionID = ExternalPortServerPool.LAST_SESSION_ID++;
            handler.setBundle(SESSION_ID_BUNDLE_KEY, sessionID);
            let option = server.getBundle(OPTION_BUNDLE_KEY);
            if (!option) {
                logger.error(`Error - port: ${server.port}, Option is undefined`);
                handler.destroy();
                server.stop();
                return;
            }
            if (handler.socket && option.keepAlive > 0) {
                handler.socket.setNoDelay(true);
                handler.socket.setKeepAlive(true, option.keepAlive);
            }
            let status = this._statusMap.get(server.port);
            if (status && !status.active) {
                handler.end_();
                return;
            }
            option = option;
            let bufferSizeLimit = option.bufferLimitOnServer == undefined || option.bufferLimitOnServer < 1 ? -1 : option.bufferLimitOnServer * 1024 * 1024;
            handler.setBufferSizeLimit(bufferSizeLimit);
            handler.setBundle(OPTION_BUNDLE_KEY, option);
            handler.setBundle(PORT_BUNDLE_KEY, server.port);
            if (option.protocol == "http" || option.protocol == "https") {
                logger.info(`Bound HttpHandler - id:${sessionID}, port:${server.port}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
                let httpHandler = HttpHandler_1.default.create(handler, option);
                httpHandler.onSocketEvent = this.onHandlerEvent;
                this.initEndPointInfo(httpHandler, sessionID, 'http');
                this._handlerMap.set(sessionID, httpHandler);
            }
            else {
                logger.info(`Bound SocketHandler - id:${sessionID}, port: ${server.port}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
                this.initEndPointInfo(handler, sessionID, 'tcp');
                this._handlerMap.set(sessionID, handler);
            }
            this.updateCount(server.port, true);
            this._onNewSessionCallback?.(sessionID, option);
        }
    };
    initEndPointInfo(endpointInfo, sessionID, type) {
        endpointInfo.closeWait = false;
        endpointInfo.endLength = 0;
        endpointInfo.lastSendTime = Date.now();
        endpointInfo.sessionID = sessionID;
        endpointInfo.protocolType = type;
    }
    updateCount(port, increase) {
        let status = this._statusMap.get(port);
        if (!status) {
            return;
        }
        status.sessions += increase ? 1 : -1;
        status.sessions = Math.max(0, status.sessions);
    }
    async stop(port) {
        let server = this._portServerMap.get(port);
        if (!server) {
            return false;
        }
        await this.removeHandlerByForwardPort(port);
        return new Promise((resolve) => {
            server?.stop((err) => {
                resolve(err != undefined);
            });
        });
    }
    async destroyHandlers(ids) {
        let handlers = [];
        for (let id of ids) {
            let handler = this._handlerMap.get(id);
            if (handler) {
                handlers.push(handler);
                handler.destroy();
            }
        }
        return new Promise((resolve) => {
            if (handlers.length == 0) {
                resolve();
                return;
            }
            while (handlers.length > 0) {
                let handler = handlers.pop();
                handler.destroy();
            }
            resolve();
        });
    }
    async removeHandlerByForwardPort(port) {
        let ids = Array.from(this._handlerMap.values())
            .filter((handler) => handler.getBundle(OPTION_BUNDLE_KEY)?.forwardPort == port)
            .map((handler) => { return handler.getBundle(SESSION_ID_BUNDLE_KEY); });
        await this.destroyHandlers(ids);
    }
    async inactive(port) {
        let status = this._statusMap.get(port);
        if (!status) {
            return false;
        }
        status.active = false;
        await this.removeHandlerByForwardPort(port);
        return true;
    }
    setActiveTimeout(port, timeout) {
        let status = this._statusMap.get(port);
        if (!status) {
            return false;
        }
        status.activeTimeout = timeout;
        return true;
    }
    async active(port, timeout) {
        let status = this._statusMap.get(port);
        if (!status) {
            return false;
        }
        if (timeout == undefined)
            timeout = status.activeTimeout;
        let timeoutCtrl = this._activeTimeoutMap.get(port);
        if (timeoutCtrl != undefined)
            clearTimeout(timeoutCtrl);
        status.active = true;
        status.activeTimeout = timeout;
        status.activeStart = Date.now();
        if (timeout > 0) {
            timeoutCtrl = setTimeout(async () => {
                await this.inactive(port);
            }, timeout * 1000);
            this._activeTimeoutMap.set(port, timeoutCtrl);
        }
        return true;
    }
    async stopAll() {
        if (this._sessionCleanupIntervalID) {
            (0, timers_1.clearInterval)(this._sessionCleanupIntervalID);
            this._sessionCleanupIntervalID = null;
        }
        logger.info(`closeAll`);
        let callbackCount = this._portServerMap.size;
        if (callbackCount == 0)
            return;
        return new Promise((resolve) => {
            this._portServerMap.forEach((server, port) => {
                server.stop(() => {
                    callbackCount--;
                    logger.info(`close - port: ${port}, left count: ${callbackCount}`);
                    if (callbackCount == 0) {
                        logger.info(`closeAll - done`);
                        this._portServerMap.clear();
                        this._handlerMap.clear();
                        resolve();
                    }
                });
            });
        });
    }
}
exports.ExternalPortServerPool = ExternalPortServerPool;
