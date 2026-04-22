import * as fs from "fs";
import * as path from "path";
import { timingSafeStringEqual } from "../../../src/util/timingSafeStringEqual";

/**
 * REQ-04 / REQ-21 — timingSafeStringEqual 헬퍼 검증.
 * NO-MOCK: 실 crypto.timingSafeEqual, 실 Buffer만 사용.
 */
describe("REQ-04 timingSafeStringEqual", () => {
    const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
    const REPORTS_DIR = path.join(REPO_ROOT, "reports");

    beforeAll(() => {
        if (!fs.existsSync(REPORTS_DIR)) {
            fs.mkdirSync(REPORTS_DIR, { recursive: true });
        }
    });

    test("case1 — 동일한 hex 문자열은 true", () => {
        const hex = "deadbeefcafebabe00112233445566778899aabbccddeeff";
        expect(timingSafeStringEqual(hex, hex)).toBe(true);
    });

    test("case2 — 내용이 다르면 false (길이 동일)", () => {
        const a = "deadbeefcafebabe00112233445566778899aabbccddeeff";
        const b = "deadbeefcafebabe00112233445566778899aabbccddee00";
        expect(timingSafeStringEqual(a, b)).toBe(false);
    });

    test("case3 — 길이가 달라도 예외 없이 false (상수시간 가드)", () => {
        const a = "aa";
        const b = "aabbcc";
        expect(timingSafeStringEqual(a, b)).toBe(false);
        // 역순도 동일
        expect(timingSafeStringEqual(b, a)).toBe(false);
    });

    test("case4 — 빈 문자열 동치", () => {
        expect(timingSafeStringEqual("", "")).toBe(true);
        expect(timingSafeStringEqual("", "00")).toBe(false);
    });

    test("case5 — Buffer / string 혼합 입력", () => {
        const raw = Buffer.from([0x01, 0x02, 0x03, 0x04]);
        const hex = raw.toString("hex"); // "01020304"
        expect(timingSafeStringEqual(raw, hex)).toBe(true);
        expect(timingSafeStringEqual(hex, raw)).toBe(true);
        expect(timingSafeStringEqual(raw, Buffer.from([0x01, 0x02, 0x03, 0x05]))).toBe(false);
        // utf8 인코딩 경로
        expect(timingSafeStringEqual("hello", "hello", "utf8")).toBe(true);
        expect(timingSafeStringEqual("hello", "world", "utf8")).toBe(false);
    });

    // MEDIUM-1: hex silent truncation 방지 — 부정 케이스 3건.
    test("case6 — 비-hex 문자 포함 문자열은 false (silent truncation 가드)", () => {
        // (a) 완전 non-hex
        expect(timingSafeStringEqual("zz", "zz")).toBe(false);
        // (b) 중간에 비-hex 구분자 포함
        expect(timingSafeStringEqual("ab!cd", "abcd")).toBe(false);
        // (c) prefix는 hex지만 suffix에 비-hex → Buffer.from은 "ab"로 잘라내
        //     실수로 "ab"와 일치시킬 수 있다. false여야 한다.
        expect(timingSafeStringEqual("abzz", "ab")).toBe(false);
    });

    test("case7 — expectedLength 옵션: 실제 길이 불일치는 false", () => {
        const hex = "deadbeef"; // 4바이트
        // expectedLength를 4로 지정 — 정상 경로
        expect(timingSafeStringEqual(hex, hex, "hex", 4)).toBe(true);
        // expectedLength 8인데 실제 4바이트 → false
        expect(timingSafeStringEqual(hex, hex, "hex", 8)).toBe(false);
    });

    test("case7b — expectedLength 0/음수/비정수는 RangeError (조용한 폴백 금지)", () => {
        const hex = "deadbeef";
        expect(() => timingSafeStringEqual(hex, hex, "hex", 0)).toThrow(RangeError);
        expect(() => timingSafeStringEqual(hex, hex, "hex", -1)).toThrow(RangeError);
        expect(() => timingSafeStringEqual(hex, hex, "hex", 1.5)).toThrow(RangeError);
    });

    // coverage instrumentation이 타이밍을 왜곡하여 비교 편향 임계치를 넘길 수 있음.
    // npm test 에서는 실행, test:coverage 에서는 skip.
    //   - Jest `--coverage` 플래그: process.argv 에 포함됨.
    //   - npm lifecycle: `npm run test:coverage` → npm_lifecycle_event === "test:coverage".
    //   - V8 coverage: NODE_V8_COVERAGE.
    //   - Istanbul 주입된 전역 카운터: __coverage__.
    //   - 임의 오버라이드: COVERAGE 환경 변수.
    const underCoverage = !!(
        process.env.NODE_V8_COVERAGE ||
        (globalThis as unknown as { __coverage__?: unknown }).__coverage__ ||
        process.env.COVERAGE ||
        process.env.npm_lifecycle_event === "test:coverage" ||
        process.argv.includes("--coverage")
    );
    (underCoverage ? test.skip : test)("마이크로벤치 — early-mismatch vs late-mismatch 편향 < 7% (median 기반)", () => {
        // 본 벤치 주의사항:
        //   - alloc/copy preamble 비용이 timingSafeEqual 본체보다 훨씬 크므로
        //     실제 상수시간성은 Node.js `crypto.timingSafeEqual` 구현 신뢰에 의존한다.
        //   - 본 테스트는 (1) 헬퍼가 timingSafeEqual을 사용함을 확인하는 회귀 감지,
        //     (2) early/late mismatch 간 거시적 편향이 없는지를 확인하는 스모크 수준이다.
        //   - 정확한 상수시간 증명은 dudect 등 통계적 도구의 영역이며 본 테스트의 범위가 아니다.
        //   - 상수시간성은 crypto.timingSafeEqual 구현 신뢰에 의존. 본 임계는 회귀 탐지 목적.
        const base = "f".repeat(64);
        const earlyMismatch = "0" + "f".repeat(63);
        const lateMismatch = "f".repeat(63) + "0";

        const ITER = 100_000;
        const WARMUP = 5_000;
        const SAMPLES = 11; // 샘플 수 (median 계산용) — 5→11 확대로 변동 완화

        // warmup
        for (let i = 0; i < WARMUP; i++) {
            timingSafeStringEqual(base, earlyMismatch);
            timingSafeStringEqual(base, lateMismatch);
        }

        function measure(other: string): number {
            const t0 = process.hrtime.bigint();
            for (let i = 0; i < ITER; i++) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const _ = timingSafeStringEqual(base, other);
            }
            const t1 = process.hrtime.bigint();
            return Number(t1 - t0); // ns
        }

        function median(xs: number[]): number {
            const sorted = xs.slice().sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 === 0
                ? (sorted[mid - 1] + sorted[mid]) / 2
                : sorted[mid];
        }

        const earlySamples: number[] = [];
        const lateSamples: number[] = [];
        // interleave 측정으로 시스템 부하 균질화
        for (let s = 0; s < SAMPLES; s++) {
            earlySamples.push(measure(earlyMismatch));
            lateSamples.push(measure(lateMismatch));
        }

        const earlyNs = median(earlySamples);
        const lateNs = median(lateSamples);
        const meanNs = (earlyNs + lateNs) / 2;
        const biasPct = Math.abs(earlyNs - lateNs) / meanNs * 100;

        const report = {
            requirement: "REQ-04",
            iterations: ITER,
            warmup: WARMUP,
            samples: SAMPLES,
            method: "median",
            earlyMismatchSamplesNs: earlySamples,
            lateMismatchSamplesNs: lateSamples,
            earlyMismatchNsMedian: earlyNs,
            lateMismatchNsMedian: lateNs,
            earlyMismatchNsPerOp: earlyNs / ITER,
            lateMismatchNsPerOp: lateNs / ITER,
            biasPercent: biasPct,
            threshold: 7,
            pass: biasPct < 7,
            note:
                "preamble alloc/copy 비용이 dominant. 상수시간성은 Node crypto.timingSafeEqual 구현에 의존.",
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            generatedAt: new Date().toISOString()
        };
        fs.writeFileSync(
            path.join(REPORTS_DIR, "req-04-bench.json"),
            JSON.stringify(report, null, 2),
            "utf8"
        );

        // median 기반 단일 단언 (재시도 로직 제거).
        expect(biasPct).toBeLessThan(7);
    }, 60_000);

    test("소스 파일이 crypto.timingSafeEqual 을 사용한다", () => {
        const src = fs.readFileSync(
            path.join(REPO_ROOT, "src", "util", "timingSafeStringEqual.ts"),
            "utf8"
        );
        expect(src).toMatch(/crypto\.timingSafeEqual/);
    });
});
