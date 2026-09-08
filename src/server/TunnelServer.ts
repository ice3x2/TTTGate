import {SocketHandler} from "../util/SocketHandler";
import {ServerOption, TCPServer} from "../util/TCPServer";
import SocketState from "../util/SocketState";
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer, OpenOpt} from "../commons/CtrlPacket";
import {Buffer} from "buffer";
import {
    buildHandshakeProof,
    CONTROL_PROTOCOL_V1,
    CONTROL_PROTOCOL_V2,
    ControlProtocolMode,
    createOpaqueToken,
    DEFAULT_PROTOCOL_V2_CAPABILITIES,
    SyncCtrlAckMeta
} from "../commons/ProtocolV2";
import {CertInfo} from "./CertificationStore";
import {ClientHandlerPool} from "./ClientHandlerPool";
import {clearInterval} from "timers";
import {
    CtrlState,
    DataHandlerState,
    HandlerType,
    TunnelControlHandler,
    TunnelDataHandler,
    TunnelHandler
} from "../types/TunnelHandler";
import DataStatePacket from "../commons/DataStatePacket";
import {IdentityRegistry} from "./IdentityRegistry";
import {TunnelHandshakePolicyRegistry} from "./TunnelHandshakePolicy";
import {timingSafeStringEqual} from "../util/timingSafeStringEqual";
import LoggerFactory  from "../util/logger/LoggerFactory";
import {SysInfo} from "../commons/SysMonitor";
const logger = LoggerFactory.getLogger('server', 'TunnelServer');

interface OnReceiveDataCallback {
    (id : number, data: Buffer) : void;
}

interface OnSessionCloseCallback {
    (id: number, endLength: number) : void;
}


interface ClientStatus {
    id: number;
    name: string,
    clientId: string,
    protocolVersion: number,
    controlProtocolMode: ControlProtocolMode,
    legacy: boolean,
    uptime: number;
    address: string;
    activeSessionCount: number;
}

type PendingControlHandshake = {
    challengeNonce: string;
    protocolVersion: number;
    capabilities: string[];
};


const HANDLER_TYPE_BUNDLE_KEY = 'T';
const DATA_HANDSHAKE_POOL_BUNDLE_KEY = 'data-handshake-pool';

// P6-T1 / REQ-09: 세션-TTL/heartbeat. 기본 60초 무응답 시 강제 종료.
// 테스트에서는 정적 setter로 짧게 조정할 수 있다(스테이트리스 싱글턴 회피 → per-instance 설정).
const DEFAULT_SESSION_TTL_MS = 60_000;
const DEFAULT_SESSION_HEARTBEAT_CHECK_INTERVAL_MS = 5_000;

// P6-T1 개선 1회차 / F4: configureSessionTtl 범위 방어. REQ-15와 대칭.
const MIN_SESSION_TTL_MS = 1_000;
const MAX_SESSION_TTL_MS = 3_600_000;
const MIN_SESSION_TTL_CHECK_INTERVAL_MS = 100;
const MAX_SESSION_TTL_CHECK_INTERVAL_MS = 60_000;

class TunnelServer {

    private readonly _serverOption : {port: number, tls: boolean, key: string, controlProtocolMode: ControlProtocolMode, allowLegacyControlAuth: boolean};
    private _clientHandlerPoolMap : Map<number, ClientHandlerPool> = new Map<number, ClientHandlerPool>();
    private _sessionIDAndCtrlIDMap : Map<number, number> = new Map<number, number>();
    private _pendingControlHandshakeMap: Map<number, PendingControlHandshake> = new Map<number, PendingControlHandshake>();

    private _tunnelServer : TCPServer;
    private readonly _key : string;
    private readonly _identityRegistry: IdentityRegistry;
    private isRunning = false;

    // P6-T1 / REQ-09: 세션별 마지막 활동 시각 기록. TTL 경과 시 강제 종료.
    private _sessionLastActivityMs : Map<number, number> = new Map<number, number>();
    private _sessionTtlMs : number = DEFAULT_SESSION_TTL_MS;
    private _sessionTtlCheckIntervalMs : number = DEFAULT_SESSION_HEARTBEAT_CHECK_INTERVAL_MS;
    private _sessionTtlTimer : NodeJS.Timeout | undefined;
    // P6-T1 개선 1회차 / F3: close() 진입 후 dispatch 된 TTL 콜백 race 가드.
    private _closed : boolean = false;
    private _authTimeouts : Set<NodeJS.Timeout> = new Set<NodeJS.Timeout>();
    private _unauthenticatedHandlerIds: Set<number> = new Set<number>();
    private _nextSelectIdx = 0;
    private _onSessionCloseCallback? : OnSessionCloseCallback;
    private _onReceiveDataCallback? : OnReceiveDataCallback;


