// U5-09 / #124 — PRD 속성 11 대역폭 프리셋. 일반 유저 그룹 하나가 양방향 전송에 토큰 버킷 하나를 공유한다.
// 타이머 없이 호출 시점에 보충량을 계산하고, 시계는 인자로만 받는다.

export type BandwidthPreset = 'unlimited' | '1MB/s' | '10MB/s' | '100MB/s';

export const PRESET_BYTES_PER_SECOND: Readonly<Record<BandwidthPreset, number>> =
    Object.freeze({unlimited: 0, '1MB/s': 1_048_576, '10MB/s': 10_485_760, '100MB/s': 104_857_600});

export const REFILL_INTERVAL_MS = 100;

type Bucket = {capacity: number; tokens: number; updatedAt: number};

export class BandwidthLimiter {
    private readonly _buckets = new Map<string, Bucket>();

    /**
     * bytes 를 쓰고 기다릴 시간(ms)을 돌려준다. 0 이면 바로 보낸다. 토큰은 음수가 될 수 있다(빚).
     * bytesPerSecond <= 0 이면 버킷을 만들지도 지우지도 않고 0 이다. 용량이 바뀌면 빈 새 버킷으로 시작한다.
     */
    public consume(groupId: string, bytesPerSecond: number, bytes: number, now: number): number {
        if(!(bytesPerSecond > 0)) return 0;
        let bucket = this._buckets.get(groupId);
        if(bucket === undefined || bucket.capacity !== bytesPerSecond) {
            bucket = {capacity: bytesPerSecond, tokens: 0, updatedAt: now};
        } else {
            const steps = Math.floor((now - bucket.updatedAt) / REFILL_INTERVAL_MS);
            if(steps > 0) {
                bucket = {
                    capacity: bucket.capacity,
                    tokens: Math.min(bucket.capacity, bucket.tokens + steps * bucket.capacity / 10),
                    updatedAt: bucket.updatedAt + steps * REFILL_INTERVAL_MS
                };
            }
        }
        const tokens = bucket.tokens - bytes;
        this._buckets.set(groupId, {...bucket, tokens});
        return tokens >= 0 ? 0 : Math.ceil(-tokens / bucket.capacity * 1000);
    }

    public release(groupId: string): void {
        this._buckets.delete(groupId);
    }

    /** 테스트 읽기용. */
    public bucket(groupId: string): {capacity: number; tokens: number; updatedAt: number} | undefined {
        const found = this._buckets.get(groupId);
        return found ? {...found} : undefined;
    }
}
