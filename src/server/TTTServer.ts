import {ExternalPortServerPool, ExternalPortServerStatus } from "./ExternalPortServerPool";
import {TunnelServer, ClientStatus} from "./TunnelServer";
import {EnrollmentRegistry} from "./EnrollmentRegistry";
import {ConnectionSecurityOption, DEFAULT_AUDIT_QUEUE_SIZE, DEFAULT_AUDIT_RETENTION_DAYS, DEFAULT_GEO_CONFIG, ServerOption, TunnelingOption, resolveSessionTtlMs} from "../types/TunnelingOption";
import SocketState from "../util/SocketState";
import {CertInfo, CertificationStore} from "./CertificationStore";
import ServerOptionStore from "./ServerOptionStore";
import LoggerFactory  from "../util/logger/LoggerFactory";
import {SysInfo} from "../commons/SysMonitor";
import AppCompositionRoot from "../bootstrap/AppCompositionRoot";
import ObjectUtil from "../util/ObjectUtil";
import {SocketHandler} from "../util/SocketHandler";
import {AdmissionController} from "./security/AdmissionController";
import {AuditSinkRegistry, recordAuditEvent} from "./audit/AuditSink";
import {AUDIT_EVENT_TYPES} from "./audit/AuditEventTypes";
import {maxActiveSeconds} from "./security/TunnelLifetimePolicy";
import {ConcurrencyDenial, ConcurrencyLimiter} from "./security/ConcurrencyLimiter";
import {PRESET_BYTES_PER_SECOND} from "./security/BandwidthLimiter";
import AuthorizationContext from "./rbac/AuthorizationContext";
import {auditDirPath, FileAuditSink} from "./audit/FileAuditSink";
const logger = LoggerFactory.getLogger('server', 'TTTServer');

type RuntimeApplyResult = {
    success: boolean;
    partial: boolean;
    warnings: string[];
    failedScopes: string[];
    restartRequiredScopes: string[];
}


/**
  ExportPortServerPool은 외부에서 들어온 handler 만 관리한다.
  Ctrl 은 TunnelServer에서 관리한다.
 */


class TTTServer {

    private _appliedServerOption: ServerOption;
    private _appliedExternal: Record<number, {option: TunnelingOption, cert: CertInfo, configurationRevision: number, certificateRevision: number}> = {};
    private _appliedScopeRevisions: Record<string, number> = {};
    private _dirtyControl = false;
    private _dirtyExternal = new Set<number>();
    private _externalPortServerPool : ExternalPortServerPool;
    private _tunnelServer : TunnelServer;
    private _sessions : Set<number> = new Set<number>();
    private _allowClientNamesMap : Map<number, Array<string>> = new Map<number, Array<string>>();
    private _allowClientIdsMap : Map<number, Array<string>> = new Map<number, Array<string>>();
    /** 발급한 등록 코드(#212). 제어 서버를 다시 만들어도 유지한다. */
    private readonly _enrollment = new EnrollmentRegistry();


    public static create(serverOption: ServerOption) : TTTServer {
        return new TTTServer(serverOption);
    }

    private constructor(serverOption: ServerOption) {
        if(serverOption.tls == undefined) serverOption.tls = false;
        this._appliedServerOption = ObjectUtil.cloneDeep(serverOption);
        this._appliedScopeRevisions = {"tunnel-control": ServerOptionStore.instance.revisionState.currentRevision,
            "memory-limit": ServerOptionStore.instance.revisionState.currentRevision,
            "session-ttl": ServerOptionStore.instance.revisionState.currentRevision};
        this._externalPortServerPool = ExternalPortServerPool.create(serverOption.tunnelingOptions);
        this._tunnelServer = this.createTunnelServer(serverOption);
        this._externalPortServerPool.OnHandlerEventCallback = this.onHandlerEventOnExternalPortServer;
        this._externalPortServerPool.OnNewSessionCallback = this.onNewSession;
        this._externalPortServerPool.OnTerminateSessionCallback = this.OnTerminateSession;
        // U5-07 / #122 — 일반 유저 터널의 활성 시간을 그룹 max_tunnel_duration_ms 로 제한한다.
        this._externalPortServerPool.ActiveTimeoutCap = (port) => maxActiveSeconds(port, AuthorizationContext);
        this._externalPortServerPool.OnAutoExpireCallback = this.onTunnelAutoExpire;
        // U5-08 / #123 — 일반 유저 그룹의 동시 연결 상한. 소유자·그룹은 판정 때마다 AuthorizationContext 에서 읽는다.
        const admission = AdmissionController.instance;
        admission.attachConcurrency(new ConcurrencyLimiter(AuthorizationContext, (port) => admission.sessionCount(port)));
        admission.onConcurrencyDenied = this.onConcurrencyDenied;
        // U5-09 / #124 — 일반 유저 그룹의 대역폭 프리셋. unlimited·슈퍼유저·migrated 는 정책이 없어 버킷도 없다.
        this._externalPortServerPool.BandwidthPolicy = (port) => {
            const owner = AuthorizationContext.ownerOf(port);
            if(!owner || owner.role === 'superuser') return undefined;
            const bytesPerSecond = PRESET_BYTES_PER_SECOND[AuthorizationContext.groupAttributes(owner.groupId).rate_limit] ?? 0;
            return bytesPerSecond > 0 ? {groupId: owner.groupId, bytesPerSecond} : undefined;
        };
        this.syncAllowedClientMaps(serverOption);
    }