    public set onSessionCloseCallback(value: OnSessionCloseCallback) {
        this._onSessionCloseCallback = value;
    }

    public set onReceiveDataCallback(value: OnReceiveDataCallback) {
        this._onReceiveDataCallback = value;
    }


    private constructor(option:{port: number, tls: boolean, key: string, keepAlive: number, controlProtocolMode: ControlProtocolMode, allowLegacyControlAuth: boolean, trustedClients?: Array<{clientId: string, clientSecret: string, displayName?: string}>}, certInfo: CertInfo) {
        this._serverOption = option;
        this._key = option.key;
        this._identityRegistry = new IdentityRegistry(option.trustedClients ?? []);
        let tcpServerOption : ServerOption = {
            port: option.port,
            tls: option.tls,
            key: certInfo.key.value,
            cert: certInfo.cert.value,
            ca: (certInfo.ca.value == '') ? undefined : certInfo.ca.value,
            keepAlive: option.keepAlive
        };
        this._tunnelServer = TCPServer.create(tcpServerOption);
    }





    public static create(option:{port: number, tls: boolean, key: string, keepAlive: number, controlProtocolMode: ControlProtocolMode, allowLegacyControlAuth: boolean, trustedClients?: Array<{clientId: string, clientSecret: string, displayName?: string}>}, certInfo: CertInfo) : TunnelServer {
        return new TunnelServer(option, certInfo);
    }


    public get port() : number {
        return this._serverOption.port;
    }

    public get tls() : boolean {
        return this._serverOption.tls === undefined ? false : this._serverOption.tls;
    }

    public async start() : Promise<void> {
        return new Promise((resolve, reject) => {
            this._tunnelServer.setOnServerEvent(this.onServerEvent);
            this._tunnelServer.setOnHandlerEvent(this.onHandlerEvent);
            this._tunnelServer.start((err) => {
                if(err) {
                    reject(err);
                } else {
                    this.isRunning = true;
                    this.startSessionTtlTimer();
                    resolve();
                }
            });
        });
    }

    // P6-T1 / REQ-09: 세션 TTL 설정 API. 테스트/운영에서 동적 조정 가능.
    // P6-T1 개선 1회차 / F4: 범위 밖 값은 예외로 차단(REQ-15 handshake policy 검증과 대칭).
    public configureSessionTtl(ttlMs: number, checkIntervalMs?: number) : void {
        if(!Number.isFinite(ttlMs) || ttlMs < MIN_SESSION_TTL_MS || ttlMs > MAX_SESSION_TTL_MS) {
            throw new RangeError(`configureSessionTtl: ttlMs must be within [${MIN_SESSION_TTL_MS}, ${MAX_SESSION_TTL_MS}] ms (got ${ttlMs})`);
        }
        if(checkIntervalMs !== undefined) {
            if(!Number.isFinite(checkIntervalMs) || checkIntervalMs < MIN_SESSION_TTL_CHECK_INTERVAL_MS || checkIntervalMs > MAX_SESSION_TTL_CHECK_INTERVAL_MS) {
                throw new RangeError(`configureSessionTtl: checkIntervalMs must be within [${MIN_SESSION_TTL_CHECK_INTERVAL_MS}, ${MAX_SESSION_TTL_CHECK_INTERVAL_MS}] ms (got ${checkIntervalMs})`);
            }
            if(checkIntervalMs >= ttlMs) {
                throw new RangeError(`configureSessionTtl: checkIntervalMs (${checkIntervalMs}) must be less than ttlMs (${ttlMs})`);
            }
            this._sessionTtlCheckIntervalMs = checkIntervalMs;
        }
        this._sessionTtlMs = ttlMs;
        if(this._sessionTtlTimer) {
            clearInterval(this._sessionTtlTimer);
            this._sessionTtlTimer = undefined;
            this.startSessionTtlTimer();
        }
    }

    private startSessionTtlTimer() : void {
        if(this._sessionTtlTimer) return;
        this._sessionTtlTimer = setInterval(() => {
            this.enforceSessionTtl();
        }, this._sessionTtlCheckIntervalMs);
        // node unref → test 프로세스 종료 방해 방지.
        if(this._sessionTtlTimer && typeof (this._sessionTtlTimer as any).unref === "function") {
            (this._sessionTtlTimer as any).unref();
        }
    }

    private stopSessionTtlTimer() : void {
        if(this._sessionTtlTimer) {
            clearInterval(this._sessionTtlTimer);
            this._sessionTtlTimer = undefined;
        }
    }

