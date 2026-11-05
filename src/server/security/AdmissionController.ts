import {ADMIT, AdmissionDecision, AdmissionDenial, AdmissionPolicy, AdmissionReason, AdmissionScope} from "./AdmissionPolicy";
import {ConnectionRateLimiter} from "./ConnectionRateLimiter";
import {normalizeRemoteAddress} from "./address";
import {GeoFilter} from "./GeoFilter";
import {DenialAggregator} from "./DenialAggregator";
import {ConcurrencyDenial, ConcurrencyLimiter} from "./ConcurrencyLimiter";
import {AuditRateGate} from "./AuditRateGate";
import LoggerFactory from "../../util/logger/LoggerFactory";
import {ConnectionSecurityOption, DEFAULT_GEO_CONFIG, GeoConfig} from "../../types/TunnelingOption";
import {IpBlocklist} from "./IpBlocklist";
import {DenialScope, DenialTally} from "./DenialTally";
import {RecentDenial, RecentDenials} from "./RecentDenials";
import {DenialFileLog} from "./DenialFileLog";

export type TunnelRateLimitSource = {
    forwardPort: number;
    rateLimit?: {enabled: boolean; windowMs: number; maxConnections: number; banMs: number};
};

export const PRUNE_INTERVAL_MS = 30_000;

export type PortDenialStats = {rejectedGeo: number; rejectedBlocklist: number; rejectedBans: number;
    rejectedExceeded: number; rejectedConcurrency: number; bannedIps: number};

const IP_BLOCKLIST_DENY: AdmissionDenial = Object.freeze({allowed: false, reason: 'ip-blocklist'});

export class AdmissionController implements AdmissionPolicy {
    private static _instance: AdmissionController | undefined;

    public static get instance(): AdmissionController {
        if (!this._instance) this._instance = new AdmissionController();
        return this._instance;
    }

    public static resetForTest(): void {
        if (this._instance) this._instance.dispose();
        this._instance = undefined;
    }

    public readonly rateLimiter = new ConnectionRateLimiter();
    public readonly geo = new GeoFilter();
    // #286 관리자 차단 목록. 터널 포트와 무관하게 살아 있으므로 configureTunnel·releaseTunnel 이 건드리지 않는다.
    public readonly blocklist = new IpBlocklist();
    // 거절은 건마다 로그로 남지 않는다. 30초 prune 타이머가 창이 닫힌 버킷만 한 줄로 내보낸다.
    public readonly denialLog = new DenialAggregator(line => LoggerFactory.getLogger('server', 'Admission').warn(line));
    // #327: 모든 거절은 recordDenial 한 곳을 지난다. 누적 건수와 최근 기록을 함께 남긴다.
    private readonly _tally = new DenialTally();
    private readonly _recent = new RecentDenials();
    // #327 REQ-7: 거절 로그 파일. 서버가 시작할 때 configureDenialLog 가 만든다.
    private _fileLog: DenialFileLog | undefined;
    private _concurrencyProvider: ((port: number) => number) | undefined;
    // #123 (U5-08) 동시 연결 상한. 소유자·그룹은 TTTServer 가 넘긴 limiter 가 판정 시점에 읽는다(rbac 를 import 하지 않는다).
    private _concurrency: ConcurrencyLimiter | null = null;
    private _onConcurrencyDenied: ((port: number, denial: ConcurrencyDenial, now: number) => void) | null = null;
    private readonly _concurrencyAuditGate = new AuditRateGate(60_000);
    private _pruneTimer: NodeJS.Timeout | undefined;

    private constructor() {
        this.geo.configure(DEFAULT_GEO_CONFIG as GeoConfig);
    }

    public configureGeo(config: GeoConfig): void {
        this.geo.configure(config);
    }

    /** 연결 보안 설정 전체(국가 필터·차단 목록)를 적용하는 진입점이다(#286). */
    public configureConnectionSecurity(option: ConnectionSecurityOption): void {
        this.configureGeo(option.geo);
        this.blocklist.configure(option.blocklist ?? []);
    }

