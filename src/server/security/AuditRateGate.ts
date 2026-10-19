// U5-08 / #123 — 키별 간격 게이트. 거절마다 감사를 남기지 않고 포트·그룹별 1분 1회만 통과시킨다. 시계는 인자로 받는다.

export class AuditRateGate {
    private readonly _intervalMs: number;
    private readonly _lastPassed = new Map<string, number>();

    public constructor(intervalMs: number = 60_000) {
        this._intervalMs = intervalMs;
    }

    /** 마지막 통과로부터 intervalMs 이상 지났으면 이번 시각을 기록하고 true 다. */
    public allow(key: string, now: number): boolean {
        const last = this._lastPassed.get(key);
        if(last !== undefined && now - last < this._intervalMs) return false;
        this._lastPassed.set(key, now);
        return true;
    }

    /** 마지막 통과가 now - intervalMs 이전인 키를 지운다. 판정은 바뀌지 않고 메모리만 돌려준다. */
    public prune(now: number): void {
        const expired: string[] = [];
        for(const [key, last] of this._lastPassed) {
            if(last <= now - this._intervalMs) expired.push(key);
        }
        for(const key of expired) this._lastPassed.delete(key);
    }

    public size(): number {
        return this._lastPassed.size;
    }
}