    private onEnrollmentEvent = (event: {success: boolean, clientId?: string, address: string, reason?: string}): void => {
        const type = event.success ? AUDIT_EVENT_TYPES.client_enrolled : AUDIT_EVENT_TYPES.client_enroll_failed;
        recordAuditEvent({at: Date.now(), actor: {userId: 'system'}, type,
            target: {kind: 'trusted_client', id: event.clientId ?? 'unknown'}, outcome: event.success ? 'success' : 'failure',
            summary: `${type} ${event.clientId ?? ''}`.trim(),
            detail: {address: event.address, ...(event.reason ? {reason: event.reason} : {})}})
            .catch((error) => logger.error(`${type} audit failed`, error));
    }

    /**
     * 신뢰 클라이언트의 등록 코드를 발급한다(#212 REQ-4·REQ-8). 제어 연결이 TLS 가 아니거나 mtls-strict 면 발급하지 않는다:
     * 평문으로는 비밀값을 보내지 않고, strict 는 클라이언트 인증서 없는 등록 연결을 받지 않는다.
     */
    public async issueEnrollmentCode(clientId: string, ttlMs?: number): Promise<{ok: true, code: string, expiresAt: number} | {ok: false, reason: 'tls-required' | 'strict-mode' | 'unknown-client'}> {
        const applied = this._appliedServerOption;
        if(applied.tls !== true) return {ok: false, reason: 'tls-required'};
        if(applied.controlProtocolMode === 'mtls-strict') return {ok: false, reason: 'strict-mode'};
        if(!(applied.trustedClients ?? []).some((client) => client.clientId === clientId)) return {ok: false, reason: 'unknown-client'};
        const issued = await this._enrollment.issue(clientId, ttlMs);
        return {ok: true, ...issued};
    }

    private onConcurrencyDenied = (port: number, denial: ConcurrencyDenial, now: number): void => {
        recordAuditEvent({at: now, actor: {userId: 'system'}, type: AUDIT_EVENT_TYPES.conn_limit_hit,
            target: {kind: 'tunnel', id: String(port)}, outcome: 'failure',
            summary: `${AUDIT_EVENT_TYPES.conn_limit_hit} ${port}`,
            detail: {port, groupId: denial.groupId, limit: denial.limit, sessions: denial.sessions}})
            .catch((error) => logger.error(`conn_limit_hit audit failed - port: ${port}`, error));
    }

    // 그룹 상한으로 만료된 경우만 감사한다. 사용자가 정한 타임아웃의 만료는 속성 3 의 집행이 아니다.
    private onTunnelAutoExpire = (port: number, info: {timeoutSeconds: number; cappedByGroup: boolean}): void => {
        if(!info.cappedByGroup) return;
        recordAuditEvent({at: Date.now(), actor: {userId: 'system'}, type: AUDIT_EVENT_TYPES.tunnel_autoexpire,
            target: {kind: 'tunnel', id: String(port)}, outcome: 'success',
            summary: `${AUDIT_EVENT_TYPES.tunnel_autoexpire} ${port}`, detail: {port, timeoutSeconds: info.timeoutSeconds}})
            .catch((error) => logger.error(`tunnel_autoexpire audit failed - port: ${port}`, error));
    }

    private syncAllowedClientMaps(serverOption: ServerOption): void {
        this._allowClientNamesMap.clear();
        this._allowClientIdsMap.clear();
        serverOption.tunnelingOptions.forEach((option) => {
            if(option.allowedClientIds && option.allowedClientIds.length > 0) {
                this._allowClientIdsMap.set(option.forwardPort, option.allowedClientIds);
            }
            if(option.allowedClientNames && option.allowedClientNames.length > 0) {
                this._allowClientNamesMap.set(option.forwardPort, option.allowedClientNames!);
                this.warnUnmatchedClientNames(option.forwardPort, option.allowedClientNames!);
            }
        });
    }

