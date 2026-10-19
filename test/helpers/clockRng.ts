import * as crypto from "crypto";
import {ClockRng} from "../../src/util/ClockRng";

type FakeClockRng = ClockRng & {
    advance(ms: number): void;
    setRandomValues(values: number[]): void;
}

const createFakeClockRng = (initialNow: number = 1_700_000_000_000, initialRandomValues: number[] = [0.5]): FakeClockRng => {
    let now = initialNow;
    let randomValues = initialRandomValues.length > 0 ? [...initialRandomValues] : [0.5];

    return {
        now(): number {
            return now;
        },
        random(): number {
            if(randomValues.length > 1) {
                return randomValues.shift()!;
            }
            return randomValues[0] ?? 0.5;
        },
        /**
         * @deprecated for security paths — this fake delegates to the real
         * `crypto.randomBytes` CSPRNG. 보안 경로(토큰 발급·키 생성 등)의
         * 결정론적 검증이 필요한 테스트에서 사용하면 오히려 검증을 누수시킬 수
         * 있다. 해당 테스트는 주입 가능한 전용 구현(e.g. `setSecureBytesValues`)
         * 을 도입해 사용하라. 본 메서드는 clock/random만 결정화하면 되는
         * 비보안 경로 테스트용이다.
         */
        secureRandomBytes(n: number): Buffer {
            return crypto.randomBytes(n);
        },
        advance(ms: number): void {
            now += ms;
        },
        setRandomValues(values: number[]): void {
            randomValues = values.length > 0 ? [...values] : [0.5];
        }
    };
};

export { createFakeClockRng, FakeClockRng };