    private enforceSessionTtl() : void {
        // P6-T1 개선 1회차 / F3: close() 중 dispatched 된 잔여 콜백은 즉시 종료.
        if(this._closed || !this.isRunning) return;
        if(this._sessionLastActivityMs.size === 0) return;
        const now = Date.now();
        const expired: number[] = [];
        for(const [sessionId, lastActive] of this._sessionLastActivityMs.entries()) {
            if(now - lastActive > this._sessionTtlMs) {
                expired.push(sessionId);
            }
        }
        for(const sessionId of expired) {
            logger.warn(`Session TTL exceeded, forcing close. sessionID=${sessionId}`);
            // P6-T1 개선 1회차 / F2: single-path close.
            // closeSession()가 activity 제거 + client 통보를 모두 수행하므로 여기선 activity 제거만 선행.
            // External pool close 는 closeSession() 경로 내 sendCloseSession 응답 파이프에서 이미 정리되며,
            // 즉시성이 필요하므로 onSessionCloseCallback 을 여기서 1회만 호출(이중 호출 방지).
            this._sessionLastActivityMs.delete(sessionId);
            try { this._onSessionCloseCallback?.(sessionId, 0); } catch(e) { logger.error("TTL close callback error", e); }
            try {
                // 풀 레벨 close (클라이언트 쪽 통보). closeSession 내부에서 activity delete 는 no-op.
                const pool = this.findClientHandlerPool(sessionId);
                if(pool) {
                    pool.sendCloseSession(sessionId, 0);
                }
                // 매핑 제거(단일 경로).
                this._sessionIDAndCtrlIDMap.delete(sessionId);
            } catch(e) {
                logger.error("TTL close error", e);
            }
        }
    }

    private markSessionActivity(sessionId: number) : void {
        this._sessionLastActivityMs.set(sessionId, Date.now());
    }

    public debugSessionCount() : number {
        return this._sessionIDAndCtrlIDMap.size;
    }


