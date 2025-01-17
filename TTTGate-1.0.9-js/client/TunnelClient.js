"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TunnelClient = void 0;
const SocketHandler_1 = require("../util/SocketHandler");
const SocketState_1 = __importDefault(require("../util/SocketState"));
const CtrlPacket_1 = require("../commons/CtrlPacket");
const TunnelHandler_1 = require("../types/TunnelHandler");
const DataStatePacket_1 = __importDefault(require("../commons/DataStatePacket"));
const Dequeue_1 = __importDefault(require("../util/Dequeue"));
const LoggerFactory_1 = __importDefault(require("../util/logger/LoggerFactory"));
const SysMonitor_1 = require("../commons/SysMonitor");
const logger = LoggerFactory_1.default.getLogger('client', 'TunnelClient');
var CtrlState;
(function (CtrlState) {
    CtrlState[CtrlState["None"] = 0] = "None";
    CtrlState[CtrlState["Connecting"] = 1] = "Connecting";
    CtrlState[CtrlState["Connected"] = 2] = "Connected";
    CtrlState[CtrlState["Syncing"] = 3] = "Syncing"; /** 서버와 연결 완료 후 Sync 패킷을 보내는중 */
})(CtrlState || (CtrlState = {}));
var HandlerType;
(function (HandlerType) {
    HandlerType[HandlerType["Control"] = 0] = "Control";
    HandlerType[HandlerType["Data"] = 1] = "Data";
})(HandlerType || (HandlerType = {}));
/**
 * Client 는 Ctrl(컨트롤) 클라이언트와 Session.ts(세션) 클라이언트로 구성된다.
 * Ctrl 클라이언트는 서버와 연결을 맺으면 Sync 와 SyncSync 패킷을 받는다. 이후 Ack 패킷을 보내면 연결이 완료된다. 이후 Open 패킷을 받기만한다.
 * Open 패킷을 수신받으면 Session클라이언트를 생성하고, Session.ts 클라이언트는 서버와 연결을 맺는다. 이후 이벤트를 통하여 EndPoint 클라이언트와 연결된다.
 * EndPoint 클라이언트와 연결이 완료되면 Syncronize 패킷을 보낸다.
 *
 *
 */
