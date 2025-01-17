"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientHandlerPool = void 0;
const CtrlPacket_1 = require("../commons/CtrlPacket");
const Dequeue_1 = __importDefault(require("../util/Dequeue"));
const TunnelHandler_1 = require("../types/TunnelHandler");
const LoggerFactory_1 = __importDefault(require("../util/logger/LoggerFactory"));
const logger = LoggerFactory_1.default.getLogger('server', 'ClientHandlerPool');
class ClientHandlerPool {
    static LAST_DATA_HANDLER_ID = 10000;
    _createTime = Date.now();
    _remoteAddress = '';
    _id;
    _controlHandler;
    _name = '';
    // 열린 핸들러 맵. 세션ID를 키로 사용한다.
    _activatedSessionHandlerMap_ = new Map();
    _waitingDataBufferQueueMap = new Map();
    _bufferSize = 0;
    _pendingSessionIDMap = new Map();
    _onSessionCloseCallback;
    _onDataReceiveCallback;
    _sysInfo = {
        osInfo: { platform: '', release: '', type: '', hostname: '', },
        ram: -1,
        cpuInfo: { model: '', speed: -1, cores: -1 }, network: {}
    };
    static create(id, controlHandler) {
        return new ClientHandlerPool(id, controlHandler);
    }
    constructor(id, controlHandler) {
        this._id = id;
        this._remoteAddress = controlHandler.remoteAddress + ':' + controlHandler.remotePort;
        this._controlHandler = controlHandler;
    }
    endDataHandler(handler) {
        let sessionID = this.findSessionIDByDataHandler(handler);
        if (sessionID != undefined) {
            this.terminateSession(sessionID);
        }
    }
    get sysInfo() {
        return this._sysInfo;
    }
    set onSessionCloseCallback(callback) {
        this._onSessionCloseCallback = callback;
    }
    set onReceiveDataCallback(callback) {
        this._onDataReceiveCallback = callback;
    }
    get createTime() {
        return this._createTime;
    }
    get address() {
        return this._remoteAddress;
    }
    get activatedSessionCount() {
        return this._activatedSessionHandlerMap_.size;
    }
    get pendingSessionCount() {
        return this._pendingSessionIDMap.size;
    }
    /**
     * 데이터 핸들러가 세션을 닫으라는 명령을 받았을때 호출된다.
     * @param sessionID
     * @param endLength
     * @private
     */
    closeSessionAndCallback(sessionID, endLength) {
        this._onSessionCloseCallback?.(sessionID, endLength);
    }
    putNewDataHandler(dataHandler) {
        let pendingDataState = Array.from(this._pendingSessionIDMap.values()).find((value) => {
            return value.handlerID == dataHandler.handlerID;
        });
        if (!pendingDataState) {
            logger.error(`putNewDataHandler: invalid handlerID: ${dataHandler.handlerID}`);
            dataHandler.endImmediate();
            return;
        }
        dataHandler.dataHandlerState = TunnelHandler_1.DataHandlerState.Initializing;
        this._activatedSessionHandlerMap_.set(pendingDataState.sessionID, dataHandler);
        dataHandler.dataHandlerState = TunnelHandler_1.DataHandlerState.ConnectingEndPoint;
        dataHandler.sessionID = pendingDataState.sessionID;
        this.sendConnectEndPointPacket(dataHandler.handlerID, dataHandler.sessionID, pendingDataState.openOpt);
    }
    isSessionOpened(sessionID) {
        return this._activatedSessionHandlerMap_.has(sessionID);
    }
    /**
     * 세션이 열린직후 호출된다.
     * End point server 에 연결 직전까지 External port server 에서 받은 데이터를 버퍼에 저장했다가,
     * 세션이 열리면 일괄 전송한다.
     * @param sessionID
     * @private
     */
    flushWaitBuffer(sessionID) {
        let handler = this._activatedSessionHandlerMap_.get(sessionID);
        if (handler == undefined || handler.dataHandlerState != TunnelHandler_1.DataHandlerState.OnlineSession) {
            logger.error(`flushWaitBuffer: invalid sessionID: ${sessionID}`);
            if (handler) {
                handler.setBufferSizeLimit(-1);
                handler.dataHandlerState = TunnelHandler_1.DataHandlerState.Terminated;
                this.closeSessionAndCallback(sessionID, 0);
            }
            return;
        }
        let waitQueue = this._waitingDataBufferQueueMap.get(sessionID);
        if (waitQueue == undefined) {
            return;
        }
        let sendWaitPacketQueue = waitQueue.send;
        let receiveWaitPacketQueue = waitQueue.receive;
        let sendData = sendWaitPacketQueue.popFront();
        while (sendData != undefined) {
            handler.sendData(sendData);
            this._bufferSize -= sendData.length;
            sendData = sendWaitPacketQueue.popFront();
        }
        let receiveData = receiveWaitPacketQueue.popFront();
        while (receiveData != undefined) {
            this._onDataReceiveCallback?.(sessionID, receiveData);
            this._bufferSize -= receiveData.length;
            receiveData = receiveWaitPacketQueue.popFront();
        }
        this._waitingDataBufferQueueMap.delete(sessionID);
    }
    pushReceiveBuffer(sessionID, data) {
        let handler = this._activatedSessionHandlerMap_.get(sessionID);
        if (handler != undefined && handler.dataHandlerState == TunnelHandler_1.DataHandlerState.OnlineSession) {
            this._onDataReceiveCallback?.(sessionID, data);
            return true;
        }
        let queue = this._waitingDataBufferQueueMap.get(sessionID);
        if (queue == undefined) {
            logger.error(`pushReceiveBuffer: invalid sessionID: ${sessionID}`);
            return false;
        }
        this._bufferSize += data.length;
        queue.receive.pushBack(data);
        return true;
    }
    findSessionIDByDataHandler(handler) {
        if (handler.sessionID != undefined && handler.sessionID > -1) {
            return handler.sessionID;
        }
        for (let [key, value] of this._activatedSessionHandlerMap_) {
            if (value == handler) {
                return key;
            }
        }
        return undefined;
    }
    set name(name) {
        this._name = name;
    }
    get id() {
        return this._id;
    }
    get name() {
        return this._name;
    }
    getAllSessionIDs() {
        return [...Array.from(this._pendingSessionIDMap.keys()), ...Array.from(this._activatedSessionHandlerMap_.keys())];
    }
    sendConnectEndPoint(sessionID, opt) {
        if (this._waitingDataBufferQueueMap.has(sessionID)) {
            return;
        }
        this._waitingDataBufferQueueMap.set(sessionID, { send: new Dequeue_1.default(), receive: new Dequeue_1.default() });
        let pendingSessionState = { handlerID: 0, sessionID: sessionID, openOpt: opt, available: true };
        this._pendingSessionIDMap.set(sessionID, pendingSessionState);
        pendingSessionState.handlerID = ++ClientHandlerPool.LAST_DATA_HANDLER_ID;
        this.sendNewDataHandler(pendingSessionState.handlerID, sessionID);
    }
    /**
     * TunnelServer 에서 CtrlHandler 에 대한 데이터 이벤트를 받아서 처리한다.
     * @param handler
     * @param packet
     */
    delegateReceivePacketOfControlHandler(handler, packet) {
        logger.info(`Received a packet from the control handler. cmd: ${CtrlPacket_1.CtrlCmd[packet.cmd]} sessionID: ${packet.sessionID}`);
        if (packet.cmd == CtrlPacket_1.CtrlCmd.Message) {
            let message = CtrlPacket_1.CtrlPacket.getMessageFromPacket(packet);
            if (message.type == 'sysinfo') {
                this._sysInfo = message.payload;
            }
        }
        else if (packet.cmd == CtrlPacket_1.CtrlCmd.SuccessOfOpenSession || packet.cmd == CtrlPacket_1.CtrlCmd.FailOfOpenSession) {
            let handlerID = packet.ID;
            let sessionID = packet.sessionID;
            logger.info(`Attempt to connect data handler: sessionID${packet.sessionID}  ${packet.cmd == CtrlPacket_1.CtrlCmd.SuccessOfOpenSession ? '<Success>' : '<Fail>'}`);
            let connected = packet.cmd == CtrlPacket_1.CtrlCmd.SuccessOfOpenSession;
            if (!this.promoteDataHandler(handlerID, sessionID, connected)) {
                logger.warn(`Data handler initialization failed- sessionID:${sessionID}`);
                return;
            }
            if (!connected) {
                this.burnWaitBuffer(sessionID);
                this.closeSessionAndCallback(sessionID, 0);
            }
            else {
                this.sendSuccessOpenSessionAck(sessionID);
                this.flushWaitBuffer(sessionID);
            }
            this._pendingSessionIDMap.delete(sessionID);
        }
        else if (packet.cmd == CtrlPacket_1.CtrlCmd.CloseSession) {
            let handlerID = packet.ID;
            let sessionID = packet.sessionID;
            let endLength = packet.waitReceiveLength;
            this.releaseSession_(handlerID, sessionID, endLength);
        }
    }
    burnWaitBuffer(sessionID) {
        let queue = this._waitingDataBufferQueueMap.get(sessionID);
        if (queue) {
            this._waitingDataBufferQueueMap.delete(sessionID);
            let data = queue.receive.popFront();
            while (data != undefined) {
                this._bufferSize -= data.length;
                data = queue.receive.popFront();
            }
            data = queue.send.popFront();
            while (data != undefined) {
                this._bufferSize -= data.length;
                data = queue.send.popFront();
            }
        }
    }
    /**
     * 데이터 핸들러 상태를 'OnlineSession' 또는 'Wait' 으로 변경한다.
     * 만약 세션 연결에 성공하면 'OnlineSession' 으로 변경하고, 실패하면 'Wait' 으로 변경한다.
     * @param handlerID
     * @param sessionID
     * @param connected
     * @private
     */
    promoteDataHandler(handlerID, sessionID, connected) {
        let dataHandler = this._activatedSessionHandlerMap_.get(sessionID);
        let pendingState = this._pendingSessionIDMap.get(sessionID);
        if (!dataHandler || !pendingState || pendingState.handlerID != handlerID || !pendingState.available) {
            connected = false;
        }
        if (connected) {
            if (pendingState) {
                dataHandler.setBufferSizeLimit(pendingState.openOpt.bufferLimit);
            }
            dataHandler.dataHandlerState = TunnelHandler_1.DataHandlerState.OnlineSession;
            return true;
        }
        else {
            this._activatedSessionHandlerMap_.delete(sessionID);
            this._pendingSessionIDMap.delete(sessionID);
            this.burnWaitBuffer(sessionID);
            this.sendCloseSession(sessionID, 0);
            this.closeSessionAndCallback(sessionID, 0);
            if (dataHandler) {
                dataHandler.destroy();
            }
            return false;
        }
    }
    /**
     * 데이터를 전송한다. 만약 세션이 존재하지 않으면 false를 반환한다.
     * @param sessionID
     * @param data
     */
    sendBuffer(sessionID, data) {
        if (this._waitingDataBufferQueueMap.has(sessionID)) {
            this._waitingDataBufferQueueMap.get(sessionID).send.pushBack(data);
            this._bufferSize += data.length;
        }
        else {
            let handler = this._activatedSessionHandlerMap_.get(sessionID);
            if (handler == undefined) {
                this.sendCloseSession(sessionID, 0);
                this.closeSessionAndCallback(sessionID, 0);
                return false;
            }
            handler.sendData(data);
        }
        return true;
    }
    sendSuccessOpenSessionAck(sessionID) {
        let handler = this._activatedSessionHandlerMap_.get(sessionID);
        let handlerID = 0;
        if (handler == undefined) {
            let pendingState = this._pendingSessionIDMap.get(sessionID);
            if (pendingState) {
                handlerID = pendingState.handlerID;
            }
        }
        else {
            handlerID = handler.handlerID;
        }
        this._controlHandler.sendData(CtrlPacket_1.CtrlPacket.resultOfOpenSessionAck(handlerID, sessionID).toBuffer());
    }
    /**
     * ExternalPortServer 로부터 세션을 닫으라는 명령을 받았을때 호출된다. (ExternalPortServer 의 핸들러가 close 될 때)
     * @param sessionID
     * @param waitForLength
     */
    sendCloseSession(sessionID, waitForLength) {
        let handler = this._activatedSessionHandlerMap_.get(sessionID);
        if (handler == undefined) {
            let pendingState = this._pendingSessionIDMap.get(sessionID);
            if (pendingState) {
                pendingState.available = false;
            }
            else {
                return;
            }
        }
        logger.info(`Sends a session close request - sessionID: ${sessionID}`);
        // noinspection JSUnusedLocalSymbols
        this._controlHandler.sendData(CtrlPacket_1.CtrlPacket.closeSession(handler == undefined ? 0 : handler.handlerID ?? 0, sessionID, waitForLength).toBuffer(), (socketHandler, success, err) => {
            if (!success) {
                return;
            }
        });
    }
    // noinspection JSUnusedLocalSymbols
    /**
     * 컨트롤 핸들러로부터 세션을 닫으라는 명령을 받았을때 호출된다.
     * @param handlerID
     * @param sessionID
     * @param endLength
     */
    releaseSession_(handlerID, sessionID, endLength = 0) {
        let pendingState = this._pendingSessionIDMap.get(sessionID);
        if (pendingState) {
            pendingState.available = false;
        }
        let handler = this._activatedSessionHandlerMap_.get(sessionID);
        if (handler == undefined) {
            this.closeSessionAndCallback(sessionID, endLength);
            return;
        }
        this.closeSessionAndCallback(sessionID, endLength);
    }
    /**
     * 새로운 데이터 핸들러를 만들고, 컨트롤러 핸들러에게 세션을 열라는 명령을 보낸다.
     * @param dataHandlerID 새로운 데이터 핸들러의 ID
     * @param sessionId 세션 ID
     * @private
     */
    sendNewDataHandler(dataHandlerID, sessionId) {
        let packet = CtrlPacket_1.CtrlPacket.newDataHandler(dataHandlerID, sessionId).toBuffer();
        logger.info(`Requests to open a new data handler - sessionID:${sessionId}`);
        // noinspection JSUnusedLocalSymbols
        this._controlHandler.sendData(packet, (handler, success, err) => {
            if (!success) {
                this.sendCloseSession(sessionId, 0);
                logger.error(`Request to open data handler failed - sessionID:${sessionId}`);
                return;
            }
        });
    }
    terminateSession(sessionID) {
        let handler = this._activatedSessionHandlerMap_.get(sessionID);
        this._activatedSessionHandlerMap_.delete(sessionID);
        this._pendingSessionIDMap.delete(sessionID);
        this._waitingDataBufferQueueMap.delete(sessionID);
        if (handler) {
            handler.end_();
        }
    }
    /**
     * 사용 가능한 데이터 핸들러가 있는 상황에서, 컨트롤러 핸들러에게 세션을 열라는 명령을 보낸다.=
     * @param dataHandlerID 데이터 핸들러 ID
     * @param sessionId 세션 ID
     * @param opt 세션 옵션
     * @private
     */
    sendConnectEndPointPacket(dataHandlerID, sessionId, opt) {
        let packet = CtrlPacket_1.CtrlPacket.connectEndPoint(dataHandlerID, sessionId, opt).toBuffer();
        // noinspection JSUnusedLocalSymbols
        this._controlHandler.sendData(packet, (socketHandler, success, err) => {
            if (!success) {
                this.sendCloseSession(sessionId, 0);
                return;
            }
        });
    }
    end() {
        // noinspection JSUnusedLocalSymbols
        for (let [key, value] of this._activatedSessionHandlerMap_) {
            value.onSocketEvent = function () { };
            value.endImmediate();
        }
        this._activatedSessionHandlerMap_.clear();
        this._controlHandler.onSocketEvent = function () { };
        this._controlHandler.endImmediate();
        this._onSessionCloseCallback = undefined;
    }
}
exports.ClientHandlerPool = ClientHandlerPool;