    private bindTunnelServerCallbacks(tunnelServer: TunnelServer): void {
        tunnelServer.onSessionCloseCallback = this.onSessionClosed;
        tunnelServer.onReceiveDataCallback = this.onSessionDataReceived;
    }

    private createTunnelServer(serverOption: ServerOption): TunnelServer {
        const tempCert = CertificationStore.instance.getTempCert();
        const tunnelServer = TunnelServer.create({
            port: serverOption.port,
            key: serverOption.key,
            tls: serverOption.tls === true,
            keepAlive: serverOption.keepAlive,
            controlProtocolMode: serverOption.controlProtocolMode ?? "mixed",
            allowLegacyControlAuth: serverOption.allowLegacyControlAuth === true,
            trustedClients: serverOption.trustedClients ?? []
        }, tempCert);
        const ttl = resolveSessionTtlMs(serverOption.sessionTtlMs);
        if(ttl.success) tunnelServer.configureSessionTtl(ttl.ttlMs);
        this.bindTunnelServerCallbacks(tunnelServer);
        tunnelServer.configureEnrollment(this._enrollment, this.onEnrollmentEvent);
        return tunnelServer;
    }

    private applyAllowedClientsForPort(option?: TunnelingOption): void {
        if(!option) {
            return;
        }
        this._allowClientNamesMap.delete(option.forwardPort);
        this._allowClientIdsMap.delete(option.forwardPort);
        if(option.allowedClientIds && option.allowedClientIds.length > 0) {
            this._allowClientIdsMap.set(option.forwardPort, option.allowedClientIds);
        }
        if(option.allowedClientNames && option.allowedClientNames.length > 0) {
            this._allowClientNamesMap.set(option.forwardPort, option.allowedClientNames);
            this.warnUnmatchedClientNames(option.forwardPort, option.allowedClientNames);
        }
    }

    private async restoreExternalPortStatus(port: number, option: TunnelingOption, lastServerStatus: ExternalPortServerStatus): Promise<void> {
        // 잘린 값이 아니라 요청값과 원래 시작 시각으로 다시 건다. 상한은 지금 기준으로 다시 계산된다(#137).
        const requested = lastServerStatus.requestedTimeout ?? lastServerStatus.activeTimeout;
        this._externalPortServerPool.setActiveTimeout(port, requested);
        if(lastServerStatus.active && !option.inactiveOnStartup) {
            await this._externalPortServerPool.active(port, requested, {startedAt: lastServerStatus.activeStart});
            return;
        }
        if(!lastServerStatus.active) {
            await this._externalPortServerPool.inactive(port);
        }
    }



    private onNewSession = (id: number, opt: TunnelingOption) : void => {
        let bufferLimitOnClient = opt.bufferLimitOnClient == undefined || opt.bufferLimitOnClient < 1 ? -1 : opt.bufferLimitOnClient! * 1024 * 1024;
        this._sessions.add(id);
        let allowClientIds = this._allowClientIdsMap.get(opt.forwardPort);
        let allowClientNames = this._allowClientNamesMap.get(opt.forwardPort);
        let success = this._tunnelServer.openSession(id, {host: opt.destinationAddress,port: opt.destinationPort!,tls: opt.tls,bufferLimit: bufferLimitOnClient},allowClientNames, allowClientIds);
        if(!success) {
            this._sessions.delete(id);
            this._externalPortServerPool.closeSession(id,0);
        }
    }

    private OnTerminateSession = (sessionID: number) : void => {
        this._tunnelServer.terminateSession(sessionID);
        this._sessions.delete(sessionID);

    }

    private onHandlerEventOnExternalPortServer = (id: number, state: SocketState,bundle? : {data? : Buffer, receiveLength: number}) : void => {
        if(this.isEndState(state)) {
            this._tunnelServer.closeSession(id, bundle?.receiveLength ?? 0);
        } else if(state == SocketState.Receive) {
            if (!bundle?.data) {
                logger.error(`onHandlerEventOnExternalPortServer - bundle or data is undefined for session: ${id}, state: ${state}`);
                return;
            }
            this._tunnelServer.sendBuffer(id, bundle.data);
            // #163: 업로드 방향의 배압. 터널 데이터 소켓이 밀리면 외부 소켓 읽기를 멈추고, 풀리면 다시 읽는다(#129 와 대칭).
            if(this._tunnelServer.isSessionBackpressured(id)) {
                this._externalPortServerPool.pauseSessionRead(id);
                this._tunnelServer.addSessionPressureReliefListener(id, () => this._externalPortServerPool.resumeSessionRead(id));
            }
        }
    }

