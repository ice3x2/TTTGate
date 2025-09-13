import {SocketHandler} from "../util/SocketHandler";
import SocketState from "../util/SocketState";
import {Buffer} from "buffer";
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer, OpenOpt} from "../commons/CtrlPacket";
import {ClientOption} from "../types/TunnelingOption";
import ConnectOpt from "../util/ConnectOpt";
import {TunnelControlHandler,TunnelDataHandler,DataHandlerState} from "../types/TunnelHandler";
import DataStatePacket from "../commons/DataStatePacket";
import Dequeue from "../util/Dequeue";
import LoggerFactory  from "../util/logger/LoggerFactory";
import {SysMonitor} from "../commons/SysMonitor";
const logger = LoggerFactory.getLogger('client', 'TunnelClient');


enum CtrlState {
    None, /** 초기 상태 */
    Connecting, /** 서버와 연결중 */
    Connected,  /** 서버와 연결 완료 */
    Syncing /** 서버와 연결 완료 후 Sync 패킷을 보내는중 */
}


type ConnectionState = 'connected' | 'closed' ;
interface OnCtrlStateCallback {
    (client: TunnelClient, state: ConnectionState, error?: Error) : void;
}


interface OnSessionCloseCallback {
    (id: number,waitReceiveLength: number, error? : Error) : void;
}

interface OnReceiveDataCallback {
    (id: number, data: Buffer) : void;
}

interface OnSessionOpenCallback {
    (id: number, opt: OpenOpt) : void;
}


enum HandlerType {
    Control,
    Data
}

/**
 * Client 는 Ctrl(컨트롤) 클라이언트와 Session.ts(세션) 클라이언트로 구성된다.
 * Ctrl 클라이언트는 서버와 연결을 맺으면 Sync 와 SyncSync 패킷을 받는다. 이후 Ack 패킷을 보내면 연결이 완료된다. 이후 Open 패킷을 받기만한다.
 * Open 패킷을 수신받으면 Session클라이언트를 생성하고, Session.ts 클라이언트는 서버와 연결을 맺는다. 이후 이벤트를 통하여 EndPoint 클라이언트와 연결된다.
 * EndPoint 클라이언트와 연결이 완료되면 Syncronize 패킷을 보낸다.
 *
 *
 */
class TunnelClient {


    private readonly _option : ClientOption;
    private _state : CtrlState = CtrlState.None;
    private _ctrlHandler: TunnelControlHandler | undefined = undefined;
    private _activatedSessionDataHandlerMap : Map<number, TunnelDataHandler> = new Map<number, TunnelDataHandler>();
    private _waitBufferQueueMap : Map<number, Dequeue<Buffer>> = new Map<number, Dequeue<Buffer>>();


    //private _ctrlPacketStreamer : CtrlPacketStreamer = new CtrlPacketStreamer();

    private _id : number = -1;

    private _onCtrlStateCallback? : OnCtrlStateCallback;
    private _onEndPointCloseCallback? : OnSessionCloseCallback;
    private _onConnectEndPointCallback? : OnSessionOpenCallback;
    private _onReceiveDataCallback? : OnReceiveDataCallback;


    public set onEndPointCloseCallback(value: OnSessionCloseCallback) {
        this._onEndPointCloseCallback = value;
    }

    public set onConnectEndPointCallback(value: OnSessionOpenCallback) {
        this._onConnectEndPointCallback = value;
    }

    public set onReceiveDataCallback(value: OnReceiveDataCallback) {
        this._onReceiveDataCallback = value;
    }



    public set onCtrlStateCallback(callback: OnCtrlStateCallback) {
        this._onCtrlStateCallback = callback;
    }

    public static create(option: ClientOption) : TunnelClient {
        return new TunnelClient(option);
    }

    private constructor(option: ClientOption) {
        this._option = option;
    }

    private makeConnectOpt() : ConnectOpt {
        return {host: this._option.host,port: this._option.port ,tls: this._option.tls};
    }

