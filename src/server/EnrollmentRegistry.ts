import {deriveEnrollmentKeys, EnrollmentKeys, generateEnrollmentCode} from "../commons/Enrollment";
import {rateLimitBucketOf} from "./security/ConnectionRateLimiter";

/**
 * 발급한 등록 코드(#212 REQ-4·REQ-7). 코드 원문은 저장하지 않고 유도한 조회값과 봉인 키만 메모리에 둔다.
 * 서버를 다시 시작하면 발급한 코드는 모두 사라진다(새로 발급한다).
 */
const DEFAULT_ENROLLMENT_TTL_MS = 15 * 60_000;
const MIN_ENROLLMENT_TTL_MS = 60_000;
const MAX_ENROLLMENT_TTL_MS = 30 * 24 * 3600_000;
const MAX_ENROLLMENT_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
/** 실패를 기록하는 주소 묶음 수의 상한. 넘으면 가장 오래된 기록부터 버린다(인증 전 요청으로 메모리를 늘리지 못하게). */
const MAX_TRACKED_FAILURE_BUCKETS = 10_000;

/** expiresAt 이 null 이면 만료 없음이다(#313). 쓰이거나, 새로 발급하거나, 지우거나, 서버를 다시 시작할 때까지 유효하다. */
type PendingEnrollment = {clientId: string, keys: EnrollmentKeys, expiresAt: number | null};
type TakeResult = {ok: true, clientId: string, keys: EnrollmentKeys} | {ok: false, reason: "rejected" | "throttled"};

const isExpired = (pending: PendingEnrollment, now: number): boolean => pending.expiresAt !== null && pending.expiresAt <= now;

class EnrollmentRegistry {
    private readonly _pending = new Map<string, PendingEnrollment>();
    private readonly _failures = new Map<string, {count: number, since: number}>();
    /**
     * 클라이언트별 발급 세대(#313). 키 파생은 비동기라 발급이 겹치면 끝나는 순서가 바뀐다. 발급을 시작할 때와
     * 무효화할 때 세대를 올리고, 파생이 끝났을 때 세대가 바뀌었으면 코드를 남기지 않는다. 가장 나중에 시작한 발급만 남는다.
     */
    private readonly _generations = new Map<string, number>();
    private _globalGeneration = 0;

    constructor(private readonly _now: () => number = Date.now,
                private readonly _derive: (code: string) => Promise<EnrollmentKeys> = deriveEnrollmentKeys) {}

    /**
     * 코드를 발급한다. 같은 클라이언트의 이전 코드는 무효가 된다. ttl 은 1분~30일로 맞추고, null 이면 만료 없음이다(#313).
     * 파생하는 사이에 더 새 발급이나 무효화가 있었으면 아무것도 남기지 않고 null 을 돌려준다.
     */
    public async issue(clientId: string, ttlMs: number | null = DEFAULT_ENROLLMENT_TTL_MS): Promise<{code: string, expiresAt: number | null} | null> {
        const generation = this.nextGeneration(clientId);
        const globalGeneration = this._globalGeneration;
        const code = generateEnrollmentCode();
        const keys = await this._derive(code);
        if(this._generations.get(clientId) !== generation || this._globalGeneration !== globalGeneration) return null;
        this.removeClientCodes(clientId);
        const expiresAt = ttlMs === null ? null
            : this._now() + Math.min(MAX_ENROLLMENT_TTL_MS, Math.max(MIN_ENROLLMENT_TTL_MS, Math.floor(ttlMs)));
        this._pending.set(keys.lookup, {clientId, keys, expiresAt});
        return {code, expiresAt};
    }

    /** 조회값으로 코드를 소진한다. 실패 사유(없음·만료·소진)는 구분하지 않는다. */
    public take(lookup: string, remoteAddress: string): TakeResult {
        const now = this._now();
        const bucket = rateLimitBucketOf(remoteAddress || "unknown");
        this.pruneFailures(now);
        if((this._failures.get(bucket)?.count ?? 0) >= MAX_ENROLLMENT_FAILURES) return {ok: false, reason: "throttled"};

        const pending = this._pending.get(lookup);
        if(pending) this._pending.delete(lookup);
        if(!pending || isExpired(pending, now)) {
            const current = this._failures.get(bucket) ?? {count: 0, since: now};
            current.count++;
            this._failures.set(bucket, current);
            while(this._failures.size > MAX_TRACKED_FAILURE_BUCKETS) {
                this._failures.delete(this._failures.keys().next().value!);
            }
            this.pruneExpired(now);
            return {ok: false, reason: "rejected"};
        }
        return {ok: true, clientId: pending.clientId, keys: pending.keys};
    }

    public revokeClient(clientId: string): void {
        this.nextGeneration(clientId);
        this.removeClientCodes(clientId);
    }

    /** 발급한 코드를 모두 무효로 한다(#221 — 제어 포트의 TLS·모드가 바뀌거나 제어 서버를 다시 만들 때). 실패 기록은 둔다. */
    public revokeAll(): void {
        this._globalGeneration++;
        this._pending.clear();
    }

    public clear(): void {
        this._globalGeneration++;
        this._pending.clear();
        this._failures.clear();
    }

    private nextGeneration(clientId: string): number {
        const next = (this._generations.get(clientId) ?? 0) + 1;
        this._generations.set(clientId, next);
        return next;
    }

    private removeClientCodes(clientId: string): void {
        for(const [lookup, pending] of this._pending) {
            if(pending.clientId === clientId) this._pending.delete(lookup);
        }
    }

    /** 창이 지난 실패 기록을 지운다. Map 은 넣은 순서라 앞에서부터 보다가 아직 유효한 기록에서 멈춘다. */
    private pruneFailures(now: number): void {
        for(const [bucket, failures] of this._failures) {
            if(now - failures.since <= FAILURE_WINDOW_MS) break;
            this._failures.delete(bucket);
        }
    }

    private pruneExpired(now: number): void {
        for(const [lookup, pending] of this._pending) {
            if(isExpired(pending, now)) this._pending.delete(lookup);
        }
    }
}

export {EnrollmentRegistry, DEFAULT_ENROLLMENT_TTL_MS, MAX_ENROLLMENT_TTL_MS, MAX_ENROLLMENT_FAILURES};