    private onSessionClosed = (id: number, endLength: number) : void => {
        this._externalPortServerPool.closeSession(id,endLength);
    }

    private onSessionDataReceived = (id: number, data: Buffer) : void => {
        if(!this._externalPortServerPool.send(id, data)) {
            // P6-T1 / REQ-09: 외부 송신 실패 시 "좀비 세션" 방지 위해 터널 세션을 닫는다.
            // (기존에는 주석 처리되어 있었으나, Pool swap/재통보 시 active하지 않은 세션이 남는 원인이었음.)
            this._tunnelServer.closeSession(id, 0);
            return;
        }
        // 이슈 #129: 다운스트림(외부 포트 핸들러)이 배압 상태면 터널 소스를 멈춰
        // 무제한으로 쌓이다 파일 캐시 한도 초과로 destroy() 되는 것을 막는다.
        if(this._externalPortServerPool.isSessionBackpressured(id)) {
            this._tunnelServer.pauseSessionSource(id);
            this._externalPortServerPool.addSessionPressureReliefListener(id, () => this._tunnelServer.resumeSessionSource(id));
        }
    }


    private isEndState (state: SocketState) : boolean  {
        return state == SocketState.Closed || state == SocketState.End  /*|| state == SocketState.Error;*/;
    }


    public externalServerStatuses() : Array<ExternalPortServerStatus> {
        let result = new Array<ExternalPortServerStatus>();
        let serverOption = ServerOptionStore.instance.serverOption;
        for(let tunnelOption of serverOption.tunnelingOptions) {
            result.push(this._externalPortServerPool.getServerStatus(tunnelOption.forwardPort));
        }
        return result;
    }


    public externalServerStatus(port: number) : ExternalPortServerStatus {
        return this._externalPortServerPool.getServerStatus(port);
    }

    public clientStatus() : Array<ClientStatus> {
        return this._tunnelServer.clientStatuses();
    }

    // U5-03 / #118 — connectionSecurity.geo 를 AdmissionController에 적용한다. #120 (U5-05)의 PUT /api/security/geo도 같은 진입점을 쓴다.
    public applyConnectionSecurity(next: ConnectionSecurityOption | undefined): void {
        const geo = next?.geo ?? DEFAULT_GEO_CONFIG;
        AdmissionController.instance.configureGeo(geo);
        this._appliedServerOption.connectionSecurity = {geo: {...geo, countries: [...geo.countries]}};
    }

    private controlOptionsChanged(next: ServerOption, previous: ServerOption): boolean {
        // trustedClients 는 제어 서버를 다시 만들지 않고 바꾼다(#212 REQ-3). 그래서 여기서 보지 않는다.
        return ['port', 'tls', 'key', 'keepAlive', 'controlProtocolMode', 'allowLegacyControlAuth']
            .some(key => (next as any)[key] !== (previous as any)[key]);
    }

    /** 제어 포트의 TLS 나 모드가 바뀌면 발급한 등록 코드는 의미가 없으므로 모두 무효로 한다(#221 REQ-2). */
    private revokeEnrollmentsIfModeChanged(next: ServerOption, previous: ServerOption): void {
        if((next.tls === true) !== (previous.tls === true) || (next.controlProtocolMode ?? "mixed") !== (previous.controlProtocolMode ?? "mixed")) {
            this._enrollment.revokeAll();
        }
    }

    private trustedClientsChanged(next: ServerOption, previous: ServerOption): boolean {
        return !ObjectUtil.canonicalEquals(next.trustedClients ?? [], previous.trustedClients ?? []);
    }

    /** 신뢰 클라이언트를 제자리에서 바꾼다. 지워졌거나 비밀값이 바뀐 클라이언트만 끊긴다. */
    private applyTrustedClients(next: ServerOption): void {
        const disconnected = this._tunnelServer.updateTrustedClients(next.trustedClients ?? []);
        if(disconnected.length > 0) logger.info(`trusted clients changed; disconnected: ${disconnected.join(', ')}`);
    }

    /** 켜져 있는 모든 외부 포트의 수명 상한을 다시 계산한다(#137 — 소유자·그룹·그룹 속성 변경 뒤). */
    public reapplyActiveCaps(): void {
        for(const port of Object.keys(this._appliedExternal).map(Number)) {
            void this._externalPortServerPool.reapplyActiveCap(port).catch((error) => logger.error(`active cap reapply failed: ${port}`, error));
        }
    }

