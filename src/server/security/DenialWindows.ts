/** 한 창 동안 같은 키의 거절을 묶은 것. 창은 그 키의 첫 거절 시각에서 시작한다. */
export type DenialWindow = {windowStart: number; count: number};

/**
 * 키별 1분(기본) 창으로 거절을 묶는다. 시각은 항상 인자로 받는다 — 이 클래스는 시계를 읽지 않는다.
 * 서버 로그의 (포트, 사유) 집계(DenialAggregator)와 거절 로그 파일의 (IP, 범위, 사유) 묶음(DenialFileLog, #327)이 함께 쓴다.
 */
export class DenialWindows<W extends DenialWindow> {
    private readonly _windows = new Map<string, W>();

    constructor(public readonly windowMs: number) {
    }

    /** 이 키의 열린 창. 없으면 undefined 다. */
    public find(key: string): W | undefined {
        return this._windows.get(key);
    }

    public open(key: string, window: W): void {
        this._windows.set(key, window);
    }

    public get size(): number {
        return this._windows.size;
    }

    /** 창이 닫힌 것을 꺼낸다. 꺼낸 것은 지운다. */
    public takeDue(now: number): W[] {
        return this.take(window => window.windowStart + this.windowMs <= now);
    }

    public takeAll(): W[] {
        return this.take(() => true);
    }

    public clear(): void {
        this._windows.clear();
    }

    private take(isDue: (window: W) => boolean): W[] {
        const taken: W[] = [];
        for (const [key, window] of this._windows) {
            if (!isDue(window)) continue;
            this._windows.delete(key);
            taken.push(window);
        }
        return taken;
    }
}