    public connect() : boolean {
        if(this._state != CtrlState.None) {
            logger.error(`TunnelClient: connect: already connected`);
            return false;
        }
        
        try {
            let connOpt = this.makeConnectOpt();
            connOpt.keepalive = 30000;
            this._ctrlHandler = SocketHandler.connect(connOpt, this.onCtrlHandlerEvent) as TunnelControlHandler;
            
            // 연결 핸들러 생성 실패 체크
            if (!this._ctrlHandler) {
                logger.error(`TunnelClient: connect: failed to create control handler`);
                return false;
            }
            
            // 연결 시도가 성공적으로 시작된 후에만 state 변경
            this._state = CtrlState.Connecting;
            this._ctrlHandler.handlerType = HandlerType.Control;
            this._ctrlHandler.packetStreamer = new CtrlPacketStreamer();
            
            logger.info(`TunnelClient: connection attempt started to ${connOpt.host}:${connOpt.port}`);
            return true;
            
        } catch (error) {
            logger.error(`TunnelClient: connect: exception during connection attempt`, error);
            this._state = CtrlState.None;
            this._ctrlHandler = undefined;
            return false;
        }
    }





    public get state () : CtrlState {
        return this._state;
    }


    private failHandshake(err?: Error) : void {
        this._state = CtrlState.None
        this._ctrlHandler?.end_();
        this._onCtrlStateCallback?.(this, 'closed', err);
    }

    public syncEndpointSession(sessionID: number) : boolean {
        if(this._state != CtrlState.Connected) {
            console.error(`TunnelClient: syncSession: invalid state: ${this._state}`);
            return false;
        }

        let dataHandler = this._activatedSessionDataHandlerMap.get(sessionID);
        if(!dataHandler || !this._ctrlHandler) {
            return false;
        }
        this._waitBufferQueueMap.set(sessionID, new Dequeue<Buffer>());
        let packet : CtrlPacket | undefined = undefined;
        if(dataHandler.dataHandlerState == DataHandlerState.ConnectingEndPoint) {
            if (dataHandler.handlerID === undefined) {
                logger.error(`syncEndpointSession: handlerID is undefined for sessionID: ${sessionID}`);
                return false;
            }
            packet = CtrlPacket.resultOfOpenSession(dataHandler.handlerID, sessionID, true);
        } else {
            return false;
        }
        this._ctrlHandler.sendData(packet.toBuffer(), (handler, success) => {
            if(!success) {
                if (dataHandler) {
                    this.deleteDataHandler(dataHandler);
                }
                return;
            }
            if (dataHandler) {
                dataHandler.dataHandlerState = DataHandlerState.OnlineSession;
            }

        });
        return true;
    }

    private flushWaitBuffer(sessionID: number) : void {
        let queue = this._waitBufferQueueMap.get(sessionID);
        if(!queue) {
            return;
        }
        let dataHandler = this._activatedSessionDataHandlerMap.get(sessionID);
        if(!dataHandler) {
            this._waitBufferQueueMap.delete(sessionID);
            return;
        }
        let data = queue.popFront();
        while(data) {
            dataHandler.sendData(data);
            data = queue.popFront();
        }
    }

    public terminateEndPointSession(sessionID: number) : void {
        let handler = this._activatedSessionDataHandlerMap.get(sessionID);
        this._activatedSessionDataHandlerMap.delete(sessionID);
        this._waitBufferQueueMap.delete(sessionID);
        if(handler) {
            handler.destroy();
        }
    }

    private deleteDataHandler(handler: TunnelDataHandler) : void {
        this._waitBufferQueueMap.delete(handler.sessionID ?? -1);
        handler.dataHandlerState = DataHandlerState.Terminated;
        this._activatedSessionDataHandlerMap.delete(handler.sessionID ?? 0);
        if(handler.sessionID) {
            this._onEndPointCloseCallback?.(handler.sessionID, 0);
        }
        handler.destroy();
    }

    private onCtrlHandlerEvent = (handler: SocketHandler, state: SocketState, data?: any) : void => {
        if(state == SocketState.Connected && this._ctrlHandler) {
            this.sendSyncAndSyncSyncCmd(this._ctrlHandler);
        }
        else if(state == SocketState.Receive && handler == this._ctrlHandler) {
            this.onReceiveFromCtrlHandler(handler as TunnelControlHandler, data);
        } else if(state == SocketState.Closed || state == SocketState.End) {
            if(data) {
                logger.error(`onCtrlHandlerEvent - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`, data);
            }
            this._state = CtrlState.None;
            this._ctrlHandler = undefined;
            this.destroyAllDataHandler();
            this._onCtrlStateCallback?.(this, 'closed');
        }
    }

