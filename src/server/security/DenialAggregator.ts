import {AdmissionReason, AdmissionScope} from "./AdmissionPolicy";

export const DENIAL_LOG_WINDOW_MS = 60_000;

type DenialBucket = {scopeLabel: string; reason: AdmissionReason; count: number; windowStart: number};

/**
 * 거절을 건마다 기록하지 않고 (포트·사유) 별로 한 창(기본 1분)에 한 줄로 묶는다.
 * 시각은 항상 인자로 받는다 — 이 클래스는 시계를 읽지 않는다.
 */
export class DenialAggregator {
    private readonly _buckets = new Map<string, DenialBucket>();

    constructor(private readonly _sink: (line: string) => void,
                private readonly _windowMs: number = DENIAL_LOG_WINDOW_MS) {
    }

    public record(scope: AdmissionScope, reason: AdmissionReason, now: number): void {
        const scopeLabel = scope.kind === 'admin' ? 'admin' : String(scope.port);
        const key = `${scopeLabel}|${reason}`;
        const bucket = this._buckets.get(key);
        if (bucket) {
            bucket.count++;
            return;
        }
        this._buckets.set(key, {scopeLabel, reason, count: 1, windowStart: now});
    }

    /** 창이 닫힌 버킷만 내보낸다. 내보낸 줄 수를 돌려준다. */
    public flushDue(now: number): number {
        return this.flush(bucket => bucket.windowStart + this._windowMs <= now);
    }

    /** 창이 닫혔는지와 무관하게 모든 버킷을 내보낸다. now 는 호출 형태를 flushDue 와 맞추기 위한 자리다. */
    public flushAll(now: number): number {
        void now;
        return this.flush(() => true);
    }

    public pending(): number {
        return this._buckets.size;
    }

    private flush(isDue: (bucket: DenialBucket) => boolean): number {
        const flushed: DenialBucket[] = [];
        for (const [key, bucket] of this._buckets) {
            if (!isDue(bucket)) continue;
            // 버킷을 먼저 지우고 나서 sink 를 부른다. sink 가 던져도 같은 줄이 두 번 쌓이지 않는다.
            this._buckets.delete(key);
            flushed.push(bucket);
        }

        const seconds = Math.round(this._windowMs / 1000);
        for (const bucket of flushed) {
            try {
                this._sink(`admission denied port=${bucket.scopeLabel} reason=${bucket.reason} count=${bucket.count} (last ${seconds}s)`);
            } catch {
                // 로그 출력 실패가 판정 경로를 멈추게 하지 않는다. 재시도하지 않는다.
            }
        }
        return flushed.length;
    }
}
