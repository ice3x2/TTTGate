/**
 * P3-T4 / REQ-04 — 인증 경로 상수시간 비교 교체 검증.
 *
 * Mock 금지:
 *  (a) scripts/lint-auth-compare.mjs를 실제 spawnSync로 호출해 P3-T4 대상 파일들의
 *      violation이 0건임을 확인. (Phase 3 범위 외 파일의 violation은 무시.)
 *  (b) IdentityRegistry.consumeBindingToken에 대해 (clientId 일치/불일치, id 일치/불일치)
 *      의미론 4가지 모두 실 동작 검증.
 *  (c) 마이크로벤치: 동일 길이, 맨앞 1바이트 차이 vs 맨뒤 1바이트 차이의 실행시간 편향 < 12%(최솟값 기반, #274).
 */
import { spawnSync } from "child_process";
import { resolve, relative, sep } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { IdentityRegistry } from "../../../src/server/IdentityRegistry";
import { timingSafeStringEqual } from "../../../src/util/timingSafeStringEqual";
import {createArtifactRoot} from "../../helpers/artifactRoot";

const P3_T4_TARGETS = [
    "src/server/TunnelServer.ts",
    "src/server/IdentityRegistry.ts",
    "src/server/TunnelHandshakePolicy.ts",
    "src/server/admin/SessionStore.ts",
    "src/server/admin/AdminServer.ts"
].map((p) => p.split("/").join(sep));

type LintEvent = { type: string; file?: string };

function runLintScript(tmpReportDir: string): LintEvent[] {
    mkdirSync(tmpReportDir, { recursive: true });
    const res = spawnSync(
        process.execPath,
        [resolve(process.cwd(), "scripts", "lint-auth-compare.mjs"), "src", "--report-dir", tmpReportDir],
        { encoding: "utf-8", timeout: 60_000 }
    );
    const lines = (res.stdout ?? "").trim().split(/\r?\n/).filter((l) => l.length > 0);
    return lines.map((l) => JSON.parse(l) as LintEvent);
}

