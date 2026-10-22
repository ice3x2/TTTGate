import {deriveEnrollmentKeys, EnrollmentKeys, generateEnrollmentCode} from "../commons/Enrollment";
import {rateLimitBucketOf} from "./security/ConnectionRateLimiter";

/**
 * 발급한 등록 코드(#212 REQ-4·REQ-7). 코드 원문은 저장하지 않고 유도한 조회값과 봉인 키만 메모리에 둔다.
 * 서버를 다시 시작하면 발급한 코드는 모두 사라진다(새로 발급한다).
 */
const DEFAULT_ENROLLMENT_TTL_MS = 15 * 60_000;
const MIN_ENROLLMENT_TTL_MS = 60_000;
const MAX_ENROLLMENT_TTL_MS = 24 * 3600_000;
const MAX_ENROLLMENT_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
/** 실패를 기록하는 주소 묶음 수의 상한. 넘으면 가장 오래된 기록부터 버린다(인증 전 요청으로 메모리를 늘리지 못하게). */
const MAX_TRACKED_FAILURE_BUCKETS = 10_000;

type PendingEnrollment = {clientId: string, keys: EnrollmentKeys, expiresAt: number};
type TakeResult = {ok: true, clientId: string, keys: EnrollmentKeys} | {ok: false, reason: "rejected" | "throttled"};

class EnrollmentRegistry {
    private readonly _pending = new Map<string, PendingEnrollment>();
    private readonly _failures = new Map<string, {count: number, since: number}>();

    constructor(private readonly _now: () => number = Date.now) {}

    /** 코드를 발급한다. 같은 클라이언트의 이전 코드는 무효가 된다. ttl 은 1분~24시간으로 맞춘다. */
    public async issue(clientId: string, ttlMs: number = DEFAULT_ENROLLMENT_TTL_MS): Promise<{code: string, expiresAt: number}> {
        const code = generateEnrollmentCode();
        const keys = await deriveEnrollmentKeys(code);
        this.revokeClient(clientId);
        const lifetime = Math.min(MAX_ENROLLMENT_TTL_MS, Math.max(MIN_ENROLLMENT_TTL_MS, Math.floor(ttlMs)));
        const expiresAt = this._now() + lifetime;
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
        if(!pending || pending.expiresAt <= now) {
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
        for(const [lookup, pending] of this._pending) {
            if(pending.clientId === clientId) this._pending.delete(lookup);
        }
    }

    /** 발급한 코드를 모두 무효로 한다(#221 — 제어 포트의 TLS·모드가 바뀔 때). 실패 기록은 둔다. */
    public revokeAll(): void {
        this._pending.clear();
    }

    public clear(): void {
        this._pending.clear();
        this._failures.clear();
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
            if(pending.expiresAt <= now) this._pending.delete(lookup);
        }
    }
}

export {EnrollmentRegistry, DEFAULT_ENROLLMENT_TTL_MS, MAX_ENROLLMENT_TTL_MS, MAX_ENROLLMENT_FAILURES};
