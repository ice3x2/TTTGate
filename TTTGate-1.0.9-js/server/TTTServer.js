"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ExternalPortServerPool_1 = require("./ExternalPortServerPool");
const TunnelServer_1 = require("./TunnelServer");
const SocketState_1 = __importDefault(require("../util/SocketState"));
const CertificationStore_1 = require("./CertificationStore");
const ServerOptionStore_1 = __importDefault(require("./ServerOptionStore"));
const LoggerFactory_1 = __importDefault(require("../util/logger/LoggerFactory"));
const logger = LoggerFactory_1.default.getLogger('server', 'TTTServer');
/**
  ExportPortServerPool은 외부에서 들어온 handler 만 관리한다.
  Ctrl 은 TunnelServer에서 관리한다.
 */
class TTTServer {
    _externalPortServerPool;
    _tunnelServer;
    _sessions = new Set();
    _allowClientNamesMap = new Map();
    static create(serverOption) {
        return new TTTServer(serverOption);
    }
    constructor(serverOption) {
        if (serverOption.tls == undefined)
            serverOption.tls = false;
        this._externalPortServerPool = ExternalPortServerPool_1.ExternalPortServerPool.create(serverOption.tunnelingOptions);
        let tempCert = CertificationStore_1.CertificationStore.instance.getTempCert();
        this._tunnelServer = TunnelServer_1.TunnelServer.create({ port: serverOption.port, key: serverOption.key, tls: serverOption.tls, keepAlive: serverOption.keepAlive }, tempCert);
        this._externalPortServerPool.OnHandlerEventCallback = this.onHandlerEventOnExternalPortServer;
        this._externalPortServerPool.OnNewSessionCallback = this.onNewSession;
        this._externalPortServerPool.OnTerminateSessionCallback = this.OnTerminateSession;
        this._tunnelServer.onSessionCloseCallback = this.onSessionClosed;
        this._tunnelServer.onReceiveDataCallback = this.onSessionDataReceived;
        serverOption.tunnelingOptions.forEach((option) => {
            if (option.allowedClientNames && option.allowedClientNames.length > 0) {
                this._allowClientNamesMap.set(option.forwardPort, option.allowedClientNames);
            }
        });
    }
    onNewSession = (id, opt) => {
        let bufferLimitOnClient = opt.bufferLimitOnClient == undefined || opt.bufferLimitOnClient < 1 ? -1 : opt.bufferLimitOnClient * 1024 * 1024;
        this._sessions.add(id);
        let allowClientNames = this._allowClientNamesMap.get(opt.forwardPort);
        let success = this._tunnelServer.openSession(id, { host: opt.destinationAddress, port: opt.destinationPort, tls: opt.tls, bufferLimit: bufferLimitOnClient }, allowClientNames);
        if (!success) {
            this._sessions.delete(id);
            this._externalPortServerPool.closeSession(id, 0);
        }
    };
    OnTerminateSession = (sessionID) => {
        this._tunnelServer.terminateSession(sessionID);
        this._sessions.delete(sessionID);
    };
    onHandlerEventOnExternalPortServer = (id, state, bundle) => {
        if (this.isEndState(state)) {
            this._tunnelServer.closeSession(id, bundle.receiveLength);
        }
        else if (state == SocketState_1.default.Receive) {
            this._tunnelServer.sendBuffer(id, bundle.data);
        }
    };
    onSessionClosed = (id, endLength) => {
        this._externalPortServerPool.closeSession(id, endLength);
    };
    onSessionDataReceived = (id, data) => {
        if (!this._externalPortServerPool.send(id, data)) {
            //this._tunnelServer.closeSession(id, 0);
        }
    };
    isEndState(state) {
        return state == SocketState_1.default.Closed || state == SocketState_1.default.End /*|| state == SocketState.Error;*/;
    }
    externalServerStatuses() {
        let result = new Array();
        let serverOption = ServerOptionStore_1.default.instance.serverOption;
        for (let tunnelOption of serverOption.tunnelingOptions) {
            result.push(this._externalPortServerPool.getServerStatus(tunnelOption.forwardPort));
        }
        return result;
    }
    externalServerStatus(port) {
        return this._externalPortServerPool.getServerStatus(port);
    }
    clientStatus() {
        return this._tunnelServer.clientStatuses();
    }
    async stopExternalPortServer(port) {
        this._allowClientNamesMap.delete(port);
        return await this._externalPortServerPool.stop(port);
    }
    async activeExternalPortServer(port, timeout) {
        return await this._externalPortServerPool.active(port, timeout);
    }
    async inactiveExternalPortServer(port) {
        return await this._externalPortServerPool.inactive(port);
    }
    async updateAndRestartExternalPortServer(port) {
        let optionStore = ServerOptionStore_1.default.instance;
        let tunnelOption = optionStore.getTunnelingOption(port);
        if (!tunnelOption) {
            return false;
        }
        this._allowClientNamesMap.delete(port);
        if (tunnelOption.allowedClientNames && tunnelOption.allowedClientNames.length > 0) {
            this._allowClientNamesMap.set(port, tunnelOption.allowedClientNames);
        }
        let lastServerStatus = this._externalPortServerPool.getServerStatus(port);
        await this._externalPortServerPool.stop(port);
        let success = await this._externalPortServerPool.startServer(tunnelOption, CertificationStore_1.CertificationStore.instance.getExternalCert(port));
        if (success && lastServerStatus && lastServerStatus.online) {
            this._externalPortServerPool.setActiveTimeout(port, lastServerStatus.activeTimeout);
            if (!tunnelOption.inactiveOnStartup)
                await this._externalPortServerPool.active(port);
        }
        return success;
    }
    async start() {
        let optionStore = ServerOptionStore_1.default.instance;
        let tunnelOptions = optionStore.getTunnelingOptions();
        let certStore = CertificationStore_1.CertificationStore.instance;
        for (let tunnelOption of tunnelOptions) {
            try {
                await this._externalPortServerPool.startServer(tunnelOption, certStore.getExternalCert(tunnelOption.forwardPort));
            }
            catch (err) {
                logger.error(`start - failed to start external port server. ${JSON.stringify(tunnelOption)}`, err);
            }
        }
        await this._tunnelServer.start();
    }
    async close() {
        await this._externalPortServerPool.stopAll();
        await this._tunnelServer.close();
    }
    getClientSysInfo(clientID) {
        return this._tunnelServer.getClientSysInfo(clientID);
    }
}
exports.default = TTTServer;