describe("REQ-04 상수시간 비교 전환", () => {
    it("(a) lint-auth-compare: P3-T4 대상 파일 violation 0건", () => {
        const artifacts = createArtifactRoot('req04-artifacts-');
        try {
        const events = runLintScript(artifacts.root);
        const violations = events.filter((e) => e.type === "violation");
        const p3t4Violations = violations.filter((v) => {
            const normalized = String(v.file).split("/").join(sep);
            return P3_T4_TARGETS.some((t) => normalized === t || normalized.endsWith(t));
        });
        // 리포트 저장
        writeFileSync(resolve(artifacts.root, "req-04-grep.json"), JSON.stringify({
            generatedAt: new Date().toISOString(),
            totalViolations: violations.length,
            p3t4Targets: P3_T4_TARGETS.map((p) => p.split(sep).join("/")),
            p3t4Violations
        }, null, 2), "utf-8");
        expect(p3t4Violations).toEqual([]);
        } finally { artifacts.cleanup(); }
    });

    it("(b) IdentityRegistry.consumeBindingToken — clientId 상수시간, 의미론 보존", () => {
        const reg = new IdentityRegistry([]);
        const token = reg.issueBindingToken("c1", 1, 2, 3);

        // 완전 일치
        expect(reg.issueBindingToken("c1", 10, 20, 30)).not.toBe(token);
        const ok = reg.consumeBindingToken(token, { clientId: "c1", ctrlID: 1, handlerID: 2, sessionID: 3 });
        expect(ok).toBe(true);

        // 소비 후에는 false
        const ok2 = reg.consumeBindingToken(token, { clientId: "c1", ctrlID: 1, handlerID: 2, sessionID: 3 });
        expect(ok2).toBe(false);

        // clientId 불일치
        const t2 = reg.issueBindingToken("c1", 1, 2, 3);
        expect(reg.consumeBindingToken(t2, { clientId: "c2", ctrlID: 1, handlerID: 2, sessionID: 3 })).toBe(false);

        // ctrlID 불일치
        const t3 = reg.issueBindingToken("c1", 1, 2, 3);
        expect(reg.consumeBindingToken(t3, { clientId: "c1", ctrlID: 9, handlerID: 2, sessionID: 3 })).toBe(false);
    });

    // coverage instrumentation은 hot loop에 카운터를 주입하여 편향을 증폭시킨다.
    // npm test 에서는 실행, test:coverage 에서는 skip.
    const underCoverage = !!(
        process.env.NODE_V8_COVERAGE ||
        (globalThis as unknown as { __coverage__?: unknown }).__coverage__ ||
        process.env.COVERAGE ||
        process.env.npm_lifecycle_event === "test:coverage" ||
        process.argv.includes("--coverage")
    );
    (underCoverage ? it.skip : it)("(c) timingSafeStringEqual 마이크로벤치 편향 < 12% (최솟값 기반)", () => {
        // 본 벤치 주의:
        //  - 상수시간성은 Node `crypto.timingSafeEqual` 구현 신뢰에 의존.
        //  - 본 테스트는 회귀 탐지(임계 초과 시 신호) 목적이며, 통계적 부채널 증명 아님.
        //  - #274: 병렬 실행에서는 선점·GC 가 한쪽 측정에만 몰려 중앙값도 흔들렸다(편향 0.26). 그런 잡음은 시간을 늘리기만
        //    하므로 각 쪽의 최솟값을 비교하고, 순서를 번갈아 재며, 측정 묶음을 최대 3번 시도한다. 임계는 그대로 12% 다.
        //  - 64자에서는 앞에서 끊는 JS 비교의 편향(약 0.15)이 임계에 너무 가까워 재시도에 묻혔다. 1024자로 늘려 버퍼 생성
        //    비용보다 비교 위치의 차이가 커지게 했다(앞에서 끊는 비교 약 0.25, 정상 비교 0.05 이하).
        const L = 1024;
        const N = 20_000;
        const SAMPLES = 9;
        const ATTEMPTS = 3;
        const base = "a".repeat(L);
        const diffFirst = "b" + "a".repeat(L - 1);
        const diffLast = "a".repeat(L - 1) + "b";

        // 워밍업
        for (let i = 0; i < 2000; i++) {
            timingSafeStringEqual(base, diffFirst, "utf8");
            timingSafeStringEqual(base, diffLast, "utf8");
        }

        const measure = (other: string): number => {
            const t0 = process.hrtime.bigint();
            for (let i = 0; i < N; i++) { timingSafeStringEqual(base, other, "utf8"); }
            const t1 = process.hrtime.bigint();
            return Number(t1 - t0);
        };

        const attemptBias = (): number => {
            const firstSamples: number[] = [];
            const lastSamples: number[] = [];
            for (let s = 0; s < SAMPLES; s++) {
                // 순서를 번갈아 재 시간에 따른 변화가 한쪽에만 쌓이지 않게 한다.
                if (s % 2 === 0) { firstSamples.push(measure(diffFirst)); lastSamples.push(measure(diffLast)); }
                else { lastSamples.push(measure(diffLast)); firstSamples.push(measure(diffFirst)); }
            }
            const nsFirst = Math.min(...firstSamples);
            const nsLast = Math.min(...lastSamples);
            return Math.abs(nsFirst - nsLast) / Math.max(nsFirst, nsLast);
        };

        const biases: number[] = [];
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            biases.push(attemptBias());
            if (biases[biases.length - 1] < 0.12) break;
        }
        // 실패하면 시도별 편향을 모두 보여 진단할 수 있게 한다.
        expect({belowThreshold: Math.min(...biases) < 0.12, biases}).toEqual({belowThreshold: true, biases});
    }, 60_000);
});