    /**
     * v2 클라이언트는 서버에 등록된 표시 이름(없으면 clientId)으로만 이름 제한에 맞춘다(#162). 업그레이드 전에 클라이언트가
     * 보낸 이름에 맞춰 둔 터널은 그 클라이언트를 더 찾지 못하므로, 등록된 이름과 맞지 않는 항목을 기동·적용 때 알린다.
     */
    private warnUnmatchedClientNames(port: number, names: ReadonlyArray<string>): void {
        const registered = new Set((this._appliedServerOption?.trustedClients ?? []).map((client) => client.displayName || client.clientId));
        const unmatched = names.filter((name) => !registered.has(name));
        if(unmatched.length > 0) {
            logger.warn(`tunnel ${port}: allowedClientNames [${unmatched.join(', ')}] match no registered trusted client name; only legacy clients with these names can serve it`);
        }
    }

    public captureRuntimeState() {
        return {sessionTtlPolicy: this._tunnelServer.sessionTtlPolicy, serverOption: ObjectUtil.cloneDeep(this._appliedServerOption), external: ObjectUtil.cloneDeep(this._appliedExternal),
            allowClientNames: Array.from(this._allowClientNamesMap, ([port, names]) => [port, [...names]] as const),
            allowClientIds: Array.from(this._allowClientIdsMap, ([port, ids]) => [port, [...ids]] as const),
            scopes: {...this._appliedScopeRevisions}, memoryLimit: SocketHandler.maxGlobalMemoryBufferSize,
            statuses: Object.fromEntries(Object.keys(this._appliedExternal).map(port => [port, {...this._externalPortServerPool.getServerStatus(Number(port))}]))};
    }

    public async restoreRuntimeState(state: ReturnType<TTTServer['captureRuntimeState']>): Promise<string[]> {
        const failures: string[] = [];
        this.revokeEnrollmentsIfModeChanged(state.serverOption, this._appliedServerOption);
        if(this._dirtyControl || this.controlOptionsChanged(this._appliedServerOption, state.serverOption)) {
            try {
                await this._tunnelServer.close();
                const restored = this.createTunnelServer(state.serverOption);
                await restored.start();
                this._tunnelServer = restored;
                this._appliedServerOption = ObjectUtil.cloneDeep(state.serverOption);
                this._dirtyControl = false;
            } catch(error) { logger.error('control runtime restore failed', error); failures.push('tunnel-control-restore'); }
        } else if(this.trustedClientsChanged(this._appliedServerOption, state.serverOption)) {
            this.applyTrustedClients(state.serverOption);
            this._appliedServerOption.trustedClients = ObjectUtil.cloneDeep(state.serverOption.trustedClients ?? []);
        }
        try { this._tunnelServer.configureSessionTtl(state.sessionTtlPolicy.ttlMs, state.sessionTtlPolicy.checkIntervalMs); }
        catch(error) { logger.error('session TTL restore failed', error); failures.push('session-ttl-restore'); }
        if(SocketHandler.maxGlobalMemoryBufferSize !== state.memoryLimit) AppCompositionRoot.applyGlobalMemLimitMiB(state.memoryLimit / (1024 * 1024));
        for(const port of new Set([...Object.keys(state.external).map(Number), ...Object.keys(this._appliedExternal).map(Number), ...this._dirtyExternal])) {
            const previous = state.external[port];
            const status = this._externalPortServerPool.getServerStatus(port);
            const beforeStatus = state.statuses[port];
            if(!this._dirtyExternal.has(port) && ObjectUtil.equalsDeep(previous ?? {}, this._appliedExternal[port] ?? {})
                && status.online === beforeStatus?.online && status.active === beforeStatus?.active) continue;
            try {
                if(status.online && !await this._externalPortServerPool.stop(port)) { failures.push(`external-listener:${port}:restore`); continue; }
                if(previous && beforeStatus.online) {
                    if(!await this._externalPortServerPool.startServer(previous.option, previous.cert)) { failures.push(`external-listener:${port}:restore`); continue; }
                    // 남은 시간을 소수 초로 넘기면 상한 판정(cappedByGroup)이 빠져 만료 감사가 남지 않았다(#137).
                    // 요청값과 원래 시작 시각을 넘겨 상한과 마감 시각을 그대로 다시 계산한다.
                    const remaining = beforeStatus.activeTimeout > 0
                        ? beforeStatus.activeStart + beforeStatus.activeTimeout * 1000 - Date.now() : 1;
                    if(beforeStatus.active && remaining > 0) {
                        await this._externalPortServerPool.active(port, beforeStatus.requestedTimeout ?? beforeStatus.activeTimeout, {startedAt: beforeStatus.activeStart});
                    } else await this._externalPortServerPool.inactive(port);
                }
                this._allowClientNamesMap.delete(port);
                this._allowClientIdsMap.delete(port);
                if(previous) {
                    this._appliedExternal[port] = ObjectUtil.cloneDeep(previous);
                    this.applyAllowedClientsForPort(previous.option);
                } else delete this._appliedExternal[port];
                this._dirtyExternal.delete(port);
            } catch(error) { logger.error(`external runtime restore failed ${port}`, error); failures.push(`external-listener:${port}:restore`); }
        }
        this._allowClientNamesMap = new Map(state.allowClientNames.map(([port, names]) => [port, [...names]]));
        this._allowClientIdsMap = new Map(state.allowClientIds.map(([port, ids]) => [port, [...ids]]));
        if(failures.length === 0) {
            this._appliedScopeRevisions = {...state.scopes};
            this._appliedServerOption = ObjectUtil.cloneDeep(state.serverOption);
        }
        this.applyConnectionSecurity(state.serverOption.connectionSecurity);
        return failures;
    }

