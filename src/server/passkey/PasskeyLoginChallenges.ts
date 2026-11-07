import * as crypto from "crypto";
import {ClockRngProvider} from "../../util/ClockRng";

// #336 REQ-8·REQ-9 — 패스키 로그인 challenge. 발급은 상태를 남기지 않는다(HMAC 으로 범위를 묶는다).
// 그래서 인증 없는 옵션 요청이 메모리를 채우거나 다른 사용자의 challenge 를 밀어낼 수 없다.
// 한 번만 쓰게 하려고 HMAC·만료 검사를 통과한 값의 난수만 만료까지 사용 목록에 둔다.

/** challenge 를 묶는 요청 범위. 셋 중 하나라도 다르면 맞지 않는다. */
export type ChallengeScope = {origin: string; rpId: string; ip: string};
export type ChallengeUse = 'ok' | 'invalid' | 'busy';

const NONCE_BYTES = 16;
const EXPIRY_BYTES = 8;
const MAC_BYTES = 32;
const CHALLENGE_BYTES = NONCE_BYTES + EXPIRY_BYTES + MAC_BYTES;

export class PasskeyLoginChallenges {
    /** 브라우저 timeout(120초)보다 30초 길다. 끝 무렵에 마친 사용자가 만료로 실패하지 않게 한다. */
    public static readonly TTL_MS = 150_000;
    public static readonly MAX_USED = 100_000;

    private readonly _now: () => number;
    private readonly _maxUsed: number;
    /** 프로세스마다 새로 만든다. 디스크에 쓰지 않으므로 다시 시작하면 발급한 값은 모두 무효다. */
    private readonly _key = crypto.randomBytes(32);
    /** 난수(hex) → 만료 시각. */
    private readonly _used = new Map<string, number>();

    public constructor(now: () => number, options: {maxUsed?: number} = {}) {
        this._now = now;
        this._maxUsed = options.maxUsed ?? PasskeyLoginChallenges.MAX_USED;
    }

    public get usedCount(): number {
        return this._used.size;
    }

    public issue(scope: ChallengeScope): Uint8Array<ArrayBuffer> {
        const nonce = ClockRngProvider.current().secureRandomBytes(NONCE_BYTES);
        const expiry = Buffer.alloc(EXPIRY_BYTES);
        expiry.writeBigUInt64BE(BigInt(this._now() + PasskeyLoginChallenges.TTL_MS));
        return new Uint8Array(Buffer.concat([nonce, expiry, this.mac(nonce, expiry, scope)]));
    }

    /** HMAC 과 만료만 본다. 상태를 바꾸지 않는다(라이브러리의 expectedChallenge 로도 쓴다). */
    public matches(challenge: string, scope: ChallengeScope): boolean {
        return this.parse(challenge, scope) !== undefined;
    }

    /** 맞는 challenge 를 한 번만 받는다. 사용 목록이 상한이면 busy 이고 그 값은 쓰지 않은 채로 남는다. */
    public consume(challenge: string, scope: ChallengeScope): ChallengeUse {
        const parsed = this.parse(challenge, scope);
        if(parsed === undefined || this._used.has(parsed.nonce)) return 'invalid';
        if(this._used.size >= this._maxUsed) return 'busy';
        this._used.set(parsed.nonce, parsed.expiresAt);
        return 'ok';
    }

    public sweep(): void {
        const now = this._now();
        for(const [nonce, expiresAt] of this._used) {
            if(expiresAt <= now) this._used.delete(nonce);
        }
    }

    private parse(challenge: string, scope: ChallengeScope): {nonce: string; expiresAt: number} | undefined {
        const bytes = Buffer.from(challenge, 'base64url');
        // Buffer.from 은 base64url 이 아닌 글자를 건너뛴다. 다시 인코딩해 원문과 같은 값만 받는다.
        if(bytes.length !== CHALLENGE_BYTES || bytes.toString('base64url') !== challenge) return undefined;
        const nonce = bytes.subarray(0, NONCE_BYTES);
        const expiry = bytes.subarray(NONCE_BYTES, NONCE_BYTES + EXPIRY_BYTES);
        const mac = bytes.subarray(NONCE_BYTES + EXPIRY_BYTES);
        if(!crypto.timingSafeEqual(mac, this.mac(nonce, expiry, scope))) return undefined;
        const expiresAt = Number(expiry.readBigUInt64BE());
        return expiresAt > this._now() ? {nonce: nonce.toString('hex'), expiresAt} : undefined;
    }

    /** 입력은 \0 으로 나눈다. 요청 헤더 값에는 NUL 이 올 수 없으므로 필드 경계가 모호하지 않다. */
    private mac(nonce: Buffer, expiry: Buffer, scope: ChallengeScope): Buffer {
        return crypto.createHmac('sha256', this._key)
            .update(Buffer.concat([nonce, expiry]))
            .update(`\0${scope.origin}\0${scope.rpId}\0${scope.ip}`)
            .digest();
    }
}
