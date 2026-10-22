import * as crypto from "crypto";

type ClockRng = {
    now(): number;
    random(): number;
    /**
     * 보안 난수(토큰/시크릿/세션ID 등) 경로 전용.
     * 지터용 `random()`과 분리하여 의도치 않은 `Math.random` 사용을 방지한다.
     * 내부적으로 `crypto.randomBytes(n)`에 위임 — 편향 없는 CSPRNG.
     *
     * 주의: 동기 CSPRNG이므로 이벤트 루프를 블록할 수 있다. 본 API는
     *       토큰/세션ID/키 등 **작은 크기(≤1024 바이트)** 호출을 가정한다.
     *       대량/대형 요청이 필요하다면 비동기 `crypto.randomBytes(n, cb)`
     *       를 직접 사용하라. 구현은 `n > 1024`일 때 `RangeError`를 throw한다.
     */
    secureRandomBytes(n: number): Buffer;
}

/**
 * 보안 난수 1회 호출 최대 바이트 수.
 * 이벤트 루프 블록을 방지하기 위한 상한.
 */
const SECURE_RANDOM_BYTES_MAX = 1024;

class DefaultClockRngImpl implements ClockRng {
    now(): number {
        return Date.now();
    }
    random(): number {
        return Math.random();
    }
    secureRandomBytes(n: number): Buffer {
        if (!Number.isInteger(n) || n <= 0) {
            throw new RangeError(`secureRandomBytes: n must be a positive integer, got ${n}`);
        }
        if (n > SECURE_RANDOM_BYTES_MAX) {
            throw new RangeError(
                `secureRandomBytes: n exceeds max ${SECURE_RANDOM_BYTES_MAX} (got ${n}). ` +
                `동기 CSPRNG 대량 호출은 이벤트 루프를 블록할 수 있다. ` +
                `대량 요청은 비동기 crypto.randomBytes(n, cb)를 사용하라.`
            );
        }
        return crypto.randomBytes(n);
    }
}

const DefaultClockRng: ClockRng = new DefaultClockRngImpl();

let activeClockRng: ClockRng = DefaultClockRng;

/**
 * configure 입력 shape 검증 — 필수 메서드가 없으면 TypeError.
 */
function validateClockRngShape(rng: ClockRng): void {
    if (rng === null || typeof rng !== "object") {
        throw new TypeError("ClockRngProvider.configure: rng must be an object");
    }
    if (typeof rng.now !== "function") {
        throw new TypeError("ClockRngProvider.configure: rng.now must be a function");
    }
    if (typeof rng.random !== "function") {
        throw new TypeError("ClockRngProvider.configure: rng.random must be a function");
    }
    if (typeof rng.secureRandomBytes !== "function") {
        throw new TypeError(
            "ClockRngProvider.configure: rng.secureRandomBytes must be a function"
        );
    }
}

const ClockRngProvider = {
    current(): ClockRng {
        return activeClockRng;
    },
    configure(clockRng: ClockRng): void {
        validateClockRngShape(clockRng);
        activeClockRng = clockRng;
    },
    reset(): void {
        activeClockRng = DefaultClockRng;
    }
};

export { ClockRng, ClockRngProvider, DefaultClockRng, SECURE_RANDOM_BYTES_MAX };
