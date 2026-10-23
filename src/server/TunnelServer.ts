import {DEFAULT_SESSION_TTL_MS, resolveSessionTtlMs} from "../types/TunnelingOption";
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
import {rateLimitBucketOf} from "./security/ConnectionRateLimiter";
import {TunnelHandshakePolicyRegistry} from "./TunnelHandshakePolicy";
import {timingSafeStringEqual} from "../util/timingSafeStringEqual";
import LoggerFactory  from "../util/logger/LoggerFactory";
import {SysInfo} from "../commons/SysMonitor";
import {EnrollmentRegistry} from "./EnrollmentRegistry";
import {sealEnrollmentPayload} from "../commons/Enrollment";
import {EnrollmentPayload, EnrollResponseMeta} from "../commons/ProtocolV2";
import {CONTROL_CERT_SERVER_NAME} from "./CertificationStore";
import {heartbeatKindOf, HeartbeatPolicyRegistry} from "../commons/Heartbeat";
const logger = LoggerFactory.getLogger('server', 'TunnelServer');

/** 등록 교환 결과(#212 REQ-11 감사). 코드·비밀값은 담지 않는다. */
type OnEnrollmentEvent = (event: {success: boolean, clientId?: string, address: string, reason?: string}) => void;

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

// P6-T1 / REQ-09: 세션-TTL/heartbeat. 기본 1시간 무응답 시 강제 종료.
// 테스트에서는 정적 setter로 짧게 조정할 수 있다(스테이트리스 싱글턴 회피 → per-instance 설정).
const DEFAULT_SESSION_HEARTBEAT_CHECK_INTERVAL_MS = 5_000;

// P6-T1 개선 1회차 / F4: configureSessionTtl 범위 방어. REQ-15와 대칭.
const MIN_SESSION_TTL_CHECK_INTERVAL_MS = 100;
const MAX_SESSION_TTL_CHECK_INTERVAL_MS = 60_000;

