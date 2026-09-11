import {ADMIT, AdmissionDecision, AdmissionPolicy, AdmissionScope} from "./AdmissionPolicy";
import {ConnectionRateLimiter} from "./ConnectionRateLimiter";
import {normalizeRemoteAddress} from "./address";

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
    private readonly _geoDenials = new Map<number | 'admin', number>();
    private _concurrencyProvider: ((port: number) => number) | undefined;
    private _pruneTimer: NodeJS.Timeout | undefined;

    private dispose(): void {
        if (this._pruneTimer) clearInterval(this._pruneTimer);
        this._pruneTimer = undefined;
    }

    public configureTunnel(option: TunnelRateLimitSource): void {
        if (!this._pruneTimer) {
            this._pruneTimer = setInterval(() => this.rateLimiter.prune(Date.now()), PRUNE_INTERVAL_MS).unref();
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
            if (banDecision) return banDecision;
        }

        // geo 판정 자리 — #118 (U5-03) 이 여기에 삽입한다.

        if (scope.kind === 'tunnel') {
            const decision = this.rateLimiter.admit(scope.port, ip, now);
            if (!decision.allowed) return decision;
        }

        // 동시 연결 상한 자리 — #123 (U5-08) 이 여기에 삽입한다.

        return ADMIT;
    }

    public denials(scope: number | 'admin'): {geo: number; rateLimit: number} {
        const geo = this._geoDenials.get(scope) ?? 0;
        if (scope === 'admin') return {geo, rateLimit: 0};

        const stats = this.rateLimiter.stats(scope);
        return {geo, rateLimit: stats.rejectedBans + stats.rejectedExceeded};
    }
}
