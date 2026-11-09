// #336 REQ-4·REQ-5 — 패스키 등록 대기 값(메모리). 사용자마다 하나이고, 다시 요청하면 새 값으로 바꾼다.
// 항목은 불변 객체이고 갱신은 새 객체로 교체한다(잠금 없음). 만료 항목은 AdminServer 의 정리 타이머가 지운다.

export type PendingPasskeyRegistration = {challenge: string; origin: string; rpId: string; expiresAt: number};

export class PendingPasskeyRegistrations {
    public static readonly TTL_MS = 300_000;

    private readonly _now: () => number;
    private readonly _pending = new Map<string, PendingPasskeyRegistration>();

    public constructor(now: () => number) {
        this._now = now;
    }

    public set(userId: string, value: Omit<PendingPasskeyRegistration, 'expiresAt'>): void {
        this._pending.set(userId, Object.freeze({...value, expiresAt: this._now() + PendingPasskeyRegistrations.TTL_MS}));
    }

    /** 없거나 만료되었으면 undefined 다. 만료된 값은 지운다. */
    public peek(userId: string): PendingPasskeyRegistration | undefined {
        const found = this._pending.get(userId);
        if(found === undefined) return undefined;
        if(found.expiresAt <= this._now()) {
            this._pending.delete(userId);
            return undefined;
        }
        return found;
    }

    public consume(userId: string): void {
        this._pending.delete(userId);
    }

    public sweep(): void {
        const now = this._now();
        for(const [key, value] of this._pending) {
            if(value.expiresAt <= now) this._pending.delete(key);
        }
    }
}
