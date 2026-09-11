/**
 * RFC 4226 HOTP / RFC 6238 TOTP(HMAC-SHA1, 30초, 6자리, ±1 스텝, 재사용 거부) 및
 * 복구 코드(생성·정규화·해시). #111 (U4-03) — 외부 의존성 없이 Node `crypto` 만 사용한다.
 *
 * 이 모듈은 예외를 제어 흐름으로 쓰지 않는다: 형식 오류·불일치·재사용은 모두 반환값으로 알린다.
 * 시간은 항상 인자로 받으며, 이 모듈 안에서 `Date.now()` 나 `ClockRngProvider` 를 읽지 않는다.
 */
import * as crypto from "crypto";
import { timingSafeStringEqual } from "../../util/timingSafeStringEqual";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;
export const TOTP_SECRET_BYTES = 20;

export const generateSecret = (): Buffer => crypto.randomBytes(TOTP_SECRET_BYTES);

export const stepOf = (nowMs: number): number => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

/** RFC 4226 §5.3 HMAC-SHA1 동적 절단. */
export const hotp = (secret: Buffer, counter: number): string => {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));
    const mac = crypto.createHmac("sha1", secret).update(msg).digest();
    const offset = mac[19] & 0x0f;
    const bin =
        ((mac[offset] & 0x7f) << 24) |
        ((mac[offset + 1] & 0xff) << 16) |
        ((mac[offset + 2] & 0xff) << 8) |
        (mac[offset + 3] & 0xff);
    return String(bin % 1_000_000).padStart(TOTP_DIGITS, "0");
};

export const generate = (secret: Buffer, nowMs: number): string => hotp(secret, stepOf(nowMs));

export type VerifyResult = { ok: true; step: number } | { ok: false; reason: "format" | "mismatch" | "replayed" };

/**
 * `code` 를 `nowMs` 기준 ±1 스텝 범위에서 검증한다. 세 스텝 모두 계산한 뒤(조기 return 없이)
 * 일치 여부를 판단하고, 일치한 스텝이 `lastUsedStep` 이하이면 재사용으로 거부한다.
 */
export const verify = (secret: Buffer, code: string, nowMs: number, lastUsedStep: number): VerifyResult => {
    if (!/^\d{6}$/.test(code)) {
        return { ok: false, reason: "format" };
    }

    const step = stepOf(nowMs);
    let matchedStep: number | undefined;
    for (const candidate of [step - 1, step, step + 1]) {
        if (timingSafeStringEqual(hotp(secret, candidate), code, "utf8")) {
            matchedStep = candidate;
        }
    }

    if (matchedStep === undefined) {
        return { ok: false, reason: "mismatch" };
    }
    if (matchedStep <= lastUsedStep) {
        return { ok: false, reason: "replayed" };
    }
    return { ok: true, step: matchedStep };
};

export const otpauthUri = (username: string, secretBase32: string): string =>
    `otpauth://totp/TTTGate:${encodeURIComponent(username)}?secret=${secretBase32}&issuer=TTTGate&algorithm=SHA1&digits=6&period=30`;

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

const randomRecoveryCode = (): string => {
    let code = "";
    for (let i = 0; i < 8; i++) {
        if (i === 4) {
            code += "-";
        }
        code += RECOVERY_CODE_ALPHABET[crypto.randomInt(RECOVERY_CODE_ALPHABET.length)];
    }
    return code;
};

/** 서로 다른 10개의 'xxxx-xxxx' 복구 코드를 만든다. */
export const generateRecoveryCodes = (): string[] => {
    const codes = new Set<string>();
    while (codes.size < RECOVERY_CODE_COUNT) {
        codes.add(randomRecoveryCode());
    }
    return Array.from(codes);
};

export const hashRecoveryCode = (code: string, userId: string): string =>
    crypto.createHash("sha256").update(code + userId).digest("hex");

/** 소문자화·공백 제거 후 'xxxxxxxx' 는 'xxxx-xxxx' 로 정규화한다. 형식 밖이면 undefined. */
export const normalizeRecoveryCode = (input: string): string | undefined => {
    const cleaned = input.toLowerCase().replace(/\s/g, "");
    if (/^[a-z0-9]{8}$/.test(cleaned)) {
        return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
    }
    if (/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(cleaned)) {
        return cleaned;
    }
    return undefined;
};

/** 배열 전체를 순회하며 timingSafeStringEqual 로 비교해 처음 일치한 인덱스를 돌려준다. */
export const findRecoveryCodeHash = (hashes: readonly string[], hash: string): number => {
    let found = -1;
    for (let i = 0; i < hashes.length; i++) {
        if (found === -1 && timingSafeStringEqual(hashes[i], hash, "hex")) {
            found = i;
        }
    }
    return found;
};