/** legacy 인증 실패 제한: 주소당 창(1분) 안에 10회 실패하면 창이 끝날 때까지 거절한다(#165). */
const LEGACY_AUTH_FAILURE_WINDOW_MS = 60_000;
const LEGACY_AUTH_MAX_FAILURES = 10;
const LEGACY_AUTH_TRACKED_ADDRESSES = 10_000;
/** 터널 포트에서 TLS 핸드셰이크 중일 수 있는 연결 수의 상한(#181). */
const TUNNEL_MAX_PENDING_TLS_HANDSHAKES = 512;

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
    /** #230: heartbeat 를 지원하는 클라이언트 중 조용해진 제어 연결을 찾는 타이머. */
    private _heartbeatTimer : NodeJS.Timeout | undefined;
    // P6-T1 개선 1회차 / F3: close() 진입 후 dispatch 된 TTL 콜백 race 가드.
    private _closed : boolean = false;
    private _authTimeouts : Set<NodeJS.Timeout> = new Set<NodeJS.Timeout>();
    private _unauthenticatedHandlerIds: Set<number> = new Set<number>();
    /** 미인증 연결의 절대 기한 타이머와 원격 주소별 개수(#157). */
    private _unauthenticatedDeadlines: Map<number, NodeJS.Timeout> = new Map<number, NodeJS.Timeout>();
    private _unauthenticatedAddressOf: Map<number, string> = new Map<number, string>();
    private _unauthenticatedPerAddress: Map<string, number> = new Map<string, number>();
    /** 세션에 아직 붙지 않은 데이터 연결(제어 예산과 따로 센다, #157). */
    private _pendingDataHandlerIds: Set<number> = new Set<number>();
    private _pendingDataPerAddress: Map<string, number> = new Map<string, number>();
    /** 핸드셰이크를 거절한 제어 연결. 닫힐 때까지 이후 패킷을 버린다(#165 — 한 연결에서 키를 대입하지 못하게). */
    private _rejectedHandlerIds: Set<number> = new Set<number>();
    /** 주소별 legacy 인증 실패 기록. 연결을 새로 맺으며 키를 대입하지 못하게 일정 시간 막는다(#165). */
    private _legacyAuthFailures: Map<string, {count: number; windowStart: number}> = new Map();
    private _strictWithoutClientCa = false;
    private _nextSelectIdx = 0;
    private _onSessionCloseCallback? : OnSessionCloseCallback;
    private _onReceiveDataCallback? : OnReceiveDataCallback;
    /** 등록 교환(#212). 응답에 담을 제어 인증서와, 코드를 기억하는 레지스트리. */
    private readonly _controlCertPem: string;
    private _enrollment?: {registry: EnrollmentRegistry, onEvent: OnEnrollmentEvent};


    public set onSessionCloseCallback(value: OnSessionCloseCallback) {
        this._onSessionCloseCallback = value;
    }

    public set onReceiveDataCallback(value: OnReceiveDataCallback) {
        this._onReceiveDataCallback = value;
    }


    private constructor(option:{port: number, tls: boolean, key: string, keepAlive: number, controlProtocolMode: ControlProtocolMode, allowLegacyControlAuth: boolean, trustedClients?: Array<{clientId: string, clientSecret: string, displayName?: string}>}, certInfo: CertInfo) {
        this._serverOption = option;
        this._key = option.key;
        this._controlCertPem = certInfo.cert.value;
        this._identityRegistry = new IdentityRegistry(option.trustedClients ?? []);
        let tcpServerOption : ServerOption = {
            port: option.port,
            tls: option.tls,
            key: certInfo.key.value,
            cert: certInfo.cert.value,
            ca: (certInfo.ca.value == '') ? undefined : certInfo.ca.value,
            keepAlive: option.keepAlive,
            // mtls-strict 는 검증된 클라이언트 인증서를 요구한다(SRS MODE-CTRL-PROTO-001, #159). 제어·데이터 연결이 같은 리스너다.
            requestClientCert: option.tls && option.controlProtocolMode === "mtls-strict",
            handshakeTimeoutMs: TunnelHandshakePolicyRegistry.current().timeoutMs,
            // 핸드셰이크 중인 연결은 미인증 상한(바인드 뒤에 센다) 밖이라 따로 묶는다. 512MB 서버의 fd·메모리를 지킨다(#181).
            maxPendingTlsHandshakes: TUNNEL_MAX_PENDING_TLS_HANDSHAKES,
            // 인증된 클라이언트도 세션이 몰리면 데이터 연결의 핸드셰이크가 겹친다. 핸드셰이크 단계에서는 인증 여부를 모르므로
            // 바인드 뒤 인증 주소에 주는 상한(전체 미인증 상한의 절반)과 같게 둔다.
            maxPendingTlsHandshakesPerAddress: Math.floor(TunnelHandshakePolicyRegistry.current().maxUnauthenticatedConnections / 2),
            addressBucketOf: rateLimitBucketOf
        };
        // 클라이언트 인증서의 신뢰 앵커는 터널 인증서의 ca 다. 비어 있으면 시스템 루트로 검증되어 공인 CA 가 발급한
        // 아무 인증서나 통과하므로, strict 모드는 ca 없이 아무 클라이언트도 받지 않는다(fail closed, #159).
        this._strictWithoutClientCa = option.controlProtocolMode === "mtls-strict" && tcpServerOption.ca === undefined;
        if(this._strictWithoutClientCa) {
            logger.error('mtls-strict requires a CA certificate (tunnel certificate ca) to verify client certificates; all handshakes will be rejected');
        }
        if(option.allowLegacyControlAuth) {
            // legacy 경로는 바인딩 토큰이 없어 추측한 데이터 핸들러 ID 로 세션을 가로챌 수 있다(#174).
            logger.warn('Legacy shared-key control auth is enabled: legacy data connections carry no binding token, so a guessed handler ID can take over a session. Turn it off after the rollback window.');
        }
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
                    this._closed = false;
                    this.startSessionTtlTimer();
                    this.startHeartbeatTimer();
                    resolve();
                }
            });
        });
    }

    // P6-T1 / REQ-09: 세션 TTL 설정 API. 테스트/운영에서 동적 조정 가능.
    // P6-T1 개선 1회차 / F4: 범위 밖 값은 예외로 차단(REQ-15 handshake policy 검증과 대칭).
    public get sessionTtlPolicy(): Readonly<{ttlMs: number; checkIntervalMs: number}> {
        return {ttlMs: this._sessionTtlMs, checkIntervalMs: this._sessionTtlCheckIntervalMs};
    }

    public configureSessionTtl(ttlMs: number, checkIntervalMs?: number) : void {
        if(ttlMs === undefined) throw new RangeError('session TTL is required');
        const result = resolveSessionTtlMs(ttlMs);
        if(!result.success) throw new RangeError(result.message);
        if(checkIntervalMs !== undefined && (!Number.isFinite(checkIntervalMs) || checkIntervalMs < MIN_SESSION_TTL_CHECK_INTERVAL_MS ||
            checkIntervalMs > MAX_SESSION_TTL_CHECK_INTERVAL_MS || (ttlMs > 0 && checkIntervalMs >= ttlMs)))
            throw new RangeError('Invalid session TTL check interval');
        const interval = checkIntervalMs ?? (ttlMs > 0 ? Math.min(this._sessionTtlCheckIntervalMs, ttlMs - 1) : this._sessionTtlCheckIntervalMs);
        this.stopSessionTtlTimer();
        this._sessionTtlMs = result.ttlMs;
        this._sessionTtlCheckIntervalMs = interval;
        this.startSessionTtlTimer();
    }

    private startSessionTtlTimer() : void {
        if(this._sessionTtlTimer || this._closed || !this.isRunning || this._sessionTtlMs === 0) return;
        this._sessionTtlTimer = setInterval(() => {
            this.enforceSessionTtl();
        }, this._sessionTtlCheckIntervalMs);
        // node unref → test 프로세스 종료 방해 방지.
        if(this._sessionTtlTimer && typeof (this._sessionTtlTimer as any).unref === "function") {
            (this._sessionTtlTimer as any).unref();
        }
    }

    private startHeartbeatTimer() : void {
        if(this._heartbeatTimer || this._closed) return;
        const policy = HeartbeatPolicyRegistry.current();
        this._heartbeatTimer = setInterval(() => this.expireSilentControls(policy.timeoutMs), policy.intervalMs);
        this._heartbeatTimer.unref?.();
    }

    private stopHeartbeatTimer() : void {
        if(this._heartbeatTimer) clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = undefined;
    }

    /**
     * #230 REQ-2: heartbeat 를 알린 클라이언트가 timeoutMs 동안 아무 제어 패킷도 보내지 않으면 반쯤 열린 연결로 보고 정리한다.
     * heartbeat 를 모르는 클라이언트(REQ-3)는 건드리지 않는다.
     */
    private expireSilentControls(timeoutMs: number) : void {
        if(this._closed || !this.isRunning) return;
        const now = Date.now();
        for(const [ctrlID, pool] of [...this._clientHandlerPoolMap]) {
            if(pool.supportsHeartbeat && now - pool.lastControlReceiveAt > timeoutMs) {
                logger.warn(`Control connection of ${pool.clientId ?? ctrlID} sent nothing for ${now - pool.lastControlReceiveAt}ms. Closing it as half-open.`);
                this.destroyClientHandlerPool(ctrlID);
            }
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
        this.stopHeartbeatTimer();
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
            this._unauthenticatedDeadlines.forEach((deadline) => clearTimeout(deadline));
            this._unauthenticatedDeadlines.clear();
            this._unauthenticatedAddressOf.clear();
            this._unauthenticatedPerAddress.clear();
            this._pendingDataHandlerIds.clear();
            this._pendingDataPerAddress.clear();
            this._rejectedHandlerIds.clear();
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


    private hasAuthenticatedControlFrom(address: string): boolean {
        for(const pool of this._clientHandlerPoolMap.values()) {
            if(rateLimitBucketOf(pool.controlRemoteAddress ?? '') === address) return true;
        }
        return false;
    }

    private onClientHandlerBound = (handler: TunnelHandler) : void => {
        const handshakePolicy = TunnelHandshakePolicyRegistry.current();
        // 주소별 상한은 rate-limit 과 같은 버킷(IPv6 /64)으로 센다. 주소 하나 단위면 /64 안에서 주소만 바꿔 상한을 피한다(#157·#167).
        const address = rateLimitBucketOf(handler.socket.remoteAddress ?? '');
        const fromAddress = this._unauthenticatedPerAddress.get(address) ?? 0;
        // 인증된 제어 연결이 있는 주소는 세션마다 새 데이터 연결을 연다. 바인드 순간에는 데이터 연결인지 모르므로
        // 같은 상한으로 세면 세션이 몰릴 때 정상 세션이 실패한다. 그 주소는 상한을 4배로 올리되, 같은 NAT·/64 의
        // 공격자가 전체 슬롯을 차지하지 못하게 전체의 절반을 넘지 않는다(#181).
        const perAddressLimit = this.hasAuthenticatedControlFrom(address)
            ? Math.max(handshakePolicy.maxUnauthenticatedPerAddress, Math.min(handshakePolicy.maxUnauthenticatedPerAddress * 4, Math.floor(handshakePolicy.maxUnauthenticatedConnections / 2)))
            : handshakePolicy.maxUnauthenticatedPerAddress;
        const perAddressCapped = fromAddress >= perAddressLimit;
        if(this._unauthenticatedHandlerIds.size >= handshakePolicy.maxUnauthenticatedConnections || perAddressCapped) {
            logger.warn(`Rejecting unauthenticated connection because the cap is reached. handler=${handler.id}`);
            handler.destroy();
            return;
        }
        this._unauthenticatedHandlerIds.add(handler.id);
        this._unauthenticatedAddressOf.set(handler.id, address);
        this._unauthenticatedPerAddress.set(address, fromAddress + 1);
        // 평소에는 약한 서버를 위해 넉넉한 기한을 주고, 미인증 슬롯이 절반 넘게 차면(슬롯을 채우는 공격) 짧은 기한을 준다(#181).
        const underPressure = this._unauthenticatedHandlerIds.size > handshakePolicy.maxUnauthenticatedConnections / 2;
        const deadlineMs = underPressure ? Math.min(handshakePolicy.timeoutMs, handshakePolicy.underPressureTimeoutMs) : handshakePolicy.timeoutMs;
        handler.setTimeout(deadlineMs);
        // 소켓 타임아웃은 유휴 시간만 잰다. 주기적으로 바이트를 보내면 슬롯을 영원히 차지하므로 바인드 시각 기준으로도 닫는다.
        const deadline = setTimeout(() => {
            if(!this._unauthenticatedHandlerIds.has(handler.id) && !this._pendingDataHandlerIds.has(handler.id)) return;
            logger.warn(`Closing unauthenticated connection at the handshake deadline. handler=${handler.id}`);
            this.clearUnauthenticatedHandler(handler.id);
            handler.destroy();
        }, deadlineMs);
        deadline.unref?.();
        this._unauthenticatedDeadlines.set(handler.id, deadline);
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
        this.ensurePendingControlHandshake(ctrlHandler.id).capabilities = [...handshakeMeta.capabilities];
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
        ctrlHandlerPool.isSessionOwned = (sessionID: number) => this._sessionIDAndCtrlIDMap.get(sessionID) === handler.id;
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
                if(!this.moveToPendingDataBudget(dataHandler)) return;
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
                    const payload = result.remainBuffer;
                    handler.leftOverBuffer = undefined;
                    handler.ctrlID = result.packet.ctrlID;
                    handler.handlerID = result.packet.handlerID;
                    handler.sessionID = result.packet.firstSessionID;
                    handler.bindingToken = result.packet.bindingToken;
                    clientHandlerPool.putNewDataHandler(handler);
                    if(!handler.isEnd()) {
                        this.markHandlerAuthenticated(handler);
                        if(payload && payload.length > 0) this.receiveSessionPayload(handler, payload);
                    }

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
            this.receiveSessionPayload(handler, data);
        }
    }

    /** #163: 세션의 터널 데이터 소켓이 배압 상태인지(업로드 방향). */
    public isSessionBackpressured(sessionID: number) : boolean {
        return this.findClientHandlerPool(sessionID)?.isSessionBackpressured(sessionID) ?? false;
    }

    public addSessionPressureReliefListener(sessionID: number, listener: () => void) : void {
        this.findClientHandlerPool(sessionID)?.addSessionPressureReliefListener(sessionID, listener);
    }

    public pauseSessionSource(sessionID: number) : void {
        this.findClientHandlerPool(sessionID)?.pauseSessionRead(sessionID);
    }

    public resumeSessionSource(sessionID: number) : void {
        this.findClientHandlerPool(sessionID)?.resumeSessionRead(sessionID);
    }

    private receiveSessionPayload(handler: TunnelDataHandler, data: Buffer): void {
        if (!handler.sessionID) {
            logger.error('onReceiveDataHandler: sessionID is undefined');
            handler.endImmediate();
            return;
        }
        const ctrlPool = this.findClientHandlerPool(handler.sessionID);
        if(!ctrlPool) {
            this._onSessionCloseCallback?.(handler.sessionID, 0);
            return;
        }
        // P6-T1 / REQ-09: 데이터 수신도 활동으로 간주 → TTL 리셋.
        this.markSessionActivity(handler.sessionID);
        if(!ctrlPool.pushReceiveBuffer(handler.sessionID, data) && !handler.isEnd()) {
            this._onSessionCloseCallback?.(handler.sessionID, 0);
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
                // 인증 전이면 pool 이 없다. 그대로 두면 연결이 기한까지 남으므로 바로 닫는다(#157).
                if(!this._clientHandlerPoolMap.has(handler.id)) {
                    handler.destroy();
                    return;
                }
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
        // 인증 전 패킷은 debug 로만 남긴다. 인증 없이 패킷마다 info 로그를 쌓게 하지 않는다(#157).
        const packetLog = 'receive ctrl packet - cmd:' + CtrlCmd[packet.cmd] + ', handler id: ' + handler.id + ', remote: ' + handler.remoteAddress + ':' + handler.remotePort;
        // #230: heartbeat 는 몇 초마다 오므로 로그를 남기지 않는다.
        if(heartbeatKindOf(packet)) { /* no log */ }
        else if(this._unauthenticatedHandlerIds.has(handler.id)) logger.debug(packetLog); else logger.info(packetLog);
        if(this._rejectedHandlerIds.has(handler.id)) return;
        if((packet.cmd == CtrlCmd.SyncCtrl || packet.cmd == CtrlCmd.AckCtrl) && this._clientHandlerPoolMap.has(handler.id)) {
            // 인증된 연결의 핸드셰이크 재전송은 무시한다. 새 pool 을 만들면 기존 세션이 고아가 된다(#165).
            logger.warn(`Ignored ${CtrlCmd[packet.cmd]} on an authenticated control connection. id: ${handler.id}`);
            return;
        }
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
                if(this._serverOption.controlProtocolMode === "mtls-strict" && (this._strictWithoutClientCa || !ctrlHandler.isClientCertificateVerified())) {
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
                    // 이름 매칭(allowedClientNames)은 서버에 등록된 표시 이름으로만 한다. 클라이언트가 보낸 이름은 믿지 않는다(#162).
                    displayName: trustedClient.displayName || ackV2Meta.clientId,
                    protocolVersion: ackV2Meta.protocolVersion || CONTROL_PROTOCOL_V2,
                    capabilities: (ackV2Meta.capabilities ?? pendingHandshake.capabilities).filter(capability =>
                        capability !== 'close-count-safe' || pendingHandshake.capabilities.includes(capability)),
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
            const address = ctrlHandler.socket.remoteAddress ?? '';
            if(this.isLegacyAuthBlocked(address)) {
                this.rejectHandshake(ctrlHandler, "Too many failed legacy authentications from this address");
                return;
            }
            // P3-T4 / REQ-04: legacy auth-key 비교도 상수시간 헬퍼로 교체.
            // 입력은 임의 utf8이며 길이가 고정되지 않으므로 'utf8' 인코딩 사용.
            if(!timingSafeStringEqual(packet.ackKey ?? "", this._key ?? "", "utf8")) {
                this.recordLegacyAuthFailure(address);
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
        } else if(packet.cmd == CtrlCmd.EnrollRequest && !this._clientHandlerPoolMap.has(handler.id)) {
            this.handleEnrollRequest(handler, packet);
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

    public configureEnrollment(registry: EnrollmentRegistry, onEvent: OnEnrollmentEvent): void {
        this._enrollment = {registry, onEvent};
    }

    /**
     * 등록 교환(#212 REQ-5~REQ-8). 인증 전 연결에서만 받는다. 응답을 보내고 연결을 닫는다.
     * 연결은 끝까지 미인증으로 남아 인증 전 단계의 기한·연결 수 제한을 그대로 받는다.
     */
    private handleEnrollRequest(handler: TunnelHandler, packet: CtrlPacket): void {
        const address = handler.remoteAddress;
        const meta = packet.enrollRequestMetaResult;
        let response: EnrollResponseMeta;
        let clientId: string | undefined;
        // #221: 발급 때뿐 아니라 교환 때도 모드를 본다. strict 는 TLS 계층이 먼저 막지만 그 한 겹에만 기대지 않는다.
        // 코드를 소진하지 않고 답한다.
        if(!this._enrollment || !this._serverOption.tls || this._serverOption.controlProtocolMode === "mtls-strict") {
            response = {ok: false, reason: "unavailable"};
        } else {
            const taken = this._enrollment.registry.take(meta.kind === "valid" ? meta.value.lookup : "", address);
            const trusted = taken.ok ? this._identityRegistry.findTrustedClient(taken.clientId) : undefined;
            if(taken.ok && trusted) {
                clientId = trusted.clientId;
                const payload: EnrollmentPayload = {clientId: trusted.clientId, clientSecret: trusted.clientSecret,
                    serverName: CONTROL_CERT_SERVER_NAME, tls: true, ca: this._controlCertPem};
                response = {ok: true, ...sealEnrollmentPayload(taken.keys, payload)};
            } else {
                response = {ok: false, reason: taken.ok ? "rejected" : taken.reason};
            }
        }
        // 제한에 걸린 요청과 등록을 받지 않는 서버의 요청은 감사하지 않는다. 인증 전 연결로 감사 큐를 채우지 못하게 한다.
        if(response.ok || response.reason === "rejected") {
            this._enrollment?.onEvent({success: response.ok, clientId, address, reason: response.ok ? undefined : response.reason});
        }
        this._rejectedHandlerIds.add(handler.id);
        handler.sendData(CtrlPacket.createEnrollResponse(response).toBuffer(), () => {
            const timer = setTimeout(() => {
                this._authTimeouts.delete(timer);
                this._rejectedHandlerIds.delete(handler.id);
                handler.destroy();
            }, 250);
            this._authTimeouts.add(timer);
        });
    }

    /**
     * 신뢰 클라이언트 목록을 제어 서버를 다시 시작하지 않고 바꾼다(#212 REQ-3).
     * 지워졌거나 비밀값이 바뀐 클라이언트의 연결만 끊는다. 끊은 clientId 목록을 돌려준다.
     */
    public updateTrustedClients(trustedClients: Array<{clientId: string, clientSecret: string, displayName?: string}>): string[] {
        const affected = new Set(this._identityRegistry.replaceTrustedClients(trustedClients));
        const disconnected: string[] = [];
        for(const [ctrlID, pool] of [...this._clientHandlerPoolMap]) {
            if(pool.clientId && affected.has(pool.clientId)) {
                disconnected.push(pool.clientId);
                this.destroyClientHandlerPool(ctrlID);
            }
        }
        affected.forEach((clientId) => this._enrollment?.registry.revokeClient(clientId));
        return disconnected;
    }

    private isLegacyAuthBlocked(address: string): boolean {
        const state = this._legacyAuthFailures.get(address);
        if(!state) return false;
        if(Date.now() - state.windowStart >= LEGACY_AUTH_FAILURE_WINDOW_MS) {
            this._legacyAuthFailures.delete(address);
            return false;
        }
        return state.count >= LEGACY_AUTH_MAX_FAILURES;
    }

    private recordLegacyAuthFailure(address: string): void {
        const now = Date.now();
        const state = this._legacyAuthFailures.get(address);
        if(!state || now - state.windowStart >= LEGACY_AUTH_FAILURE_WINDOW_MS) {
            if(this._legacyAuthFailures.size >= LEGACY_AUTH_TRACKED_ADDRESSES) {
                const oldest = this._legacyAuthFailures.keys().next().value;
                if(oldest !== undefined) this._legacyAuthFailures.delete(oldest);
            }
            this._legacyAuthFailures.set(address, {count: 1, windowStart: now});
            return;
        }
        state.count++;
    }

    private notMatchedAuthKey(handler: TunnelControlHandler) : void {
        logger.error(`Authkey is not matched. id: ${handler.id}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
        let packet = CtrlPacket.message(handler.id,{type: 'log', payload: '<Fatal> Authkey is not matched.'});
        handler.sendData(packet.toBuffer());
        this._clientHandlerPoolMap.delete(handler.id);
        this._pendingControlHandshakeMap.delete(handler.id);
        this._rejectedHandlerIds.add(handler.id);
        const timeoutId = setTimeout(() => {
            handler.destroy();
            this._rejectedHandlerIds.delete(handler.id);
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

    /**
     * 첫 바이트로 데이터 연결임이 드러나면 제어 예산에서 빼고 데이터 예산으로 옮긴다. 기한 타이머는 그대로 둔다.
     * 데이터 예산이 차면 그 연결을 닫고 false 를 돌려준다.
     */
    private moveToPendingDataBudget(handler: TunnelHandler): boolean {
        if(!this._unauthenticatedHandlerIds.has(handler.id)) return true;
        const policy = TunnelHandshakePolicyRegistry.current();
        const address = this._unauthenticatedAddressOf.get(handler.id) ?? '';
        const deadline = this._unauthenticatedDeadlines.get(handler.id);
        this._unauthenticatedDeadlines.delete(handler.id);
        this.releaseControlBudget(handler.id);
        const fromAddress = this._pendingDataPerAddress.get(address) ?? 0;
        if(this._pendingDataHandlerIds.size >= policy.maxPendingDataConnections || fromAddress >= policy.maxPendingDataPerAddress) {
            if(deadline) clearTimeout(deadline);
            logger.warn(`Rejecting pending data connection because the cap is reached. handler=${handler.id}`);
            handler.destroy();
            return false;
        }
        this._pendingDataHandlerIds.add(handler.id);
        this._unauthenticatedAddressOf.set(handler.id, address);
        this._pendingDataPerAddress.set(address, fromAddress + 1);
        if(deadline) this._unauthenticatedDeadlines.set(handler.id, deadline);
        return true;
    }

    private releaseControlBudget(handlerID: number): void {
        if(!this._unauthenticatedHandlerIds.delete(handlerID)) return;
        const address = this._unauthenticatedAddressOf.get(handlerID);
        this._unauthenticatedAddressOf.delete(handlerID);
        if(address === undefined) return;
        const remaining = (this._unauthenticatedPerAddress.get(address) ?? 1) - 1;
        if(remaining > 0) this._unauthenticatedPerAddress.set(address, remaining);
        else this._unauthenticatedPerAddress.delete(address);
    }

    private clearUnauthenticatedHandler(handlerID: number): void {
        if(this._pendingDataHandlerIds.delete(handlerID)) {
            const address = this._unauthenticatedAddressOf.get(handlerID) ?? '';
            this._unauthenticatedAddressOf.delete(handlerID);
            const remaining = (this._pendingDataPerAddress.get(address) ?? 1) - 1;
            if(remaining > 0) this._pendingDataPerAddress.set(address, remaining);
            else this._pendingDataPerAddress.delete(address);
        }
        this._unauthenticatedHandlerIds.delete(handlerID);
        const deadline = this._unauthenticatedDeadlines.get(handlerID);
        if(deadline) clearTimeout(deadline);
        this._unauthenticatedDeadlines.delete(handlerID);
        const address = this._unauthenticatedAddressOf.get(handlerID);
        if(address === undefined) return;
        this._unauthenticatedAddressOf.delete(handlerID);
        const remaining = (this._unauthenticatedPerAddress.get(address) ?? 1) - 1;
        if(remaining > 0) this._unauthenticatedPerAddress.set(address, remaining);
        else this._unauthenticatedPerAddress.delete(address);
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
        this._rejectedHandlerIds.add(handler.id);
        const timeoutId = setTimeout(() => {
            handler.destroy();
            this._rejectedHandlerIds.delete(handler.id);
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

export { TunnelServer, ClientStatus, OnEnrollmentEvent};