    private recordAppliedServerOption(next: ServerOption, controlChanged: boolean): void {
        const {adminPort, adminBindHost, adminTls} = this._appliedServerOption;
        if(this._appliedServerOption.sessionTtlMs !== next.sessionTtlMs)
            this._appliedScopeRevisions['session-ttl'] = ServerOptionStore.instance.revisionState.currentRevision;
        if(this._appliedServerOption.globalMemCacheLimit !== next.globalMemCacheLimit)
            this._appliedScopeRevisions['memory-limit'] = ServerOptionStore.instance.revisionState.currentRevision;
        this._appliedServerOption = {...ObjectUtil.cloneDeep(next), adminPort, adminBindHost, adminTls};
        if(controlChanged) this._appliedScopeRevisions['tunnel-control'] = ServerOptionStore.instance.revisionState.currentRevision;
    }

    /**
     * 저장된 감사 옵션을 실행 중 싱크에 반영한다. 큐 상한·보존 기간은 인스턴스 생성 시점에 고정되므로
     * 하나라도 달라지면 새 인스턴스로 갈아 끼운다. 새 싱크를 먼저 등록해 이후 이벤트가 새 큐로 가게 하고,
     * 옛 큐에 남은 이벤트는 close() 의 flush 가 끝까지 쓴다.
     */
    private static async applyAuditOption(nextOption: ServerOption): Promise<void> {
        const previous = AuditSinkRegistry.current();
        if(!(previous instanceof FileAuditSink)) return;
        const retentionDays = nextOption.auditRetentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS;
        const queueSize = nextOption.auditQueueSize ?? DEFAULT_AUDIT_QUEUE_SIZE;
        if(previous.retentionDays === retentionDays && previous.queueSize === queueSize) return;
        const next = new FileAuditSink({dir: auditDirPath(), queueSize, retentionDays});
        next.startRetentionTimer();
        AuditSinkRegistry.set(next);
        await previous.close();
    }

    public async applyServerOption(nextOption: ServerOption, previousOption: ServerOption): Promise<RuntimeApplyResult> {
        const ttl = resolveSessionTtlMs(nextOption.sessionTtlMs);
        if(!ttl.success) return {success: false, partial: false, failedScopes: ['session-ttl'], warnings: [ttl.message], restartRequiredScopes: []};
        if(!ObjectUtil.canonicalEquals(previousOption.connectionSecurity?.geo ?? DEFAULT_GEO_CONFIG, nextOption.connectionSecurity?.geo ?? DEFAULT_GEO_CONFIG)) {
            this.applyConnectionSecurity(nextOption.connectionSecurity);
        }
        await TTTServer.applyAuditOption(nextOption);
        const restartRequiredScopes: string[] = [];
        const warnings: string[] = [];

        if(previousOption.adminPort !== nextOption.adminPort || previousOption.adminBindHost !== nextOption.adminBindHost || previousOption.adminTls !== nextOption.adminTls) {
            restartRequiredScopes.push("admin-server");
            warnings.push("admin listener changes require process restart");
        }

        if(previousOption.globalMemCacheLimit !== nextOption.globalMemCacheLimit) {
            AppCompositionRoot.applyGlobalMemLimitMiB(nextOption.globalMemCacheLimit ?? 128);
        }

        const requiresTunnelRestart = this.controlOptionsChanged(nextOption, previousOption);
        this.revokeEnrollmentsIfModeChanged(nextOption, previousOption);

        if(!requiresTunnelRestart) {
            if(this.trustedClientsChanged(nextOption, previousOption)) this.applyTrustedClients(nextOption);
            this._tunnelServer.configureSessionTtl(ttl.ttlMs);
            this.syncAllowedClientMaps(nextOption);
            this.recordAppliedServerOption(nextOption, false);
            return {
                success: true,
                partial: restartRequiredScopes.length > 0,
                warnings,
                failedScopes: [],
                restartRequiredScopes
            };
        }

        const oldTunnelServer = this._tunnelServer;
        try {
            this._dirtyControl = true;
            await oldTunnelServer.close();
            const nextTunnelServer = this.createTunnelServer(nextOption);
            await nextTunnelServer.start();
            this._tunnelServer = nextTunnelServer;
            this.syncAllowedClientMaps(nextOption);
            this.recordAppliedServerOption(nextOption, true);
            this._dirtyControl = false;
            return {
                success: true,
                partial: restartRequiredScopes.length > 0,
                warnings,
                failedScopes: [],
                restartRequiredScopes
            };
        } catch (error) {
            logger.error(`applyServerOption failed`, error);
            try {
                const restoredTunnelServer = this.createTunnelServer(previousOption);
                await restoredTunnelServer.start();
                this._tunnelServer = restoredTunnelServer;
                this.syncAllowedClientMaps(previousOption);
            } catch (restoreError) {
                logger.error(`applyServerOption restore failed`, restoreError);
            }
            return {
                success: false,
                partial: false,
                warnings,
                failedScopes: ["tunnel-control"],
                restartRequiredScopes
            };
        }
    }