    private destroyAllDataHandler() : void {
        // Race condition 방지: 먼저 세션 ID들을 배열로 복사
        const sessionIDs = Array.from(this._activatedSessionDataHandlerMap.keys());
        
        // 복사된 배열을 순회하여 안전하게 세션 정리
        sessionIDs.forEach((sessionID: number) => {
            const handler = this._activatedSessionDataHandlerMap.get(sessionID);
            if (handler) {
                handler.onSocketEvent = function (){};
                // closeEndPointSession 대신 직접 정리하여 중복 삭제 방지
                this.deleteDataHandler(handler);
            }
        });
        
        // 최종 정리 (이미 대부분 삭제되었겠지만 확실히 하기 위해)
        this._activatedSessionDataHandlerMap.clear();
    }


    private onReceiveFromCtrlHandler(handler: TunnelControlHandler, data: Buffer) : void {
        if (!handler.packetStreamer) {
            logger.error(`onReceiveFromCtrlHandler - packetStreamer is undefined for handler: ${handler.id}`);
            return;
        }
        let packetList :  Array<CtrlPacket> = handler.packetStreamer.readCtrlPacketList(data);
        for(let packet of packetList) {
            logger.info(`onReceiveFromCtrlHandler - cmd:${CtrlCmd[packet.cmd]}, sessionID:${packet.sessionID}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
            if(this._state == CtrlState.Syncing && packet.cmd == CtrlCmd.SyncCtrlAck) {
                this._id = packet.ID;
                this.sendAckCtrl(handler, this._id, this._option.key);
                continue;
            }
            if(this._state == CtrlState.Connected) {
                if(packet.cmd == CtrlCmd.NewDataHandler) {
                    this.connectDataHandler(packet.ID, packet.sessionID);
                }
                else if(packet.cmd == CtrlCmd.SuccessOfOpenSessionAck) {
                    this.flushWaitBuffer(packet.sessionID);
                }
                else if(packet.cmd == CtrlCmd.OpenSession) {
                    if (!packet.openOpt) {
                        logger.error(`onReceiveFromCtrlHandler - OpenSession packet missing openOpt. sessionID: ${packet.sessionID}`);
                        return;
                    }
                    this.connectEndPoint(packet.ID, packet.sessionID, packet.openOpt);
                }
                else if(packet.cmd == CtrlCmd.Message) {
                    this.processReceiveMessage(packet);
                }
                else if(packet.cmd == CtrlCmd.CloseSession) {
                    let dataHandler = this._activatedSessionDataHandlerMap.get(packet.sessionID);
                    if(!dataHandler) {
                        logger.error(`onReceiveFromCtrlHandler - Fail close session. invalid sessionID: ${packet.sessionID}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
                        this._onEndPointCloseCallback?.(packet.sessionID, 0);
                    } else {
                        dataHandler.addOnceDrainListener(() => {
                            if (dataHandler) {
                                dataHandler.setBufferSizeLimit(-1);
                                dataHandler.dataHandlerState = DataHandlerState.Terminated;
                            }
                            this._onEndPointCloseCallback?.(packet.sessionID, packet.waitReceiveLength);
                        });
                    }
                } else {
                    //logger.warn(`onReceiveFromCtrlHandler - invalid cmd: ${CtrlCmd[packet.cmd]}, sessionID:${packet.sessionID}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
                }
            }
            else {
                // todo 잘못된 패킷이 수신되었을 경우 처리해야함.
                logger.error(`onReceiveFromCtrlHandler - invalid state: ${this._state}, sessionID:${packet.sessionID}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
            }
        }
    }

    private processReceiveMessage(packet: CtrlPacket) {
        let message = CtrlPacket.getMessageFromPacket(packet);
        if(message.type == 'log') {
            logger.info(`Receive Server message:  ${message.payload}`)
        }
    }



    /**
     * 데이터 핸들러를 연결한다. 연결이 완료되면 데이터 핸들러에게 자신의 ID를 알리는 패킷을 보낸다.
     * 패킷 전송이 성공하면 데이터 핸들러는 자신의 상태를 DataHandlerState.ConnectingEndPoint 로 변경하고, EndPoint와 연결을 시도한다.
     * @param handlerID
     * @param sessionID
     * @private
     */
    private connectDataHandler(handlerID: number,  sessionID: number) : void {
        let dataHandler : TunnelDataHandler = SocketHandler.connect(this.makeConnectOpt(), (handler, state, data) => {
            // Closure capture 문제 해결: 매개변수 handler를 안전하게 캐스팅하여 사용
            const tunnelDataHandler = handler as TunnelDataHandler;
            
            if(state == SocketState.Connected) {
                tunnelDataHandler.dataHandlerState = DataHandlerState.Initializing;
                tunnelDataHandler.handlerType = HandlerType.Data;
                this._activatedSessionDataHandlerMap.set(sessionID, tunnelDataHandler);
                let dataStatePacket = DataStatePacket.create(this._id, handlerID, sessionID);
                tunnelDataHandler.sessionID = sessionID;
                tunnelDataHandler.dataHandlerState = DataHandlerState.ConnectingEndPoint;
                tunnelDataHandler.sendData(dataStatePacket.toBuffer(), (handler, success /*, err*/) => {
                    if(!success) {
                        this.deleteDataHandler(tunnelDataHandler);
                        return;
                    }

                });
            } else if(state == SocketState.Receive) {
                this.onReceiveFromDataHandler(tunnelDataHandler, data);
            }
        });
        
        // 연결 생성 후 안전하게 속성 설정
        if (dataHandler) {
            dataHandler.handlerID = handlerID;
            dataHandler.handlerType = HandlerType.Data;
            dataHandler.sessionID = sessionID;
            dataHandler.dataHandlerState = DataHandlerState.None;
        } else {
            logger.error(`connectDataHandler: Failed to create data handler for sessionID: ${sessionID}`);
        }
    }

    // noinspection JSUnusedLocalSymbols
    /**
     * 데이터 핸들러가 EndPoint와 연결을 시도한다. 연결이 완료되면 세션을 생성하고, 세션을 서버에 알린다.
     * @param handlerID
     * @param sessionID
     * @param endPointConnectOpt
     * @private
     */
    private connectEndPoint(handlerID: number, sessionID: number,endPointConnectOpt: OpenOpt) : boolean {
        let dataHandler = this._activatedSessionDataHandlerMap.get(sessionID);
        if(!dataHandler) {
            return false;
        }
        dataHandler.sessionID = sessionID;
        dataHandler.dataHandlerState = DataHandlerState.ConnectingEndPoint;
        dataHandler.setBufferSizeLimit(endPointConnectOpt.bufferLimit);
        this._activatedSessionDataHandlerMap.set(sessionID, dataHandler);

        logger.info(`Connect end point: sessionID:${sessionID}, remote:(${dataHandler.socket.remoteAddress})${dataHandler.socket.remotePort}`)
        process.nextTick(() => {
            this._onConnectEndPointCallback?.(sessionID, endPointConnectOpt);
        });
        return true;
    }




    private onReceiveFromDataHandler(handler: TunnelDataHandler, data: Buffer) : void {
        if(handler.dataHandlerState == DataHandlerState.OnlineSession) {
            if (handler.sessionID === undefined) {
                logger.error(`onReceiveFromDataHandler - sessionID is undefined, state: ${handler.dataHandlerState}`);
                return;
            }
            //process.nextTick(() => {
                this._onReceiveDataCallback?.(handler.sessionID, data);
            //});
        } else {
            // todo 잘못된 패킷이 수신되었을 경우 처리해야함.
            logger.error(`onReceiveFromDataHandler - invalid state: ${handler.dataHandlerState}, sessionID:${handler.sessionID}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
        }
    }