class TunnelClient {
    _option;
    _state = CtrlState.None;
    _ctrlHandler = undefined;
    _activatedSessionDataHandlerMap = new Map();
    _waitBufferQueueMap = new Map();
    //private _ctrlPacketStreamer : CtrlPacketStreamer = new CtrlPacketStreamer();
    _id = -1;
    _onCtrlStateCallback;
    _onEndPointCloseCallback;
    _onConnectEndPointCallback;
    _onReceiveDataCallback;
    set onEndPointCloseCallback(value) {
        this._onEndPointCloseCallback = value;
    }
    set onConnectEndPointCallback(value) {
        this._onConnectEndPointCallback = value;
    }
    set onReceiveDataCallback(value) {
        this._onReceiveDataCallback = value;
    }
    set onCtrlStateCallback(callback) {
        this._onCtrlStateCallback = callback;
    }
    static create(option) {
        return new TunnelClient(option);
    }
    constructor(option) {
        this._option = option;
    }
    makeConnectOpt() {
        return { host: this._option.host, port: this._option.port, tls: this._option.tls };
    }
    connect() {
        if (this._state != CtrlState.None) {
            logger.error(`TunnelClient: connect: already connected`);
            return false;
        }
        this._state = CtrlState.Connecting;
        let connOpt = this.makeConnectOpt();
        connOpt.keepalive = 30000;
        this._ctrlHandler = SocketHandler_1.SocketHandler.connect(connOpt, this.onCtrlHandlerEvent);
        this._ctrlHandler.handlerType = HandlerType.Control;
        this._ctrlHandler.packetStreamer = new CtrlPacket_1.CtrlPacketStreamer();
        return true;
    }
    get state() {
        return this._state;
    }
    failHandshake(err) {
        this._state = CtrlState.None;
        this._ctrlHandler?.end_();
        this._onCtrlStateCallback?.(this, 'closed', err);
    }
    syncEndpointSession(sessionID) {
        if (this._state != CtrlState.Connected) {
            console.error(`TunnelClient: syncSession: invalid state: ${this._state}`);
            return false;
        }
        let dataHandler = this._activatedSessionDataHandlerMap.get(sessionID);
        if (!dataHandler) {
            return false;
        }
        this._waitBufferQueueMap.set(sessionID, new Dequeue_1.default());
        let packet = undefined;
        if (dataHandler.dataHandlerState == TunnelHandler_1.DataHandlerState.ConnectingEndPoint) {
            packet = CtrlPacket_1.CtrlPacket.resultOfOpenSession(dataHandler.handlerID, sessionID, true);
        }
        else {
            return false;
        }
        this._ctrlHandler.sendData(packet.toBuffer(), (handler, success) => {
            if (!success) {
                this.deleteDataHandler(dataHandler);
                return;
            }
            dataHandler.dataHandlerState = TunnelHandler_1.DataHandlerState.OnlineSession;
        });
        return true;
    }
    flushWaitBuffer(sessionID) {
        let queue = this._waitBufferQueueMap.get(sessionID);
        if (!queue) {
            return;
        }
        let dataHandler = this._activatedSessionDataHandlerMap.get(sessionID);
        if (!dataHandler) {
            this._waitBufferQueueMap.delete(sessionID);
            return;
        }
        let data = queue.popFront();
        while (data) {
            dataHandler.sendData(data);
            data = queue.popFront();
        }
    }
    terminateEndPointSession(sessionID) {
        let handler = this._activatedSessionDataHandlerMap.get(sessionID);
        this._activatedSessionDataHandlerMap.delete(sessionID);
        this._waitBufferQueueMap.delete(sessionID);
        if (handler) {
            handler.destroy();
        }
    }
    deleteDataHandler(handler) {
        this._waitBufferQueueMap.delete(handler.sessionID ?? -1);
        handler.dataHandlerState = TunnelHandler_1.DataHandlerState.Terminated;
        this._activatedSessionDataHandlerMap.delete(handler.sessionID ?? 0);
        if (handler.sessionID) {
            this._onEndPointCloseCallback?.(handler.sessionID, 0);
        }
        handler.destroy();
    }
    onCtrlHandlerEvent = (handler, state, data) => {
        if (state == SocketState_1.default.Connected) {
            this.sendSyncAndSyncSyncCmd(this._ctrlHandler);
        }
        else if (state == SocketState_1.default.Receive && handler == this._ctrlHandler) {
            this.onReceiveFromCtrlHandler(this._ctrlHandler, data);
        }
        else if (state == SocketState_1.default.Closed || state == SocketState_1.default.End) {
            if (data) {
                logger.error(`onCtrlHandlerEvent - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`, data);
            }
            this._state = CtrlState.None;
            this._ctrlHandler = undefined;
            this.destroyAllDataHandler();
            this._onCtrlStateCallback?.(this, 'closed');
        }
    };
    destroyAllDataHandler() {
        this._activatedSessionDataHandlerMap.forEach((handler, sessionID) => {
            handler.onSocketEvent = function () { };
            this.closeEndPointSession?.(sessionID, 0);
            handler.destroy();
        });
        this._activatedSessionDataHandlerMap.clear();
    }
    onReceiveFromCtrlHandler(handler, data) {
        let packetList = this._ctrlHandler.packetStreamer.readCtrlPacketList(data);
        for (let packet of packetList) {
            logger.info(`onReceiveFromCtrlHandler - cmd:${CtrlPacket_1.CtrlCmd[packet.cmd]}, sessionID:${packet.sessionID}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
            if (this._state == CtrlState.Syncing && packet.cmd == CtrlPacket_1.CtrlCmd.SyncCtrlAck) {
                this._id = packet.ID;
                this.sendAckCtrl(handler, this._id, this._option.key);
                continue;
            }
            if (this._state == CtrlState.Connected) {
                if (packet.cmd == CtrlPacket_1.CtrlCmd.NewDataHandler) {
                    this.connectDataHandler(packet.ID, packet.sessionID);
                }
                else if (packet.cmd == CtrlPacket_1.CtrlCmd.SuccessOfOpenSessionAck) {
                    this.flushWaitBuffer(packet.sessionID);
                }
                else if (packet.cmd == CtrlPacket_1.CtrlCmd.OpenSession) {
                    this.connectEndPoint(packet.ID, packet.sessionID, packet.openOpt);
                }
                else if (packet.cmd == CtrlPacket_1.CtrlCmd.Message) {
                    this.processReceiveMessage(packet);
                }
                else if (packet.cmd == CtrlPacket_1.CtrlCmd.CloseSession) {
                    let dataHandler = this._activatedSessionDataHandlerMap.get(packet.sessionID);
                    if (!dataHandler) {
                        logger.error(`onReceiveFromCtrlHandler - Fail close session. invalid sessionID: ${packet.sessionID}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
                        this._onEndPointCloseCallback?.(packet.sessionID, 0);
                    }
                    else {
                        dataHandler.addOnceDrainListener(() => {
                            dataHandler?.setBufferSizeLimit(-1);
                            dataHandler.dataHandlerState = TunnelHandler_1.DataHandlerState.Terminated;
                            this._onEndPointCloseCallback?.(packet.sessionID, packet.waitReceiveLength);
                        });
                    }
                }
                else {
                    //logger.warn(`onReceiveFromCtrlHandler - invalid cmd: ${CtrlCmd[packet.cmd]}, sessionID:${packet.sessionID}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
                }
            }
            else {
                // todo 잘못된 패킷이 수신되었을 경우 처리해야함.
                logger.error(`onReceiveFromCtrlHandler - invalid state: ${this._state}, sessionID:${packet.sessionID}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
            }
        }
    }
    processReceiveMessage(packet) {
        let message = CtrlPacket_1.CtrlPacket.getMessageFromPacket(packet);
        if (message.type == 'log') {
            logger.info(`Receive Server message:  ${message.payload}`);
        }
    }
    /**
     * 데이터 핸들러를 연결한다. 연결이 완료되면 데이터 핸들러에게 자신의 ID를 알리는 패킷을 보낸다.
     * 패킷 전송이 성공하면 데이터 핸들러는 자신의 상태를 DataHandlerState.ConnectingEndPoint 로 변경하고, EndPoint와 연결을 시도한다.
     * @param handlerID
     * @param sessionID
     * @private
     */
    connectDataHandler(handlerID, sessionID) {
        let dataHandler = SocketHandler_1.SocketHandler.connect(this.makeConnectOpt(), (handler, state, data) => {
            if (state == SocketState_1.default.Connected) {
                dataHandler.dataHandlerState = TunnelHandler_1.DataHandlerState.Initializing;
                dataHandler.handlerType = HandlerType.Data;
                this._activatedSessionDataHandlerMap.set(sessionID, dataHandler);
                let dataStatePacket = DataStatePacket_1.default.create(this._id, handlerID, sessionID);
                dataHandler.sessionID = sessionID;
                dataHandler.dataHandlerState = TunnelHandler_1.DataHandlerState.ConnectingEndPoint;
                dataHandler.sendData(dataStatePacket.toBuffer(), (handler, success /*, err*/) => {
                    if (!success) {
                        this.deleteDataHandler(dataHandler);
                        return;
                    }
                });
            }
            else if (state == SocketState_1.default.Receive) {
                this.onReceiveFromDataHandler(dataHandler, data);
            }
        });
        dataHandler.handlerID = handlerID;
        dataHandler.handlerType = HandlerType.Data;
        dataHandler.sessionID = sessionID;
        dataHandler.dataHandlerState = TunnelHandler_1.DataHandlerState.None;
    }
    // noinspection JSUnusedLocalSymbols
    /**
     * 데이터 핸들러가 EndPoint와 연결을 시도한다. 연결이 완료되면 세션을 생성하고, 세션을 서버에 알린다.
     * @param handlerID
     * @param sessionID
     * @param endPointConnectOpt
     * @private
     */
    connectEndPoint(handlerID, sessionID, endPointConnectOpt) {
        let dataHandler = this._activatedSessionDataHandlerMap.get(sessionID);
        if (!dataHandler) {
            return false;
        }
        dataHandler.sessionID = sessionID;
        dataHandler.dataHandlerState = TunnelHandler_1.DataHandlerState.ConnectingEndPoint;
        dataHandler.setBufferSizeLimit(endPointConnectOpt.bufferLimit);
        this._activatedSessionDataHandlerMap.set(sessionID, dataHandler);
        logger.info(`Connect end point: sessionID:${sessionID}, remote:(${dataHandler.socket.remoteAddress})${dataHandler.socket.remotePort}`);
        process.nextTick(() => {
            this._onConnectEndPointCallback?.(sessionID, endPointConnectOpt);
        });
        return true;
    }
    onReceiveFromDataHandler(handler, data) {
        if (handler.dataHandlerState == TunnelHandler_1.DataHandlerState.OnlineSession) {
            //process.nextTick(() => {
            this._onReceiveDataCallback?.(handler.sessionID, data);
            //});
        }
        else {
            // todo 잘못된 패킷이 수신되었을 경우 처리해야함.
            logger.error(`onReceiveFromDataHandler - invalid state: ${handler.dataHandlerState}, sessionID:${handler.sessionID}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
        }
    }
    sendSyncAndSyncSyncCmd(ctrlHandler) {
        //console.log("[server]",'TunnelServer: makeCtrlHandler - change state => ' + SessionState[SessionState.HalfOpened]);
        logger.info(`sendSyncAndSyncSyncCmd - id:${ctrlHandler.id}, remote:(${ctrlHandler.socket.remoteAddress})${ctrlHandler.socket.remotePort}`);
        let sendBuffer = CtrlPacket_1.CtrlPacket.createSyncCtrl().toBuffer();
        ctrlHandler.sendData(sendBuffer, (handler, success, err) => {
            if (!success) {
                logger.error(`sendSyncAndSyncSyncCmd Fail - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`, err);
                this._ctrlHandler?.end_();
                return;
            }
            logger.info(`sendSyncAndSyncSyncCmd Success - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
            this._state = CtrlState.Syncing;
        });
    }
    sendAckCtrl(ctrlHandler, id, key) {
        ctrlHandler.sendData(CtrlPacket_1.CtrlPacket.createAckCtrl(id, this._option.name, key).toBuffer(), (handler, success, err) => {
            if (!success) {
                this.failHandshake(err);
                return;
            }
            this._state = CtrlState.Connected;
            this._onCtrlStateCallback?.(this, 'connected');
            this.sendClientSysinfo(ctrlHandler, id);
        });
    }
    sendClientSysinfo(ctrlHandler, id) {
        SysMonitor_1.SysMonitor.instance.sysInfo().then((value) => {
            let ctrlPacket = CtrlPacket_1.CtrlPacket.message(id, {
                type: 'sysinfo',
                payload: value
            });
            ctrlHandler.sendData(ctrlPacket.toBuffer());
        });
    }
    /**
     * 외부(TTTClient)에서 세션을 종료한다.
     * @param sessionID
     * @param waitForReceiveDataLength
     */
    closeEndPointSession(sessionID, waitForReceiveDataLength) {
        let dataHandler = this._activatedSessionDataHandlerMap.get(sessionID);
        if (dataHandler && dataHandler.dataHandlerState == TunnelHandler_1.DataHandlerState.ConnectingEndPoint) {
            logger.warn(`End point connection failed - sessionID: ${sessionID}`);
            let packet = CtrlPacket_1.CtrlPacket.resultOfOpenSession(dataHandler.handlerID, sessionID, false);
            this._ctrlHandler.sendData(packet.toBuffer(), (handler, success /*, err*/) => {
                if (!success) {
                    this.deleteDataHandler(dataHandler);
                    return;
                }
                dataHandler.dataHandlerState = TunnelHandler_1.DataHandlerState.Terminated;
            });
        }
        else if (dataHandler) {
            let handlerID = dataHandler?.handlerID ?? 0;
            this.sendCloseSession(handlerID, sessionID, waitForReceiveDataLength, dataHandler);
        }
        return true;
    }
    sendCloseSession(handlerID, sessionID, waitReceiveLength, dataHandler) {
        console.log(`Endpoint client sends a close request - sessionID:${sessionID}`);
        try {
            this._ctrlHandler.sendData(CtrlPacket_1.CtrlPacket.closeSession(handlerID, sessionID, waitReceiveLength).toBuffer(), (handler, success /*, err*/) => {
                if (!success) {
                    if (dataHandler) {
                        this.deleteDataHandler(dataHandler);
                    }
                    return;
                }
            });
        }
        catch (e) {
            console.error(e);
        }
    }
    sendData(sessionID, data) {
        let dataHandler = this._activatedSessionDataHandlerMap.get(sessionID);
        if (!dataHandler) {
            return this.writeWaitBuffer(sessionID, data);
        }
        if (dataHandler.dataHandlerState != TunnelHandler_1.DataHandlerState.OnlineSession) {
            return this.writeWaitBuffer(sessionID, data);
        }
        dataHandler.sendData(data);
        return true;
    }
    writeWaitBuffer(sessionID, data) {
        let queue = this._waitBufferQueueMap.get(sessionID);
        if (queue) {
            queue.pushBack(data);
            return true;
        }
        return false;
    }
}
exports.TunnelClient = TunnelClient;