    private dispose(): void {
        if (this._pruneTimer) clearInterval(this._pruneTimer);
        this._pruneTimer = undefined;
        this._fileLog?.configure(0);
    }

    private ensurePruneTimer(): void {
        if (this._pruneTimer) return;
        this._pruneTimer = setInterval(() => {
            const now = Date.now();
            this.rateLimiter.prune(now);
            this.denialLog.flushDue(now);
            this._fileLog?.tick(now);
            this._concurrencyAuditGate.prune(now);
        }, PRUNE_INTERVAL_MS).unref();
    }

    /**
     * #327: 거절 로그 파일의 보관 일수를 정한다. 서버가 시작할 때와 설정을 저장할 때 부른다.
     * 0 이하이면 쓰지 않는다. 주기 타이머는 터널이 없어도 여기서 시작한다(관리 화면 거절만 있어도 쓴다).
     */
    public configureDenialLog(dir: string, retentionDays: number): void {
        if (this._fileLog && this._fileLog.directory !== dir) {
            this._fileLog.configure(0);
            this._fileLog = undefined;
        }
        this._fileLog ??= new DenialFileLog({dir, countryOf: (ip) => this.geo.displayCountry(ip)});
        this._fileLog.configure(retentionDays);
        this.ensurePruneTimer();
    }

    public get denialFileLog(): DenialFileLog | undefined {
        return this._fileLog;
    }

    public configureTunnel(option: TunnelRateLimitSource): void {
        this.ensurePruneTimer();

        if (option.rateLimit?.enabled) {
            const {windowMs, maxConnections, banMs} = option.rateLimit;
            this.rateLimiter.configurePort(option.forwardPort, {windowMs, maxConnections, banMs});
        } else {
            this.rateLimiter.configurePort(option.forwardPort, undefined);
        }
    }

    // 포트별 현재 세션 수 공급 함수. 저장만 한다(사용은 #123 이 담당).
    public configureConcurrency(provider: (port: number) => number): void {
        this._concurrencyProvider = provider;
    }

    public attachConcurrency(limiter: ConcurrencyLimiter | null): void {
        this._concurrency = limiter;
    }

    /** 동시 연결 상한 거절 알림. 포트·그룹별 1분에 한 번만 부른다(감사용). */
    public set onConcurrencyDenied(callback: ((port: number, denial: ConcurrencyDenial, now: number) => void) | null) {
        this._onConcurrencyDenied = callback;
    }

    // #123 (U5-08)의 ConcurrencyLimiter가 이 메서드로 포트별 세션 수를 읽는다.
    public sessionCount(port: number): number {
        return this._concurrencyProvider?.(port) ?? 0;
    }

    public releaseTunnel(port: number): void {
        this.rateLimiter.configurePort(port, undefined);
    }

    public admit(scope: AdmissionScope, remoteAddress: string | undefined, now: number = Date.now()): AdmissionDecision {
        if (remoteAddress === undefined) return ADMIT;
        const ip = normalizeRemoteAddress(remoteAddress);

        const refused = this.refusedAddress(scope, ip, now);
        if (refused) return refused;

        const geoDecision = this.geo.decide(ip, scope);
        if (!geoDecision.allowed) {
            this.recordDenial(scope, ip, geoDecision.reason, now);
            return geoDecision;
        }

        if (scope.kind === 'tunnel') {
            // 차단 중인지는 refusedAddress 가 이미 봤다. 여기서는 세기만 한다.
            const decision = this.rateLimiter.count(scope.port, ip, now);
            if (!decision.allowed) {
                this.recordDenial(scope, ip, decision.reason, now);
                return decision;
            }
        }

        // 5 단계: 그룹 동시 연결 상한(#123 U5-08). 거절은 Bound 전이라 세션 수에 들어가지 않는다.
        if (scope.kind === 'tunnel' && this._concurrency) {
            const {decision, denial} = this._concurrency.decide(scope.port);
            if (!decision.allowed) {
                this.recordDenial(scope, ip, decision.reason, now);
                if (denial && this._concurrencyAuditGate.allow(`${scope.port}|${denial.groupId}`, now)) {
                    this._onConcurrencyDenied?.(scope.port, denial, now);
                }
                return decision;
            }
        }

        return ADMIT;
    }