    private sendSyncAndSyncSyncCmd(ctrlHandler: TunnelControlHandler) : void {
        //console.log("[server]",'TunnelServer: makeCtrlHandler - change state => ' + SessionState[SessionState.HalfOpened]);
        logger.info(`sendSyncAndSyncSyncCmd - id:${ctrlHandler.id}, remote:(${ctrlHandler.socket.remoteAddress})${ctrlHandler.socket.remotePort}`)
        let sendBuffer = CtrlPacket.createSyncCtrl().toBuffer();
        ctrlHandler.sendData(sendBuffer, (handler, success, err) => {
            if(!success) {
                logger.error(`sendSyncAndSyncSyncCmd Fail - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`, err);
                this._ctrlHandler?.end_();
                return;
            }
            logger.info(`sendSyncAndSyncSyncCmd Success - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`)
            this._state = CtrlState.Syncing;
        });
    }


    private sendAckCtrl(ctrlHandler: TunnelControlHandler, id: number, key : string) : void {
        ctrlHandler.sendData(CtrlPacket.createAckCtrl(id, this._option.name, key).toBuffer(), (handler, success, err) => {
            if (!success) {
                this.failHandshake(err);
                return;
            }
            this._state = CtrlState.Connected;
            this._onCtrlStateCallback?.(this, 'connected');
            this.sendClientSysinfo(ctrlHandler, id);
        });
    }

