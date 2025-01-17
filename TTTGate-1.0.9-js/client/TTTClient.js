"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const TunnelClient_1 = require("./TunnelClient");
const SocketState_1 = __importDefault(require("../util/SocketState"));
const EndPointClientPool_1 = __importDefault(require("./EndPointClientPool"));
const LoggerFactory_1 = __importDefault(require("../util/logger/LoggerFactory"));
const logger = LoggerFactory_1.default.getLogger('client', 'TTTClient');
const RECONNECT_INTERVAL = 5000;
class TTTClient {
    _clientOption;
    _endPointClientPool;
    _tunnelClient;
    _tryConnectState = false;
    _isOnline = false;
    constructor(clientOption) {
        this._clientOption = clientOption;
    }
    static create(clientOption) {
        return new TTTClient(clientOption);
    }
    start() {
        this._endPointClientPool = new EndPointClientPool_1.default();
        this._tunnelClient = TunnelClient_1.TunnelClient.create(this._clientOption);
        this._tunnelClient.onCtrlStateCallback = this.onCtrlStateCallback;
        this._tunnelClient.onConnectEndPointCallback = this.onSessionOpenCallback;
        this._tunnelClient.onReceiveDataCallback = this.onSessionSendCallback;
        this._tunnelClient.onEndPointCloseCallback = this.onSessionCloseCallback;
        this._endPointClientPool.onEndPointClientStateChangeCallback = this.onEndPointClientStateChangeCallback;
        this._endPointClientPool.onEndPointTerminateCallback = this.onEndPointTerminateCallback;
        logger.info(` try connect to ${this._clientOption.host}:${this._clientOption.port}`);
        logger.info(` option: ${JSON.stringify(this._clientOption)}`);
        this._tryConnectState = true;
        this._tunnelClient.connect();
    }
    onCtrlStateCallback = (client, state, error) => {
        if (state == 'closed') {
            if (!this._isOnline && !this._tryConnectState) {
                return;
            }
            this._tryConnectState = false;
            this._isOnline = false;
            logger.error(`Connection closed.`, error);
            this._endPointClientPool.closeAll();
            logger.info(`Try reconnect after ${RECONNECT_INTERVAL}ms`);
            setTimeout(() => {
                this.start();
                logger.info(`Try reconnect to ${this._clientOption.host}:${this._clientOption.port}`);
                logger.info(`Option: ${JSON.stringify(this._clientOption)}`);
            }, RECONNECT_INTERVAL);
        }
        else if (state == 'connected') {
            logger.info(` connection established.`);
            this._isOnline = true;
            this._tryConnectState = false;
        }
    };
    onSessionOpenCallback = (id, opt) => {
        this._endPointClientPool.open(id, opt);
    };
    onSessionCloseCallback = (id, waitForSendLength) => {
        logger.info("A request has been received to close the session. id: " + id + ", waitForSendLength: " + waitForSendLength);
        this._endPointClientPool.close(id, waitForSendLength);
    };
    onSessionSendCallback = (id, data) => {
        this._endPointClientPool.send(id, data);
    };
    onEndPointTerminateCallback = (sessionID) => {
        this._tunnelClient.terminateEndPointSession(sessionID);
    };
    onEndPointClientStateChangeCallback = (sessionID, state, bundle) => {
        if (state == SocketState_1.default.Connected) {
            this._tunnelClient.syncEndpointSession(sessionID);
        }
        else if (state == SocketState_1.default.End || /*state == SocketState.Error ||*/ state == SocketState_1.default.Closed) {
            this._tunnelClient.closeEndPointSession(sessionID, bundle.receiveLength);
        }
        else if (state == SocketState_1.default.Receive) {
            this._tunnelClient.sendData(sessionID, bundle?.data);
        }
    };
}
exports.default = TTTClient;
