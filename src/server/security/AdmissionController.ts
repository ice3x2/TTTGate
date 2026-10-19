import {ADMIT, AdmissionDecision, AdmissionPolicy, AdmissionScope} from "./AdmissionPolicy";
import {ConnectionRateLimiter} from "./ConnectionRateLimiter";
import {normalizeRemoteAddress} from "./address";
import {GeoFilter} from "./GeoFilter";
import {DenialAggregator} from "./DenialAggregator";
import {ConcurrencyDenial, ConcurrencyLimiter} from "./ConcurrencyLimiter";
import {AuditRateGate} from "./AuditRateGate";
import LoggerFactory from "../../util/logger/LoggerFactory";
import {DEFAULT_GEO_CONFIG, GeoConfig} from "../../types/TunnelingOption";

export type TunnelRateLimitSource = {
    forwardPort: number;
    rateLimit?: {enabled: boolean; windowMs: number; maxConnections: number; banMs: number};
};

export const PRUNE_INTERVAL_MS = 30_000;

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
    // 거절은 건마다 로그로 남지 않는다. 30초 prune 타이머가 창이 닫힌 버킷만 한 줄로 내보낸다.
    public readonly denialLog = new DenialAggregator(line => LoggerFactory.getLogger('server', 'Admission').warn(line));
    private readonly _geoDenials = new Map<number | 'admin', number>();
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

    private dispose(): void {
        if (this._pruneTimer) clearInterval(this._pruneTimer);
        this._pruneTimer = undefined;
    }

    public configureTunnel(option: TunnelRateLimitSource): void {
        if (!this._pruneTimer) {
            this._pruneTimer = setInterval(() => {
                const now = Date.now();
                this.rateLimiter.prune(now);
                this.denialLog.flushDue(now);
                this._concurrencyAuditGate.prune(now);
            }, PRUNE_INTERVAL_MS).unref();
        }

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
        this._geoDenials.delete(port);
    }

    public admit(scope: AdmissionScope, remoteAddress: string | undefined, now: number = Date.now()): AdmissionDecision {
        if (remoteAddress === undefined) return ADMIT;
        const ip = normalizeRemoteAddress(remoteAddress);

        if (scope.kind === 'tunnel') {
            const banDecision = this.rateLimiter.banned(scope.port, ip, now);
            if (banDecision) {
                this.denialLog.record(scope, banDecision.reason, now);
                return banDecision;
            }
        }

        const geoDecision = this.geo.decide(ip, scope);
        if (!geoDecision.allowed) {
            const key = scope.kind === 'admin' ? 'admin' : scope.port;
            this._geoDenials.set(key, (this._geoDenials.get(key) ?? 0) + 1);
            this.denialLog.record(scope, geoDecision.reason, now);
            return geoDecision;
        }

        if (scope.kind === 'tunnel') {
            const decision = this.rateLimiter.admit(scope.port, ip, now);
            if (!decision.allowed) {
                this.denialLog.record(scope, decision.reason, now);
                return decision;
            }
        }

        // 5 단계: 그룹 동시 연결 상한(#123 U5-08). 거절은 Bound 전이라 세션 수에 들어가지 않는다.
        if (scope.kind === 'tunnel' && this._concurrency) {
            const {decision, denial} = this._concurrency.decide(scope.port);
            if (!decision.allowed) {
                this.denialLog.record(scope, decision.reason, now);
                if (denial && this._concurrencyAuditGate.allow(`${scope.port}|${denial.groupId}`, now)) {
                    this._onConcurrencyDenied?.(scope.port, denial, now);
                }
                return decision;
            }
        }

        return ADMIT;
    }

    public denials(scope: number | 'admin'): {geo: number; rateLimit: number} {
        const geo = this._geoDenials.get(scope) ?? 0;
        if (scope === 'admin') return {geo, rateLimit: 0};

        const stats = this.rateLimiter.stats(scope);
        return {geo, rateLimit: stats.rejectedBans + stats.rejectedExceeded};
    }

    // 계수기만 읽는 순수 집계다. GeoFilter 설정은 싣지 않는다(#120 이 응답에서 합친다).
    // 관리자 포트는 터널 포트가 아니어서 ports 에 자리가 없으므로 admin 으로 따로 둔다.
    public snapshot(): {ports: Record<string, {rejectedBans: number; rejectedExceeded: number; rejectedGeo: number; bannedIps: number}>; admin: {rejectedGeo: number}} {
        const ports: Record<string, {rejectedBans: number; rejectedExceeded: number; rejectedGeo: number; bannedIps: number}> = {};
        for (const port of this.rateLimiter.ports()) {
            const stats = this.rateLimiter.stats(port);
            ports[String(port)] = {
                rejectedBans: stats.rejectedBans,
                rejectedExceeded: stats.rejectedExceeded,
                rejectedGeo: this.denials(port).geo,
                bannedIps: stats.bannedIps
            };
        }
        return {ports, admin: {rejectedGeo: this.denials('admin').geo}};
    }
}