    public clientStatuses() : Array<ClientStatus> {
        let result : Array<ClientStatus> = [];
        this._clientHandlerPoolMap.forEach((handlerPool, ctrlID) => {
            result.push(
                {
                    id: ctrlID,
                    name: handlerPool.name,
                    clientId: handlerPool.clientId,
                    protocolVersion: handlerPool.protocolVersion,
                    controlProtocolMode: this._serverOption.controlProtocolMode,
                    legacy: handlerPool.legacyMode,
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
    public async close() : Promise<void> {
        logger.info(`close`);
        this.isRunning = false;
        // P6-T1 개선 1회차 / F3: 후속 TTL 콜백 race 방지 플래그.
        this._closed = true;
        this.stopSessionTtlTimer();
        this._sessionLastActivityMs.clear();
        return new Promise((resolve) => {
            // 모든 auth timeout 정리
            this._authTimeouts.forEach((timeoutId) => {
                clearTimeout(timeoutId);
            });
            this._authTimeouts.clear();
            this._clientHandlerPoolMap.forEach((handlerPool) => {
                handlerPool.getAllSessionIDs().forEach((id) => { this._onSessionCloseCallback?.(id, 0) });
                handlerPool.end();
            });
            this._unauthenticatedHandlerIds.clear();
            this._pendingControlHandshakeMap.clear();
            this._identityRegistry.clear();
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
    public sendBuffer(sessionId: number, buffer: Buffer) : boolean {
        if(!this.available()) {
            return false;
        }
        let ctrlID = this._sessionIDAndCtrlIDMap.get(sessionId);
        if(ctrlID == undefined) {
            return false;
        }
        let handlerPool = this._clientHandlerPoolMap.get(ctrlID);
        if(!handlerPool) {
            return false;
        }
        // P6-T1 / REQ-09: 활동 기록 업데이트(TTL 리셋).
        this.markSessionActivity(sessionId);
        return handlerPool.sendBuffer(sessionId, buffer);
    }


    /**
     * 세션을 연다.
     * @param sessionID 새로운 세션ID
     * @param opt 연결할 End Point 서버에 대한 정보.
     * @param allowClientNames 허용할 클라이언트 이름 목록. 목록에 포함된 클라이언트만 세션을 연다. 목록이 없으면 모든 클라이언트를 허용한다.
     */
    public openSession(sessionID: number, opt : OpenOpt, allowClientNames?: Array<string>, allowClientIds?: Array<string>) : boolean {
        if(!this.available()) {
            return false;
        }
        let handlerPool = this.getNextHandlerPool(allowClientNames, allowClientIds);
        if(handlerPool == null) {
            return false;
        }
        this._sessionIDAndCtrlIDMap.set(sessionID, handlerPool.id);
        // P6-T1 / REQ-09: 세션 오픈 즉시 활동 타임스탬프 기록.
        this.markSessionActivity(sessionID);
        handlerPool.sendConnectEndPoint(sessionID, opt);
        return true;
    }

    private available() : boolean {
        return this._clientHandlerPoolMap.size > 0;
    }




    private getNextHandlerPool(allowClientNames?: Array<string>, allowClientIds?: Array<string>) : ClientHandlerPool | null {
        if(this._clientHandlerPoolMap.size == 0) {
            return null;
        }
        let ids: Array<number> = [];
        if(allowClientIds && allowClientIds.length > 0) {
            this._clientHandlerPoolMap.forEach((handlerPool, ctrlID) => {
                if(!handlerPool.legacyMode && allowClientIds.includes(handlerPool.clientId)) {
                    ids.push(ctrlID);
                }
            });
        } else if(!allowClientNames || allowClientNames.length == 0) {
           ids =  Array.from(this._clientHandlerPoolMap.keys());
        }  else {
            this._clientHandlerPoolMap.forEach((handlerPool, ctrlID) => {
                if(allowClientNames.includes(handlerPool.name)) {
                    ids.push(ctrlID);
                }
            });
        }
        if(ids.length == 0) {
            return null;
        }
        if(ids.length == 1) {
            const pool = this._clientHandlerPoolMap.get(ids[0]);
            if (!pool) {
                logger.error(`getNextHandlerPool: pool not found for id: ${ids[0]}`);
                return null;
            }
            return pool;
        }
        let nextId = ids[++this._nextSelectIdx % ids.length];
        const pool = this._clientHandlerPoolMap.get(nextId);
        if (!pool) {
            logger.error(`getNextHandlerPool: pool not found for id: ${nextId}`);
            return null;
        }
        return pool;
    }




    private onServerEvent = (server: TCPServer, state: SocketState, handler? : SocketHandler) : void => {
        if(SocketState.Listen == state) {
            logger.info(`Listen: ${this._serverOption.port}`);
        } if(state == SocketState.Bound && handler) {
            if(!this.isRunning) {
                handler.end_();
                return;
            }
            logger.info(`Bound - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
            this.onClientHandlerBound(handler);
        }
    }


    private onClientHandlerBound = (handler: TunnelHandler) : void => {
        const handshakePolicy = TunnelHandshakePolicyRegistry.current();
        if(this._unauthenticatedHandlerIds.size >= handshakePolicy.maxUnauthenticatedConnections) {
            logger.warn(`Rejecting unauthenticated connection because the cap is reached. handler=${handler.id}`);
            handler.destroy();
            return;
        }
        this._unauthenticatedHandlerIds.add(handler.id);
        handler.setTimeout(handshakePolicy.timeoutMs);
        handler.handlerType = HandlerType.Unknown;
        (handler as TunnelControlHandler).controlProtocolMode = this._serverOption.controlProtocolMode;
        handler.setBundle(HANDLER_TYPE_BUNDLE_KEY, HandlerType.Unknown);
        logger.info(`Bound - id:${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
    }


    private sendSyncCtrlAck(ctrlHandler: TunnelControlHandler) : void {
        if (!ctrlHandler) {
            logger.error('sendSyncCtrlAck: ctrlHandler is null');
            return;
        }
        const handshakeMeta: SyncCtrlAckMeta = {
            protocolVersion: CONTROL_PROTOCOL_V2,
            capabilities: DEFAULT_PROTOCOL_V2_CAPABILITIES,
            challengeNonce: this.ensurePendingControlHandshake(ctrlHandler.id).challengeNonce,
            serverMode: this._serverOption.controlProtocolMode,
            controlID: ctrlHandler.id
        };
        let sendBuffer = CtrlPacket.createSyncCtrlAck(ctrlHandler.id, handshakeMeta).toBuffer();
        ctrlHandler.sendData(sendBuffer, (handler_, success, err) => {
            if(!success) {
                logger.error(`sendSyncAndSyncSyncCmd Fail - id:${ctrlHandler.id}, remote:(${ctrlHandler.socket.remoteAddress})${ctrlHandler.socket.remotePort}, ${err}`);
                ctrlHandler.destroy();
                return;
            }
            logger.info(`sendSyncAndSyncSyncCmd Success - id:${ctrlHandler.id}, remote:(${ctrlHandler.socket.remoteAddress})${ctrlHandler.socket.remotePort}`)
            ctrlHandler.ctrlState = CtrlState.Syncing;

        });
    }

    private promoteToCtrlHandler(handler: TunnelControlHandler, identity: {clientId: string, displayName: string, protocolVersion: number, capabilities: Array<string>, legacy: boolean}) : void {
        handler.ctrlState = CtrlState.Connected;
        handler.clientId = identity.clientId;
        handler.displayName = identity.displayName;
        handler.protocolVersion = identity.protocolVersion;
        handler.capabilities = [...identity.capabilities];
        let ctrlHandlerPool = ClientHandlerPool.create(handler.id, handler);
        ctrlHandlerPool.onSessionCloseCallback = (sessionID: number, endLength:  number) => {
            this._onSessionCloseCallback?.(sessionID, endLength);
        }
        ctrlHandlerPool.onReceiveDataCallback = (sessionID: number, data: Buffer) => {
            this._onReceiveDataCallback?.(sessionID, data);
        }
        ctrlHandlerPool.setAuthenticatedIdentity(identity);
        this._clientHandlerPoolMap.set(handler.id, ctrlHandlerPool);
        this._pendingControlHandshakeMap.delete(handler.id);
    }


    private onReceiveAllHandler(handler: TunnelHandler, data: Buffer) : void {

        if(handler.handlerType == HandlerType.Unknown && data.length > 0) {
            let delimiter = data.toString('utf-8',0,1);
            if(delimiter == CtrlPacket.PACKET_DELIMITER) {
                let ctrlHandler = handler as TunnelControlHandler;
                ctrlHandler.handlerType = HandlerType.Control;
                ctrlHandler.packetStreamer = new CtrlPacketStreamer();
            } else if(delimiter == DataStatePacket.PACKET_DELIMITER) {
                let dataHandler = handler as TunnelDataHandler;
                dataHandler.handlerType = HandlerType.Data;
                dataHandler.dataHandlerState = DataHandlerState.None;
            } else {
                let str = data.toString('utf-8', 0, Math.min(data.length, 64)).trim().replaceAll('\n', '\\n').replaceAll('\r', '\\r');
                logger.error(`onHandlerEvent - Unknown packet. id: ${handler.id}, addr: ${handler.remoteAddress}:${handler.remotePort}, data: ${str}...`);
                handler.end_();
                return;
            }
        }
        if(handler.handlerType == HandlerType.Control) {
            this.onReceiveCtrlHandler(handler as TunnelControlHandler, data);
        } else if(handler.handlerType == HandlerType.Data) {
            this.onReceiveDataHandler(handler as TunnelDataHandler, data);
        } else {
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
    private onReceiveDataHandler(handler: TunnelDataHandler, data: Buffer) : void  {
        if(handler.dataHandlerState == DataHandlerState.None) {
            if(handler.leftOverBuffer) {
                data = Buffer.concat([handler.leftOverBuffer, data]);
                handler.leftOverBuffer = undefined;
            }
            try {
                const fixed = DataStatePacket.readFixedHeader(data);
                if(fixed.kind === 'incomplete') {
                    handler.leftOverBuffer = data;
                    return;
                }
                if(fixed.kind === 'invalid') {
                    logger.error(fixed.reason);
                    handler.deleteBundle(DATA_HANDSHAKE_POOL_BUNDLE_KEY);
                    handler.endImmediate();
                    return;
                }
                const clientHandlerPool = this._clientHandlerPoolMap.get(fixed.ctrlID);
                const expectedPool = handler.getBundle(DATA_HANDSHAKE_POOL_BUNDLE_KEY) as ClientHandlerPool | undefined;
                if(!clientHandlerPool || (expectedPool && expectedPool !== clientHandlerPool)) {
                    logger.error(`Data handshake control pool is missing or changed: ${fixed.ctrlID}`);
                    handler.deleteBundle(DATA_HANDSHAKE_POOL_BUNDLE_KEY);
                    handler.endImmediate();
                    return;
                }
                handler.setBundle(DATA_HANDSHAKE_POOL_BUNDLE_KEY, clientHandlerPool);
                const result = DataStatePacket.fromBuffer(data, clientHandlerPool.legacyMode ? 'legacy' : 'token');
                if(result.error) {
                    logger.error(result.error);
                    handler.deleteBundle(DATA_HANDSHAKE_POOL_BUNDLE_KEY);
                    handler.endImmediate();
                    return;
                }
                if (result.packet) {
                    handler.deleteBundle(DATA_HANDSHAKE_POOL_BUNDLE_KEY);
                    handler.dataHandlerState = DataHandlerState.Initializing;
                    handler.leftOverBuffer = result.remainBuffer;
                    handler.ctrlID = result.packet.ctrlID;
                    handler.handlerID = result.packet.handlerID;
                    handler.sessionID = result.packet.firstSessionID;
                    handler.bindingToken = result.packet.bindingToken;
                    clientHandlerPool.putNewDataHandler(handler);
                    if(!handler.isEnd()) this.markHandlerAuthenticated(handler);

                } else {
                    handler.leftOverBuffer = result.remainBuffer;
                }
            } catch (e) {
                // todo : 에러 출력기 구현
                logger.error(`onHandlerEvent - DataStatePacket.fromBuffer Fail. sessionID: ${handler.sessionID}`,e);
                handler.endImmediate();
                return;
            }
        }
        else {
             if (!handler.sessionID) {
                 logger.error('onReceiveDataHandler: sessionID is undefined');
                 handler.endImmediate();
                 return;
             }
             
             let ctrlPool = this.findClientHandlerPool(handler.sessionID);
             if(!ctrlPool) {
                 this._onSessionCloseCallback?.(handler.sessionID, 0);
                return;
             }
             // P6-T1 / REQ-09: 데이터 수신도 활동으로 간주 → TTL 리셋.
             this.markSessionActivity(handler.sessionID);
             if(!ctrlPool.pushReceiveBuffer(handler.sessionID, data)) {
                 this._onSessionCloseCallback?.(handler.sessionID, 0);
             }
             return;
        }
    }

    private findClientHandlerPool(sessionId: number) : ClientHandlerPool | undefined {
        let ctrlID = this._sessionIDAndCtrlIDMap.get(sessionId);
        if(ctrlID == undefined) {
            return undefined;
        }
        let clientHandlerPool = this._clientHandlerPoolMap.get(ctrlID);
        if(!clientHandlerPool) {
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
    private onReceiveCtrlHandler(handler: TunnelControlHandler, data: Buffer) : void  {
        let packetList : Array<CtrlPacket> = [];
        try {
            if (!handler.packetStreamer) {
                logger.error(`onReceiveCtrlHandler - packetStreamer is undefined. ctrlID: ${handler.id}`);
                handler.destroy();
                return;
            }
            packetList = handler.packetStreamer.readCtrlPacketList(data);
        } catch (e) {
            logger.error(`onHandlerEvent - CtrlPacketStreamer.readCtrlPacketList Fail. ctrlID: ${handler.id}`,e);
            if(handler.handlerType == HandlerType.Control) {
                logger.error(`onHandlerEvent - CtrlPacketStreamer.readCtrlPacketList Fail. ctrlID: ${handler.id}, ${e}`);
                this.destroyClientHandlerPool(handler.id);
                return;
            } else {
                handler.destroy();
            }
            return;
        }
        for(let i = 0, len = packetList.length; i < len; i++) {
            let packet = packetList[i];
            this.onReceiveCtrlPacket(handler, packet);
        }
    }






    public terminateSession(sessionId: number) : void {
        let pool = this.findCtrlHandlerPool(sessionId);
        this._sessionIDAndCtrlIDMap.delete(sessionId);
        // P6-T1 / REQ-09: 세션 종료 시 활동 기록 제거.
        this._sessionLastActivityMs.delete(sessionId);
        if(pool == undefined) {
            return;
        }
        pool.terminateSession(sessionId);


    }

    private findCtrlHandlerPool(sessionId: number) : ClientHandlerPool | undefined {
        let ctrlID = this._sessionIDAndCtrlIDMap.get(sessionId);
        if(ctrlID == undefined) {
            return undefined;
        }
        let clientHandlerPool = this._clientHandlerPoolMap.get(ctrlID);
        if(!clientHandlerPool) {
            return undefined;
        }
        return clientHandlerPool;
    }



    public closeSession(sessionId: number, waitForLength: number) : void {
        let pool = this.findClientHandlerPool(sessionId);
        // P6-T1 / REQ-09: 활동 기록 제거(중복 TTL 트리거 방지).
        this._sessionLastActivityMs.delete(sessionId);
        if(pool == undefined) {
            return;
        }
        pool.sendCloseSession(sessionId,waitForLength);
    }



    private onReceiveCtrlPacket(handler: TunnelHandler, packet: CtrlPacket) : void  {
        logger.info('receive ctrl packet - cmd:' + CtrlCmd[packet.cmd] + ', handler id: ' + handler.id + ', remote: ' + handler.remoteAddress + ':' + handler.remotePort);
        if(packet.cmd == CtrlCmd.SyncCtrl) {
            let ctrlHandler = handler as TunnelControlHandler;
            ctrlHandler.handlerType = HandlerType.Control;
            this.sendSyncCtrlAck(ctrlHandler);
        } else if(packet.cmd == CtrlCmd.AckCtrl) {
            const ctrlHandler = handler as TunnelControlHandler;
            if(ctrlHandler.ctrlState !== CtrlState.Syncing) {
                this.rejectHandshake(ctrlHandler, "Invalid control handshake state or packet ID");
                return;
            }
            const ackV2Meta = packet.ackCtrlV2Meta;
            if(ackV2Meta) {
                if(this._serverOption.controlProtocolMode === "legacy") {
                    this.rejectHandshake(ctrlHandler, "Protocol v2 is disabled in legacy mode");
                    return;
                }
                if(this._serverOption.controlProtocolMode === "mtls-strict" && !ctrlHandler.isSecure()) {
                    this.rejectHandshake(ctrlHandler, "Strict mode requires verified TLS");
                    return;
                }
                if(!packet.clientName || !ackV2Meta.clientId || !ackV2Meta.proof) {
                    this.rejectHandshake(ctrlHandler, "AckCtrl v2 packet is missing mandatory identity fields");
                    return;
                }
                if((ackV2Meta.controlID ?? packet.ID) !== ctrlHandler.id) {
                    this.rejectHandshake(ctrlHandler, "AckCtrl v2 control ID mismatch");
                    return;
                }
                const trustedClient = this._identityRegistry.findTrustedClient(ackV2Meta.clientId);
                const pendingHandshake = this._pendingControlHandshakeMap.get(ctrlHandler.id);
                if(!trustedClient || !pendingHandshake) {
                    this.rejectHandshake(ctrlHandler, "Unknown client identity or missing handshake challenge");
                    return;
                }
                const expectedProof = buildHandshakeProof(trustedClient.clientSecret, ackV2Meta.clientId, ctrlHandler.id, pendingHandshake.challengeNonce);
                // P3-T4 / REQ-04: proof 비교는 상수시간. hex 인코딩 고정.
                if(!timingSafeStringEqual(expectedProof, ackV2Meta.proof, "hex")) {
                    this.rejectHandshake(ctrlHandler, "Proof-of-possession validation failed");
                    return;
                }
                this.markHandlerAuthenticated(ctrlHandler);
                this.promoteToCtrlHandler(ctrlHandler, {
                    clientId: ackV2Meta.clientId,
                    displayName: ackV2Meta.displayName || packet.clientName || trustedClient.displayName || ackV2Meta.clientId,
                    protocolVersion: ackV2Meta.protocolVersion || CONTROL_PROTOCOL_V2,
                    capabilities: ackV2Meta.capabilities ?? pendingHandshake.capabilities,
                    legacy: false
                });
                return;
            }
            if(packet.ID !== ctrlHandler.id) {
                this.rejectHandshake(ctrlHandler, "Invalid control handshake state or packet ID");
                return;
            }
            if(!this._serverOption.allowLegacyControlAuth) {
                this.rejectHandshake(ctrlHandler, "Legacy control authentication requires explicit opt-in");
                return;
            }
            if(this._serverOption.controlProtocolMode === "mtls-strict") {
                this.rejectHandshake(ctrlHandler, "Legacy control handshake is not allowed in strict mode");
                return;
            }
            // P3-T4 / REQ-04: legacy auth-key 비교도 상수시간 헬퍼로 교체.
            // 입력은 임의 utf8이며 길이가 고정되지 않으므로 'utf8' 인코딩 사용.
            if(!timingSafeStringEqual(packet.ackKey ?? "", this._key ?? "", "utf8")) {
                this.notMatchedAuthKey(ctrlHandler);
                return;
            }
            if (!packet.clientName) {
                logger.error('AckCtrl packet missing clientName');
                this.notMatchedAuthKey(ctrlHandler);
                return;
            }
            this.markHandlerAuthenticated(ctrlHandler);
            this.promoteToCtrlHandler(ctrlHandler, {
                clientId: `legacy:${packet.clientName}`,
                displayName: packet.clientName,
                protocolVersion: CONTROL_PROTOCOL_V1,
                capabilities: [],
                legacy: true
            });
        } else {
            let ctrlID = handler.id;
            let clientHandlerPool = this._clientHandlerPoolMap.get(ctrlID);
            if(!clientHandlerPool) {
                logger.error(`onHandlerEvent - Not Found ClientHandlerPool. id: ${ctrlID}`);
                handler.end_();
                return;
            }
            clientHandlerPool.delegateReceivePacketOfControlHandler(handler as TunnelControlHandler, packet);
        }
    }

    private notMatchedAuthKey(handler: TunnelControlHandler) : void {
        logger.error(`Authkey is not matched. id: ${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
        let packet = CtrlPacket.message(handler.id,{type: 'log', payload: '<Fatal> Authkey is not matched.'});
        handler.sendData(packet.toBuffer());
        this._clientHandlerPoolMap.delete(handler.id);
        this._pendingControlHandshakeMap.delete(handler.id);
        const timeoutId = setTimeout(() => {
            handler.destroy();
            this._authTimeouts.delete(timeoutId);
        },1000);
        this._authTimeouts.add(timeoutId);
    }

    /**
     * 클라이언트 핸들러로부터 이벤트를 받았을때 호출된다.
     * Receive 이벤트는 클라이언트로부터 데이터를 받았을때 호출된다.
     * 그 외에는 close 이벤트가 호출된다.
     * @param handler
     * @param state
     * @param data
     */
    private onHandlerEvent = (handler: SocketHandler, state: SocketState, data?: any) : void => {
        if(!this.isRunning) {
            handler.destroy();
            return;
        }
        if(SocketState.Receive == state) {
            this.onReceiveAllHandler(handler, data);
        } else {
            this.clearUnauthenticatedHandler(handler.id);
            let handlerType = (handler as TunnelHandler).handlerType;
            if(handlerType == HandlerType.Unknown || handlerType == undefined) {
                return;
            }
            if(handlerType == HandlerType.Control) {
                this.destroyClientHandlerPool(handler.id);
            } else if(handlerType == HandlerType.Data) {
                this.endDataHandler(handler as TunnelDataHandler);
            }
        }
    }

    private endDataHandler(dataHandler : TunnelDataHandler) : void {
        let ctrlID = dataHandler.ctrlID ?? 0;
        let clientHandlerPool = this.findCtrlHandlerPool(dataHandler.sessionID ?? -1);
        clientHandlerPool = clientHandlerPool ? clientHandlerPool : this._clientHandlerPoolMap.get(ctrlID);
        if(!clientHandlerPool) {
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
    private destroyClientHandlerPool(ctrlID: number) : void {
        let handlerPool = this._clientHandlerPoolMap.get(ctrlID);
        if(!handlerPool) {
            return;
        }
        // 중복 세션 정리 방지: 처리된 세션 ID들을 Set으로 추적
        let processedSessionIDs = new Set<number>();
        
        // 먼저 sessionIDAndCtrlIDMap에서 해당 ctrlID 관련 세션들 정리
        let removeSessionIDs : Array<number> = [];
        this._sessionIDAndCtrlIDMap.forEach((value, key) => {
            if(value == ctrlID) {
                removeSessionIDs.push(key);
            }
        });
        
        for(let id of removeSessionIDs) {
            this._sessionIDAndCtrlIDMap.delete(id);
            // P6-T1 / REQ-09: Pool swap/destroy 시 orphan close 일괄 통보 + 활동 기록 제거.
            this._sessionLastActivityMs.delete(id);
            this._onSessionCloseCallback?.(id, 0);
            processedSessionIDs.add(id);
        }
        
        // handlerPool의 추가 세션들 정리 (중복 방지)
        handlerPool.getAllSessionIDs().forEach((id) => {
            if (!processedSessionIDs.has(id)) {
                this._onSessionCloseCallback?.(id, 0);
                processedSessionIDs.add(id);
            }
        });

        this._clientHandlerPoolMap.delete(ctrlID);
        handlerPool.end();
    }

    private markHandlerAuthenticated(handler: TunnelHandler): void {
        this.clearUnauthenticatedHandler(handler.id);
        handler.clearTimeout();
    }

    private clearUnauthenticatedHandler(handlerID: number): void {
        this._unauthenticatedHandlerIds.delete(handlerID);
    }

    private ensurePendingControlHandshake(handlerID: number): PendingControlHandshake {
        let pendingHandshake = this._pendingControlHandshakeMap.get(handlerID);
        if(pendingHandshake) {
            return pendingHandshake;
        }
        pendingHandshake = {
            challengeNonce: createOpaqueToken(24),
            protocolVersion: CONTROL_PROTOCOL_V2,
            capabilities: DEFAULT_PROTOCOL_V2_CAPABILITIES
        };
        this._pendingControlHandshakeMap.set(handlerID, pendingHandshake);
        return pendingHandshake;
    }

    private rejectHandshake(handler: TunnelControlHandler, reason: string): void {
        logger.error(`${reason}. id: ${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
        const packet = CtrlPacket.message(handler.id, {type: "log", payload: `<Fatal> ${reason}`});
        handler.sendData(packet.toBuffer());
        this._pendingControlHandshakeMap.delete(handler.id);
        const timeoutId = setTimeout(() => {
            handler.destroy();
            this._authTimeouts.delete(timeoutId);
        }, 250);
        this._authTimeouts.add(timeoutId);
    }

    public getClientSysInfo(clientID: number) : SysInfo | undefined {
        let handlerPool = this._clientHandlerPoolMap.get(clientID);
        if(!handlerPool) return undefined;
        return handlerPool.sysInfo;
    }


}

export { TunnelServer, ClientStatus};