    /**
     * #287 TLS 외부 포트가 핸드셰이크 전에 부르는 판정. 이미 거절하기로 정해진 주소(차단 목록, 레이트 리밋 차단 중)만 거절한다.
     * 국가 조회·레이트 리밋 계수·동시 연결 상한은 핸드셰이크 뒤의 admit 이 한다.
     */
    public admitBeforeHandshake(scope: AdmissionScope, remoteAddress: string | undefined, now: number = Date.now()): AdmissionDecision {
        if (remoteAddress === undefined) return ADMIT;
        return this.refusedAddress(scope, normalizeRemoteAddress(remoteAddress), now) ?? ADMIT;
    }

    /**
     * 이미 거절하기로 정해진 터널 연결이면 그 거절을 거절 집계에 남기고 돌려준다. 관리 화면에는 적용하지 않는다.
     * 차단 목록(#286)을 먼저 본다. 그러면 국가 조회와 레이트 리밋 카운터를 쓰기 전에 거절한다.
     */
    private refusedAddress(scope: AdmissionScope, ip: string, now: number): AdmissionDenial | undefined {
        if (scope.kind !== 'tunnel') return undefined;
        const denial = this.blocklist.isBlocked(scope.port, ip) ? IP_BLOCKLIST_DENY : this.rateLimiter.banned(scope.port, ip, now);
        if (denial) this.recordDenial(scope, ip, denial.reason, now);
        return denial;
    }

    private recordDenial(scope: AdmissionScope, ip: string, reason: AdmissionReason, now: number): void {
        const key: DenialScope = scope.kind === 'admin' ? 'admin' : scope.port;
        this._tally.add(key, reason);
        this._recent.add({at: now, ip, scope: key, reason});
        this._fileLog?.record(key, ip, reason, now);
        this.denialLog.record(scope, reason, now);
    }

    /** #327 REQ-4: 최근 거절, 최신 순. */
    public recentDenials(): RecentDenial[] {
        return this._recent.list();
    }

    public denials(scope: DenialScope): {geo: number; rateLimit: number} {
        const counts = this._tally.counts(scope);
        return {geo: counts['geo-deny'], rateLimit: counts['rate-limit-ban'] + counts['rate-limit-exceeded']};
    }

    // 계수기만 읽는 순수 집계다. GeoFilter 설정은 싣지 않는다(#120 이 응답에서 합친다).
    // #327: 거절이 있었던 포트와 레이트 리밋이 켜진 포트를 모두 싣는다. 건수는 누적값이다.
    // 관리 화면 범위에서는 국가 차단만 생기므로 admin 에는 rejectedGeo 만 둔다.
    public snapshot(): {ports: Record<string, PortDenialStats>; admin: {rejectedGeo: number}} {
        const ports: Record<string, PortDenialStats> = {};
        for (const port of new Set([...this.rateLimiter.ports(), ...this._tally.ports()])) {
            const counts = this._tally.counts(port);
            ports[String(port)] = {
                rejectedGeo: counts['geo-deny'],
                rejectedBlocklist: counts['ip-blocklist'],
                rejectedBans: counts['rate-limit-ban'],
                rejectedExceeded: counts['rate-limit-exceeded'],
                rejectedConcurrency: counts['concurrency-limit'],
                bannedIps: this.rateLimiter.stats(port).bannedIps
            };
        }
        return {ports, admin: {rejectedGeo: this._tally.counts('admin')['geo-deny']}};
    }
}
