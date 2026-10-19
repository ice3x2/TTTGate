/**
 * P3-T1 / REQ-01 — createOpaqueToken이 crypto.randomBytes 기반 CSPRNG로
 * 생성되는지 검증한다. Mock 금지: 실 `src/commons/ProtocolV2`의 함수를 직접 호출.
 *
 * 검증 항목:
 *  1. 10,000개 토큰 생성 시 중복 0건
 *  2. 모든 토큰이 hex 정규식과 매치(2*length 길이)
 *  3. 바이트 분포 카이제곱 p > 0.01 (균등성 근사 검사)
 *  4. IdentityRegistry.issueBindingToken 또한 예측 가능 시드(Math.random)와
 *     분리되어 있는지 — 두 번 호출 결과가 서로 다름을 확인(통계적 충돌 확률 ~0)
 *
 * 실행 후 `reports/req-01-chi2.json` 생성.
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { createOpaqueToken } from "../../../src/commons/ProtocolV2";
import { IdentityRegistry } from "../../../src/server/IdentityRegistry";

const REPORT_DIR = resolve(process.cwd(), "reports");

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
        const parts: Buffer[] = [];
        for (let i = 0; i < N; i++) {
            parts.push(Buffer.from(createOpaqueToken(LEN), "hex"));
        }
        const all = Buffer.concat(parts);
        const { chi2, n } = chiSquareBytes(all);
        // df=255 p=0.01 critical value ≈ 310.457
        // (CSPRNG은 평균 255 근처)
        const P01_CRITICAL = 310.457;
        writeReport("req-01-chi2.json", {
            generatedAt: new Date().toISOString(),
            N,
            tokenLengthBytes: LEN,
            totalBytes: n,
            chi2,
            df: 255,
            p01Critical: P01_CRITICAL,
            pass: chi2 <= P01_CRITICAL
        });
        expect(chi2).toBeLessThanOrEqual(P01_CRITICAL);
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
