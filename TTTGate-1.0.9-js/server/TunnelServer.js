"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TunnelServer = void 0;
const TCPServer_1 = require("../util/TCPServer");
const SocketState_1 = __importDefault(require("../util/SocketState"));
const CtrlPacket_1 = require("../commons/CtrlPacket");
const buffer_1 = require("buffer");
const ClientHandlerPool_1 = require("./ClientHandlerPool");
const timers_1 = require("timers");
const TunnelHandler_1 = require("../types/TunnelHandler");
const DataStatePacket_1 = __importDefault(require("../commons/DataStatePacket"));
const LoggerFactory_1 = __importDefault(require("../util/logger/LoggerFactory"));
const logger = LoggerFactory_1.default.getLogger('server', 'TunnelServer');
const HANDLER_TYPE_BUNDLE_KEY = 'T';
class TunnelServer {
    _serverOption;
    _clientHandlerPoolMap = new Map();
    _sessionIDAndCtrlIDMap = new Map();
    _tunnelServer;
    _key;
    isRunning = false;
    _heartbeatInterval;
    _nextSelectIdx = 0;
    _onSessionCloseCallback;
    _onReceiveDataCallback;
    set onSessionCloseCallback(value) {
        this._onSessionCloseCallback = value;
    }
    set onReceiveDataCallback(value) {
        this._onReceiveDataCallback = value;
    }
    constructor(option, certInfo) {
        this._serverOption = option;
        this._key = option.key;
        let tcpServerOption = { port: option.port, tls: option.tls, key: certInfo.key.value, cert: certInfo.cert.value, ca: (certInfo.ca.value == '') ? undefined : certInfo.ca.value };
        this._tunnelServer = TCPServer_1.TCPServer.create(tcpServerOption);
    }
    static create(option, certInfo) {
        return new TunnelServer(option, certInfo);
    }
    get port() {
        return this._serverOption.port;
    }
    get tls() {
        return this._serverOption.tls === undefined ? false : this._serverOption.tls;
    }
    async start() {
        return new Promise((resolve, reject) => {
            this._tunnelServer.setOnServerEvent(this.onServerEvent);
            this._tunnelServer.setOnHandlerEvent(this.onHandlerEvent);
            this._tunnelServer.start((err) => {
                if (err) {
                    reject(err);
                }
                else {
                    this.isRunning = true;
                    resolve();
                }
            });
        });
    }
    /**
     * 클라이언트 체크 인터벌을 종료한다.
     * @private
     */
    stopClientCheckInterval() {
        if (this._heartbeatInterval) {
            (0, timers_1.clearInterval)(this._heartbeatInterval);
            this._heartbeatInterval = undefined;
        }
    }
    clientStatuses() {
        let result = [];
        this._clientHandlerPoolMap.forEach((handlerPool, ctrlID) => {
            result.push({
                id: ctrlID,
                name: handlerPool.name,
                uptime: Date.now() - handlerPool.createTime,
                address: handlerPool.address,
                activeSessionCount: handlerPool.activatedSessionCount,
            });
        });
        return result;
    }
    /**
     * 서버를 종료한다.
     */
    async close() {
        logger.info(`close`);
        this.isRunning = false;
        return new Promise((resolve) => {
            if (this._heartbeatInterval) {
                (0, timers_1.clearInterval)(this._heartbeatInterval);
            }
            this._clientHandlerPoolMap.forEach((handlerPool) => {
                handlerPool.getAllSessionIDs().forEach((id) => { this._onSessionCloseCallback?.(id, 0); });
                handlerPool.end();
            });
            this.stopClientCheckInterval();
            // noinspection JSUnusedLocalSymbols
            this._tunnelServer.stop((err) => {
                logger.info(`closed`);
                resolve();
            });
        });
    }
    /**
     * 해당 세션의 데이터를 전송한다.
     * 세션에 할당된 데이터 핸들러를 찾아서 데이터를 전송한다.
     * @param sessionId 세션ID
     * @param buffer 전송할 데이터
     * @return 성공여부
     */
    sendBuffer(sessionId, buffer) {
        if (!this.available()) {
            return false;
        }
        let ctrlID = this._sessionIDAndCtrlIDMap.get(sessionId);
        if (ctrlID == undefined) {
            return false;
        }
        let handlerPool = this._clientHandlerPoolMap.get(ctrlID);
        if (!handlerPool) {
            return false;
        }
        return handlerPool.sendBuffer(sessionId, buffer);
    }
    /**
     * 세션을 연다.
     * @param sessionID 새로운 세션ID
     * @param opt 연결할 End Point 서버에 대한 정보.
     * @param allowClientNames 허용할 클라이언트 이름 목록. 목록에 포함된 클라이언트만 세션을 연다. 목록이 없으면 모든 클라이언트를 허용한다.
     */
    openSession(sessionID, opt, allowClientNames) {
        if (!this.available()) {
            return false;
        }
        let handlerPool = this.getNextHandlerPool(allowClientNames);
        if (handlerPool == null) {
            return false;
        }
        this._sessionIDAndCtrlIDMap.set(sessionID, handlerPool.id);
        handlerPool.sendConnectEndPoint(sessionID, opt);
        return true;
    }
    available() {
        return this._clientHandlerPoolMap.size > 0;
    }
    getNextHandlerPool(allowClientNames) {
        if (this._clientHandlerPoolMap.size == 0) {
            return null;
        }
        let ids = [];
        if (!allowClientNames || allowClientNames.length == 0) {
            ids = Array.from(this._clientHandlerPoolMap.keys());
        }
        else {
            this._clientHandlerPoolMap.forEach((handlerPool, ctrlID) => {
                if (allowClientNames.includes(handlerPool.name)) {
                    ids.push(ctrlID);
                }
            });
        }
        if (ids.length == 1) {
            return this._clientHandlerPoolMap.get(ids[0]);
        }
        let nextId = ids[++this._nextSelectIdx % ids.length];
        return this._clientHandlerPoolMap.get(nextId);
    }
    onServerEvent = (server, state, handler) => {
        if (SocketState_1.default.Listen == state) {
            logger.info(`Listen: ${this._serverOption.port}`);
        }
        if (state == SocketState_1.default.Bound && handler) {
            if (!this.isRunning) {
                handler.end_();
                return;
            }
            logger.info(`Bound - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
            this.onClientHandlerBound(handler);
        }
    };
    onClientHandlerBound = (handler) => {
        handler.handlerType = TunnelHandler_1.HandlerType.Unknown;
        handler.setBundle(HANDLER_TYPE_BUNDLE_KEY, TunnelHandler_1.HandlerType.Unknown);
        logger.info(`Bound - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
    };
    sendSyncCtrlAck(ctrlHandler) {
        let sendBuffer = CtrlPacket_1.CtrlPacket.createSyncCtrlAck(ctrlHandler.id).toBuffer();
        ctrlHandler.sendData(sendBuffer, (handler_, success, err) => {
            if (!success) {
                logger.error(`sendSyncAndSyncSyncCmd Fail - id:${ctrlHandler.id}, remote:(${ctrlHandler.socket.remoteAddress})${ctrlHandler.socket.remotePort}, ${err}`);
                ctrlHandler.destroy();
                return;
            }
            logger.info(`sendSyncAndSyncSyncCmd Success - id:${ctrlHandler.id}, remote:(${ctrlHandler.socket.remoteAddress})${ctrlHandler.socket.remotePort}`);
            ctrlHandler.ctrlState = TunnelHandler_1.CtrlState.Syncing;
        });
    }
    promoteToCtrlHandler(handler, clientName) {
        handler.ctrlState = TunnelHandler_1.CtrlState.Connected;
        let ctrlHandlerPool = ClientHandlerPool_1.ClientHandlerPool.create(handler.id, handler);
        ctrlHandlerPool.onSessionCloseCallback = (sessionID, endLength) => {
            this._onSessionCloseCallback?.(sessionID, endLength);
        };
        ctrlHandlerPool.onReceiveDataCallback = (sessionID, data) => {
            this._onReceiveDataCallback?.(sessionID, data);
        };
        ctrlHandlerPool.name = clientName;
        this._clientHandlerPoolMap.set(handler.id, ctrlHandlerPool);
    }
    onReceiveAllHandler(handler, data) {
        if (handler.handlerType == TunnelHandler_1.HandlerType.Unknown && data.length > 0) {
            let delimiter = data.toString('utf-8', 0, 1);
            if (delimiter == CtrlPacket_1.CtrlPacket.PACKET_DELIMITER) {
                let ctrlHandler = handler;
                ctrlHandler.handlerType = TunnelHandler_1.HandlerType.Control;
                ctrlHandler.packetStreamer = new CtrlPacket_1.CtrlPacketStreamer();
            }
            else if (delimiter == DataStatePacket_1.default.PACKET_DELIMITER) {
                let dataHandler = handler;
                dataHandler.handlerType = TunnelHandler_1.HandlerType.Data;
                dataHandler.dataHandlerState = TunnelHandler_1.DataHandlerState.None;
            }
            else {
                let str = data.toString('utf-8', 0, Math.min(data.length, 64)).trim().replaceAll('\n', '\\n').replaceAll('\r', '\\r');
                logger.error(`onHandlerEvent - Unknown packet. id: ${handler.id}, addr: ${handler.remoteAddress}:${handler.remotePort}, data: ${str}...`);
                handler.end_();
                return;
            }
        }
        if (handler.handlerType == TunnelHandler_1.HandlerType.Control) {
            this.onReceiveCtrlHandler(handler, data);
        }
        else if (handler.handlerType == TunnelHandler_1.HandlerType.Data) {
            this.onReceiveDataHandler(handler, data);
        }
        else {
            logger.error(`onHandlerEvent - Unknown HandlerType. id: ${handler.id}`);
            handler.end_();
            return;
        }
    }
    /**
     * 데이터 핸들러에서 데이터를 받았을때 호출된다.
     * @param handler
     * @param data
     * @private
     */
    onReceiveDataHandler(handler, data) {
        if (handler.dataHandlerState == TunnelHandler_1.DataHandlerState.None) {
            if (handler.leftOverBuffer) {
                data = buffer_1.Buffer.concat([handler.leftOverBuffer, data]);
                handler.leftOverBuffer = undefined;
            }
            try {
                let result = DataStatePacket_1.default.fromBuffer(data);
                if (result.packet) {
                    handler.dataHandlerState = TunnelHandler_1.DataHandlerState.Initializing;
                    handler.leftOverBuffer = undefined;
                    handler.ctrlID = result.packet.ctrlID;
                    handler.handlerID = result.packet.handlerID;
                    handler.sessionID = result.packet.firstSessionID;
                    let clientHandlerPool = this._clientHandlerPoolMap.get(handler.ctrlID);
                    if (!clientHandlerPool) {
                        logger.error(`onHandlerEvent - Not Found ClientHandlerPool. id: ${handler.ctrlID}`);
                        handler.end_();
                        return;
                    }
                    clientHandlerPool.putNewDataHandler(handler);
                }
                else {
                    handler.leftOverBuffer = result.remainBuffer;
                }
            }
            catch (e) {
                // todo : 에러 출력기 구현
                logger.error(`onHandlerEvent - DataStatePacket.fromBuffer Fail. sessionID: ${handler.sessionID}`, e);
                handler.endImmediate();
                return;
            }
        }
        else {
            let ctrlPool = this.findClientHandlerPool(handler.sessionID);
            if (!ctrlPool) {
                this._onSessionCloseCallback?.(handler.sessionID, 0);
                return;
            }
            if (!ctrlPool.pushReceiveBuffer(handler.sessionID, data)) {
                this._onSessionCloseCallback?.(handler.sessionID, 0);
            }
            return;
        }
    }
    findClientHandlerPool(sessionId) {
        let ctrlID = this._sessionIDAndCtrlIDMap.get(sessionId);
        if (ctrlID == undefined) {
            return undefined;
        }
        let clientHandlerPool = this._clientHandlerPoolMap.get(ctrlID);
        if (!clientHandlerPool) {
            return undefined;
        }
        return clientHandlerPool;
    }
    /**
     * 컨트롤 핸들러에서 데이터를 받았을때 호출된다.
     * @param handler
     * @param data
     * @private
     */
    onReceiveCtrlHandler(handler, data) {
        let packetList = [];
        try {
            packetList = handler.packetStreamer.readCtrlPacketList(data);
        }
        catch (e) {
            logger.error(`onHandlerEvent - CtrlPacketStreamer.readCtrlPacketList Fail. ctrlID: ${handler.id}`, e);
            if (handler.handlerType == TunnelHandler_1.HandlerType.Control) {
                logger.error(`onHandlerEvent - CtrlPacketStreamer.readCtrlPacketList Fail. ctrlID: ${handler.id}, ${e}`);
                this.destroyClientHandlerPool(handler.id);
                return;
            }
            else {
                handler.destroy();
            }
            return;
        }
        for (let i = 0, len = packetList.length; i < len; i++) {
            let packet = packetList[i];
            this.onReceiveCtrlPacket(handler, packet);
        }
    }
    terminateSession(sessionId) {
        let pool = this.findCtrlHandlerPool(sessionId);
        this._sessionIDAndCtrlIDMap.delete(sessionId);
        if (pool == undefined) {
            return;
        }
        pool.terminateSession(sessionId);
    }
    findCtrlHandlerPool(sessionId) {
        let ctrlID = this._sessionIDAndCtrlIDMap.get(sessionId);
        if (ctrlID == undefined) {
            return undefined;
        }
        let clientHandlerPool = this._clientHandlerPoolMap.get(ctrlID);
        if (!clientHandlerPool) {
            return undefined;
        }
        return clientHandlerPool;
    }
    closeSession(sessionId, waitForLength) {
        let pool = this.findClientHandlerPool(sessionId);
        if (pool == undefined) {
            return;
        }
        pool.sendCloseSession(sessionId, waitForLength);
    }
    onReceiveCtrlPacket(handler, packet) {
        logger.info('receive ctrl packet - cmd:' + CtrlPacket_1.CtrlCmd[packet.cmd] + ', handler id: ' + handler.id + ', remote: ' + handler.remoteAddress + ':' + handler.remotePort);
        if (packet.cmd == CtrlPacket_1.CtrlCmd.SyncCtrl) {
            let ctrlHandler = handler;
            ctrlHandler.handlerType = TunnelHandler_1.HandlerType.Control;
            this.sendSyncCtrlAck(ctrlHandler);
        }
        else if (packet.cmd == CtrlPacket_1.CtrlCmd.AckCtrl) {
            if (packet.ackKey != this._key) {
                this.notMatchedAuthKey(handler);
                return;
            }
            this.promoteToCtrlHandler(handler, packet.clientName);
        }
        else {
            let ctrlID = handler.id;
            let clientHandlerPool = this._clientHandlerPoolMap.get(ctrlID);
            if (!clientHandlerPool) {
                logger.error(`onHandlerEvent - Not Found ClientHandlerPool. id: ${ctrlID}`);
                handler.end_();
                return;
            }
            clientHandlerPool.delegateReceivePacketOfControlHandler(handler, packet);
        }
    }
    notMatchedAuthKey(handler) {
        logger.error(`Authkey is not matched. id: ${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
        let packet = CtrlPacket_1.CtrlPacket.message(handler.id, { type: 'log', payload: '<Fatal> Authkey is not matched.' });
        handler.sendData(packet.toBuffer());
        this._clientHandlerPoolMap.delete(handler.id);
        setTimeout(() => {
            handler.destroy();
        }, 1000);
    }
    /**
     * 클라이언트 핸들러로부터 이벤트를 받았을때 호출된다.
     * Receive 이벤트는 클라이언트로부터 데이터를 받았을때 호출된다.
     * 그 외에는 close 이벤트가 호출된다.
     * @param handler
     * @param state
     * @param data
     */
    onHandlerEvent = (handler, state, data) => {
        if (!this.isRunning) {
            handler.destroy();
            return;
        }
        if (SocketState_1.default.Receive == state) {
            this.onReceiveAllHandler(handler, data);
        }
        else {
            let handlerType = handler.handlerType;
            if (handlerType == TunnelHandler_1.HandlerType.Unknown || handlerType == undefined) {
                return;
            }
            if (handlerType == TunnelHandler_1.HandlerType.Control) {
                this.destroyClientHandlerPool(handler.id);
            }
            else if (handlerType == TunnelHandler_1.HandlerType.Data) {
                this.endDataHandler(handler);
            }
        }
    };
    endDataHandler(dataHandler) {
        let ctrlID = dataHandler.ctrlID ?? 0;
        let clientHandlerPool = this.findCtrlHandlerPool(dataHandler.sessionID ?? -1);
        clientHandlerPool = clientHandlerPool ? clientHandlerPool : this._clientHandlerPoolMap.get(ctrlID);
        if (!clientHandlerPool) {
            logger.error(`onHandlerEvent - Not Found ClientHandlerPool. id: ${ctrlID}`);
            dataHandler.destroy();
            return;
        }
        clientHandlerPool.endDataHandler(dataHandler);
    }
    /**
     * 핸들러 풀에서 인자로 받은 ctrlID 에 대항하는 풀을 제거하고, 내부의 모든 세션 종료 메시지를 보낸 후에 연결을 종료한다.
     * @param ctrlID
     * @private
     */
    destroyClientHandlerPool(ctrlID) {
        let handlerPool = this._clientHandlerPoolMap.get(ctrlID);
        if (!handlerPool) {
            return;
        }
        let removeSessionIDs = [];
        this._sessionIDAndCtrlIDMap.forEach((value, key) => {
            if (value == ctrlID) {
                removeSessionIDs.push(key);
            }
        });
        for (let id of removeSessionIDs) {
            this._sessionIDAndCtrlIDMap.delete(id);
            this._onSessionCloseCallback?.(id, 0);
        }
        handlerPool.getAllSessionIDs().forEach((id) => this._onSessionCloseCallback?.(id, 0));
        this._clientHandlerPoolMap.delete(ctrlID);
        handlerPool.end();
    }
    getClientSysInfo(clientID) {
        let handlerPool = this._clientHandlerPoolMap.get(clientID);
        if (!handlerPool)
            return undefined;
        return handlerPool.sysInfo;
    }
}
exports.TunnelServer = TunnelServer;