    public async applyTunnelingOption(nextOption: TunnelingOption, previousOption?: TunnelingOption, stagedCert?: CertInfo): Promise<RuntimeApplyResult> {
        const port = nextOption.forwardPort;
        const lastServerStatus = this._externalPortServerPool.getServerStatus(port);
        const nextCert = stagedCert ?? CertificationStore.instance.getExternalCert(port);

        try {
            this._dirtyExternal.add(port);
            if(lastServerStatus.online) {
                const stopped = await this._externalPortServerPool.stop(port);
                if(!stopped) {
                    throw new Error(`failed to stop listener ${port}`);
                }
            }
            await this._externalPortServerPool.startServer(nextOption, nextCert);
            await this.restoreExternalPortStatus(port, nextOption, lastServerStatus);
            this.applyAllowedClientsForPort(nextOption);
            this._appliedExternal[port] = {option: ObjectUtil.cloneDeep(nextOption), cert: ObjectUtil.cloneDeep(nextCert),
                configurationRevision: ServerOptionStore.instance.revisionState.currentRevision,
                certificateRevision: CertificationStore.instance.revisionState.currentRevision};
            this._dirtyExternal.delete(port);
            return {
                success: true,
                partial: false,
                warnings: [],
                failedScopes: [],
                restartRequiredScopes: []
            };
        } catch (error) {
            logger.error(`applyTunnelingOption failed - port: ${port}`, error);
            if(previousOption) {
                try {
                    await this._externalPortServerPool.startServer(previousOption, nextCert);
                    await this.restoreExternalPortStatus(port, previousOption, lastServerStatus);
                    this.applyAllowedClientsForPort(previousOption);
                } catch (restoreError) {
                    logger.error(`applyTunnelingOption restore failed - port: ${port}`, restoreError);
                }
            } else {
                this._allowClientNamesMap.delete(port);
                this._allowClientIdsMap.delete(port);
            }
            return {
                success: false,
                partial: false,
                warnings: [],
                failedScopes: [`external-listener:${port}`],
                restartRequiredScopes: []
            };
        }
    }

