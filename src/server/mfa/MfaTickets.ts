import {ClockRngProvider} from "../../util/ClockRng";

// U4-04 / #112 — MFA 의 메모리 저장소 두 개. PendingEnrollmentStore 는 이 이슈의 enroll·confirm 이,
// MfaTicketStore 는 U4-08 의 2단계 로그인이 쓴다. 항목은 불변 객체이고 갱신은 새 객체로 교체한다(잠금 없음).
// 티켓 문자열은 Map 키로만 찾는다(문자열 비교를 하지 않는다).

export type MfaTicket = {userId: string; ip: string; expiresAt: number; attempts: number};

export class MfaTicketStore {
    public static readonly TTL_MS = 120_000;
    public static readonly MAX_ATTEMPTS = 5;

    private readonly _now: () => number;
    private readonly _tickets = new Map<string, MfaTicket>();

    public constructor(now: () => number) {
        this._now = now;
    }

    public get size(): number {
        return this._tickets.size;
    }

    /** 32바이트 hex 티켓을 발급한다. 같은 사용자의 기존 티켓은 지운다. */
    public issue(userId: string, ip: string): string {
        for(const [key, value] of this._tickets) {
            if(value.userId === userId) this._tickets.delete(key);
        }
        const ticket = ClockRngProvider.current().secureRandomBytes(32).toString('hex');
        this._tickets.set(ticket, Object.freeze({userId, ip, expiresAt: this._now() + MfaTicketStore.TTL_MS, attempts: 0}));
        return ticket;
    }

    /** 없거나 만료되었거나 IP 가 다르면 undefined 다. 만료·불일치 티켓은 지운다. 유효한 티켓은 남긴다. */
    public peek(ticket: string, ip: string): MfaTicket | undefined {
        const found = this._tickets.get(ticket);
        if(found === undefined) return undefined;
        if(found.expiresAt <= this._now() || found.ip !== ip) {
            this._tickets.delete(ticket);
            return undefined;
        }
        return found;
    }

    /** 시도 횟수를 하나 올린 새 항목으로 바꾸고 그 값을 돌려준다. 상한에 이르면 지운다. 없는 티켓은 0. */
    public fail(ticket: string): number {
        const found = this._tickets.get(ticket);
        if(found === undefined) return 0;
        const attempts = found.attempts + 1;
        if(attempts >= MfaTicketStore.MAX_ATTEMPTS) this._tickets.delete(ticket);
        else this._tickets.set(ticket, Object.freeze({...found, attempts}));
        return attempts;
    }

    public consume(ticket: string): void {
        this._tickets.delete(ticket);
    }

    public sweep(): void {
        const now = this._now();
        for(const [key, value] of this._tickets) {
            if(value.expiresAt <= now) this._tickets.delete(key);
        }
    }
}

export type PendingEnrollment = {secret: Buffer; recoveryCodes: string[]; expiresAt: number; attempts: number};

export class PendingEnrollmentStore {
    public static readonly TTL_MS = 300_000;
    public static readonly MAX_ATTEMPTS = 5;

    private readonly _now: () => number;
    private readonly _pending = new Map<string, PendingEnrollment>();

    public constructor(now: () => number) {
        this._now = now;
    }

    public get size(): number {
        return this._pending.size;
    }

    /** 사용자의 대기 항목을 새로 둔다. 시도 횟수와 만료는 처음부터 다시 센다. */
    public set(userId: string, pending: Omit<PendingEnrollment, 'expiresAt' | 'attempts'>): void {
        this._pending.set(userId, Object.freeze({
            secret: pending.secret, recoveryCodes: [...pending.recoveryCodes],
            expiresAt: this._now() + PendingEnrollmentStore.TTL_MS, attempts: 0
        }));
    }

    public peek(userId: string): PendingEnrollment | undefined {
        const found = this._pending.get(userId);
        if(found === undefined) return undefined;
        if(found.expiresAt <= this._now()) {
            this._pending.delete(userId);
            return undefined;
        }
        return found;
    }

    public fail(userId: string): number {
        const found = this._pending.get(userId);
        if(found === undefined) return 0;
        const attempts = found.attempts + 1;
        if(attempts >= PendingEnrollmentStore.MAX_ATTEMPTS) this._pending.delete(userId);
        else this._pending.set(userId, Object.freeze({...found, attempts}));
        return attempts;
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
