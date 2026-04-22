import * as fs from "fs";
import * as path from "path";
import { DefaultClockRng, ClockRngProvider } from "../../../src/util/ClockRng";

/**
 * REQ-01 — ClockRng.secureRandomBytes 경로 검증.
 * NO-MOCK: 실 crypto.randomBytes 호출.
 */
describe("REQ-01 ClockRng.secureRandomBytes", () => {
    const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
    const REPORTS_DIR = path.join(REPO_ROOT, "reports");

    beforeAll(() => {
        if (!fs.existsSync(REPORTS_DIR)) {
            fs.mkdirSync(REPORTS_DIR, { recursive: true });
        }
    });

    test("타입 상 secureRandomBytes가 존재한다", () => {
        expect(typeof DefaultClockRng.secureRandomBytes).toBe("function");
        expect(typeof ClockRngProvider.current().secureRandomBytes).toBe("function");
    });

    test("입력 검증: 양의 정수가 아니면 RangeError", () => {
        expect(() => DefaultClockRng.secureRandomBytes(0)).toThrow(RangeError);
        expect(() => DefaultClockRng.secureRandomBytes(-1)).toThrow(RangeError);
        expect(() => DefaultClockRng.secureRandomBytes(1.5)).toThrow(RangeError);
    });

    // MEDIUM-3: 이벤트 루프 블록 방지를 위한 상한 검증.
    test("입력 검증: n > 1024 면 RangeError (이벤트 루프 블록 방지)", () => {
        expect(() => DefaultClockRng.secureRandomBytes(1025)).toThrow(RangeError);
        expect(() => DefaultClockRng.secureRandomBytes(1024 * 1024)).toThrow(RangeError);
        // 경계값 1024는 허용
        expect(DefaultClockRng.secureRandomBytes(1024).length).toBe(1024);
    });

    // MEDIUM-4: configure shape-check.
    test("configure: 필수 메서드가 없으면 TypeError", () => {
        const original = ClockRngProvider.current();
        try {
            // @ts-expect-error — 의도적 잘못된 shape
            expect(() => ClockRngProvider.configure(null)).toThrow(TypeError);
            // @ts-expect-error — now 누락
            expect(() => ClockRngProvider.configure({ random: () => 0, secureRandomBytes: () => Buffer.alloc(0) })).toThrow(TypeError);
            // @ts-expect-error — random 누락
            expect(() => ClockRngProvider.configure({ now: () => 0, secureRandomBytes: () => Buffer.alloc(0) })).toThrow(TypeError);
            // @ts-expect-error — secureRandomBytes 누락
            expect(() => ClockRngProvider.configure({ now: () => 0, random: () => 0 })).toThrow(TypeError);
            // 올바른 shape — 통과
            expect(() =>
                ClockRngProvider.configure({
                    now: () => 0,
                    random: () => 0,
                    secureRandomBytes: (n: number) => Buffer.alloc(n)
                })
            ).not.toThrow();
        } finally {
            ClockRngProvider.configure(original);
        }
    });

    // LOW-1: 런타임 검증 — DefaultClockRng 인스턴스가 실제로 32바이트 Buffer를
    // 반환하는지 확인. grep 기반 타입-선언-매칭 위험 제거.
    test("LOW-1 런타임 검증: DefaultClockRng.secureRandomBytes(32)는 32바이트 Buffer", () => {
        const buf = DefaultClockRng.secureRandomBytes(32);
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.length).toBe(32);
        // 두 번 호출 시 서로 다른 값 (CSPRNG 성격)
        const buf2 = DefaultClockRng.secureRandomBytes(32);
        expect(buf.equals(buf2)).toBe(false);
    });

    test("10000회 호출 — 중복 0건, Shannon 엔트로피 > 7.5 bits/byte", () => {
        const N = 10_000;
        const LEN = 16; // 128-bit 토큰 상당
        const seen = new Set<string>();
        const byteFreq = new Array<number>(256).fill(0);
        let totalBytes = 0;

        for (let i = 0; i < N; i++) {
            const buf = DefaultClockRng.secureRandomBytes(LEN);
            expect(Buffer.isBuffer(buf)).toBe(true);
            expect(buf.length).toBe(LEN);
            const hex = buf.toString("hex");
            seen.add(hex);
            for (let j = 0; j < buf.length; j++) {
                byteFreq[buf[j]]++;
                totalBytes++;
            }
        }

        // Shannon 엔트로피 (bits / byte, 이상 8.0)
        let entropy = 0;
        for (let v = 0; v < 256; v++) {
            if (byteFreq[v] === 0) continue;
            const p = byteFreq[v] / totalBytes;
            entropy += -p * Math.log2(p);
        }

        const report = {
            requirement: "REQ-01",
            iterations: N,
            bytesPerCall: LEN,
            totalBytes,
            uniqueHexCount: seen.size,
            duplicateCount: N - seen.size,
            shannonEntropyBitsPerByte: entropy,
            threshold: 7.5,
            pass: seen.size === N && entropy > 7.5,
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            generatedAt: new Date().toISOString()
        };
        fs.writeFileSync(
            path.join(REPORTS_DIR, "req-01-entropy.json"),
            JSON.stringify(report, null, 2),
            "utf8"
        );

        expect(seen.size).toBe(N); // 중복 0
        expect(entropy).toBeGreaterThan(7.5);
    }, 30_000);

    test("ClockRng.ts 소스에 Math.random 사용은 random()에 국한 (토큰 경로 grep 0건)", () => {
        const src = fs.readFileSync(
            path.join(REPO_ROOT, "src", "util", "ClockRng.ts"),
            "utf8"
        );
        // LOW-1: DefaultClockRng 클래스의 secureRandomBytes 메서드 본문에 한정하여 매칭.
        // 타입 선언(ClockRng type)의 `secureRandomBytes(n): Buffer;` 시그니처는
        // `: Buffer {` 로 시작하는 구현체와 달리 `;`로 끝나므로 제외된다.
        // 클래스 내부임을 확인하기 위해 먼저 클래스 블록을 추출한다.
        const classBlockMatch = src.match(
            /class\s+DefaultClockRngImpl[^{]*\{[\s\S]*?\n\}/
        );
        expect(classBlockMatch).not.toBeNull();
        // 클래스 블록 내부에서 secureRandomBytes 메서드 본문만 추출.
        const methodBodyMatch = classBlockMatch![0].match(
            /secureRandomBytes\s*\([^)]*\)\s*:\s*Buffer\s*\{([\s\S]*?)\n\s{4}\}/
        );
        expect(methodBodyMatch).not.toBeNull();
        const methodBody = methodBodyMatch![1];
        expect(methodBody).toMatch(/crypto\.randomBytes/);
        expect(methodBody).not.toMatch(/Math\.random/);
        // 주석/블록주석 제거 후 실행 코드 내 Math.random은 지터용 random() 안에서만(=딱 1회) 등장.
        const stripped = src
            .replace(/\/\*[\s\S]*?\*\//g, "") // 블록 주석
            .replace(/(^|[^:])\/\/.*$/gm, "$1"); // 라인 주석 (URL 스킴 보호)
        const count = (stripped.match(/Math\.random/g) || []).length;
        expect(count).toBe(1);
        // crypto.randomBytes import/사용 확인.
        expect(src).toMatch(/crypto\.randomBytes/);
    });
});