    public async applyExternalServerCert(port: number, nextCert: CertInfo, previousCert: CertInfo): Promise<RuntimeApplyResult> {
        const currentOption = ServerOptionStore.instance.getTunnelingOption(port);
        if(!currentOption || currentOption.tls !== true) {
            return {
                success: true,
                partial: false,
                warnings: [`external cert for ${port} stored for next TLS listener start`],
                failedScopes: [],
                restartRequiredScopes: []
            };
        }
        const lastServerStatus = this._externalPortServerPool.getServerStatus(port);
        if(!lastServerStatus.online) {
            return {
                success: true,
                partial: false,
                warnings: [`external cert for ${port} stored while listener is offline`],
                failedScopes: [],
                restartRequiredScopes: []
            };
        }
        try {
            // P3-T5 / REQ-08: 하향 호환성 있는 경우 setSecureContext 기반 hot-swap 우선 시도.
            //   - TLS 서버이고 end 상태가 아니면 true 반환 → 재기동(stop→start) 스킵.
            //   - TLS off / 종료 / 미지원 시 false → 기존 stop/start 폴백.
            this._dirtyExternal.add(port);
            const hotSwapped = this._externalPortServerPool.applyTlsCertificateHotSwap(port, nextCert);
            if(hotSwapped) {
                logger.info(`applyExternalServerCert: hot-swapped TLS cert on port ${port} (no restart)`);
                if(this._appliedExternal[port]) {
                    this._appliedExternal[port].cert = ObjectUtil.cloneDeep(nextCert);
                    this._appliedExternal[port].certificateRevision = CertificationStore.instance.revisionState.currentRevision;
                }
                this._dirtyExternal.delete(port);
                return {
                    success: true,
                    partial: false,
                    warnings: [],
                    failedScopes: [],
                    restartRequiredScopes: []
                };
            }
            const stopped = await this._externalPortServerPool.stop(port);
            if(!stopped) {
                throw new Error(`failed to stop listener ${port}`);
            }
            await this._externalPortServerPool.startServer(currentOption, nextCert);
            await this.restoreExternalPortStatus(port, currentOption, lastServerStatus);
            if(this._appliedExternal[port]) {
                this._appliedExternal[port].cert = ObjectUtil.cloneDeep(nextCert);
                this._appliedExternal[port].certificateRevision = CertificationStore.instance.revisionState.currentRevision;
            }
            this._dirtyExternal.delete(port);
            return {
                success: true,
                partial: false,
                warnings: [],
                failedScopes: [],
                restartRequiredScopes: []
            };
        } catch (error) {
            logger.error(`applyExternalServerCert failed - port: ${port}`, error);
            try {
                await this._externalPortServerPool.startServer(currentOption, previousCert);
                await this.restoreExternalPortStatus(port, currentOption, lastServerStatus);
            } catch (restoreError) {
                logger.error(`applyExternalServerCert restore failed - port: ${port}`, restoreError);
            }
            return {
                success: false,
                partial: false,
                warnings: [],
                failedScopes: [`external-cert:${port}`],
                restartRequiredScopes: []
            };
        }
    }


    public async stopExternalPortServer(port: number, removeConfiguration = false) : Promise<boolean> {
        this._dirtyExternal.add(port);
        this._allowClientNamesMap.delete(port);
        this._allowClientIdsMap.delete(port);
        const stopped = await this._externalPortServerPool.stop(port);
        if(stopped) {
            if(removeConfiguration) delete this._appliedExternal[port];
            this._dirtyExternal.delete(port);
        }
        return stopped;
    }

    public async activeExternalPortServer(port: number, timeout: number) : Promise<boolean> {
        return await this._externalPortServerPool.active(port, timeout);
    }

    public async inactiveExternalPortServer(port: number) : Promise<boolean> {
        return await this._externalPortServerPool.inactive(port);
    }




    public async start() : Promise<void> {
        let optionStore =  ServerOptionStore.instance;
        let tunnelOptions =  optionStore.getTunnelingOptions();
        let certStore = CertificationStore.instance;
        for(let tunnelOption of tunnelOptions) {
            try {
                const cert = certStore.getExternalCert(tunnelOption.forwardPort);
                const started = await this._externalPortServerPool.startServer(tunnelOption, cert);
                // 기동 시 자동 활성은 타이머가 없으므로, 상한이 있는 터널은 active() 로 다시 켜 상한 타이머를 건다.
                if(started && !tunnelOption.inactiveOnStartup && maxActiveSeconds(tunnelOption.forwardPort, AuthorizationContext) !== undefined) {
                    await this._externalPortServerPool.active(tunnelOption.forwardPort);
                }
                this._appliedExternal[tunnelOption.forwardPort] = {option: ObjectUtil.cloneDeep(tunnelOption), cert,
                    configurationRevision: optionStore.revisionState.currentRevision, certificateRevision: certStore.revisionState.currentRevision};
            } catch (err) {
                logger.error(`start - failed to start external port server. ${JSON.stringify(tunnelOption)}`,err);
            }
        }
        await this._tunnelServer.start();
    }

    public async close() : Promise<void> {
        this._enrollment.clear();
        await this._externalPortServerPool.stopAll();
        await this._tunnelServer.close();
    }

    public getClientSysInfo(clientID: number) : SysInfo | undefined {
        return this._tunnelServer.getClientSysInfo(clientID);
    }

    // P6-T1 개선 1회차 / REQ-09: 테스트/운영 진단용 TunnelServer 직접 접근.
    // 내부 맵 상태 검증(debugSessionCount)과 TTL 주입(configureSessionTtl) 경로에 사용.
    public get tunnelServer() : TunnelServer {
        return this._tunnelServer;
    }

}

export default TTTServer;
