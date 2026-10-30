/**
 * P3-T1 / REQ-01 — createOpaqueToken이 crypto.randomBytes 기반 CSPRNG로
 * 생성되는지 검증한다. Mock 금지: 실 `src/commons/ProtocolV2`의 함수를 직접 호출.
 *
 * 검증 항목:
 *  1. 10,000개 토큰 생성 시 중복 0건
 *  2. 모든 토큰이 hex 정규식과 매치(2*length 길이)
 *  3. 바이트 분포 카이제곱 p > 0.01 (균등성 근사 검사, 독립 표본 최대 3회)
 *  4. IdentityRegistry.issueBindingToken 또한 예측 가능 시드(Math.random)와
 *     분리되어 있는지 — 두 번 호출 결과가 서로 다름을 확인(통계적 충돌 확률 ~0)
 *
 * 실행 후 `build/reports/req-01-chi2.json` 생성. 저장소의 `reports/` 는 바꾸지 않는다(#264).
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { createOpaqueToken } from "../../../src/commons/ProtocolV2";
import { IdentityRegistry } from "../../../src/server/IdentityRegistry";

// 추적되는 reports/ 를 실행마다 다시 쓰지 않게 무시되는 build/ 아래에 쓴다(#264).
const REPORT_DIR = resolve(process.cwd(), "build", "reports");

function writeReport(name: string, data: unknown) {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(resolve(REPORT_DIR, name), JSON.stringify(data, null, 2), "utf-8");
}

/**
 * 바이트 분포 카이제곱 통계량 계산.
 * 자유도 255에서 p > 0.01 컷오프는 약 310 (one-sided upper tail).
 * 균등 CSPRNG의 예상 chi2 ≈ 255; 300 내외면 통과.
 */
function chiSquareBytes(bytes: Buffer): { chi2: number; n: number } {
    const counts = new Array<number>(256).fill(0);
    for (const b of bytes) counts[b]++;
    const expected = bytes.length / 256;
    let chi2 = 0;
    for (let i = 0; i < 256; i++) {
        const diff = counts[i] - expected;
        chi2 += (diff * diff) / expected;
    }
    return { chi2, n: bytes.length };
}

/**
 * 독립 표본으로 최대 attempts 번 검정해 처음 통과한 시도에서 멈춘다(#198).
 * p=0.01 검정을 한 번만 하면 정상 CSPRNG 도 약 1% 확률로 실패한다. 세 번 모두 넘을 확률은 약 10^-6 이고,
 * 편향된 생성기는 64만 바이트 표본에서 매번 크게 벗어나므로 검출력은 유지된다.
 */
function resampledChi2(sample: () => number, critical: number, attempts = 3): { chi2s: number[]; pass: boolean } {
    const chi2s: number[] = [];
    for (let i = 0; i < attempts; i++) {
        const chi2 = sample();
        chi2s.push(chi2);
        if (chi2 <= critical) return { chi2s, pass: true };
    }
    return { chi2s, pass: false };
}

describe("REQ-01 createOpaqueToken (CSPRNG)", () => {
    it("10000개 토큰 중복 0건 + hex 정규식 매치", () => {
        const N = 10000;
        const LEN = 32;
        const hexRx = new RegExp(`^[0-9a-f]{${LEN * 2}}$`);
        const set = new Set<string>();
        for (let i = 0; i < N; i++) {
            const tok = createOpaqueToken(LEN);
            expect(tok).toMatch(hexRx);
            set.add(tok);
        }
        expect(set.size).toBe(N);
    });

    it("바이트 분포 카이제곱 p > 0.01 (chi2 <= 310 근사)", () => {
        const N = 20000;
        const LEN = 32;
        // 모든 토큰을 이어붙여 한 바이트 스트림으로 카이제곱 분석
        const sample = (): number => {
            const parts: Buffer[] = [];
            for (let i = 0; i < N; i++) {
                parts.push(Buffer.from(createOpaqueToken(LEN), "hex"));
            }
            return chiSquareBytes(Buffer.concat(parts)).chi2;
        };
        // df=255 p=0.01 critical value ≈ 310.457
        // (CSPRNG은 평균 255 근처)
        const P01_CRITICAL = 310.457;
        const result = resampledChi2(sample, P01_CRITICAL);
        writeReport("req-01-chi2.json", {
            generatedAt: new Date().toISOString(),
            N,
            tokenLengthBytes: LEN,
            totalBytes: N * LEN,
            chi2: result.chi2s[result.chi2s.length - 1],
            attempts: result.chi2s,
            df: 255,
            p01Critical: P01_CRITICAL,
            pass: result.pass
        });
        expect(result.pass).toBe(true);
    });

    it("재표본 판정은 처음 통과한 시도에서 멈추고, 모든 시도가 넘으면 실패한다", () => {
        const sequence = (values: number[]) => { let i = 0; return () => values[i++]; };
        expect(resampledChi2(sequence([250]), 310)).toEqual({chi2s: [250], pass: true});
        expect(resampledChi2(sequence([320, 260, 999]), 310)).toEqual({chi2s: [320, 260], pass: true});
        expect(resampledChi2(sequence([320, 330, 340, 250]), 310)).toEqual({chi2s: [320, 330, 340], pass: false});
    });

    it("IdentityRegistry.issueBindingToken 은 CSPRNG으로 비예측 값 생성", () => {
        const registry = new IdentityRegistry([]);
        const a = registry.issueBindingToken("c1", 1, 1, 1);
        const b = registry.issueBindingToken("c1", 1, 1, 2);
        expect(a).not.toBe(b);
        expect(a).toMatch(/^[0-9a-f]+$/);
        expect(a.length).toBe(24 * 2); // ProtocolV2에서 24바이트 기본
    });
});