    private sendClientSysinfo(ctrlHandler: TunnelControlHandler, id: number) {
        SysMonitor.instance.sysInfo().then((value) => {
            let ctrlPacket = CtrlPacket.message(id, {
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
    public closeEndPointSession(sessionID: number,waitForReceiveDataLength: number) : boolean {
        let dataHandler = this._activatedSessionDataHandlerMap.get(sessionID);
        if(dataHandler && dataHandler.dataHandlerState == DataHandlerState.ConnectingEndPoint) {
            logger.warn(`End point connection failed - sessionID: ${sessionID}`);
            if (this._ctrlHandler) {
                if (dataHandler.handlerID === undefined) {
                    logger.error(`closeEndPointSession: handlerID is undefined for sessionID: ${sessionID}`);
                    this.deleteDataHandler(dataHandler);
                    return true;
                }
                let packet = CtrlPacket.resultOfOpenSession(dataHandler.handlerID, sessionID, false)
                this._ctrlHandler.sendData(packet.toBuffer(), (handler, success/*, err*/) => {
                    if(!success) {
                        if (dataHandler) {
                            this.deleteDataHandler(dataHandler);
                        }
                        return;
                    }
                    if (dataHandler) {
                        dataHandler.dataHandlerState = DataHandlerState.Terminated;
                    }
                });
            } else {
                // Control handler is already disconnected, just clean up locally
                this.deleteDataHandler(dataHandler);
            }
        } else if(dataHandler)  {
            let handlerID = dataHandler?.handlerID ?? 0;

            this.sendCloseSession(handlerID, sessionID,waitForReceiveDataLength, dataHandler);



        }
        return true;
    }


    private sendCloseSession(handlerID: number, sessionID: number, waitReceiveLength: number, dataHandler?: TunnelDataHandler) : void {
        console.log(`Endpoint client sends a close request - sessionID:${sessionID}`);
        try {
            if (this._ctrlHandler) {
                this._ctrlHandler.sendData(CtrlPacket.closeSession(handlerID, sessionID, waitReceiveLength).toBuffer(), (handler, success/*, err*/ ) => {
                    if (!success) {
                        if (dataHandler) {
                            this.deleteDataHandler(dataHandler!);
                        }
                        return;
                    }
                })
            } else {
                // Control handler is already disconnected, just clean up locally
                if (dataHandler) {
                    this.deleteDataHandler(dataHandler);
                }
            }
        } catch (e) {
            console.error(e);
        }
    }


    public sendData(sessionID: number, data: Buffer) : boolean {
        let dataHandler = this._activatedSessionDataHandlerMap.get(sessionID);
        if (!dataHandler) {
            return this.writeWaitBuffer(sessionID, data);
        }
        if(dataHandler.dataHandlerState != DataHandlerState.OnlineSession) {
            return this.writeWaitBuffer(sessionID, data);
        }
        dataHandler.sendData(data);
        return true;
    }

    private writeWaitBuffer(sessionID: number, data: Buffer) : boolean {
        let queue = this._waitBufferQueueMap.get(sessionID);
        if(queue) {
            queue.pushBack(data);
            return true;
        }
        return false;
    }



}

export {TunnelClient,  ConnectionState}