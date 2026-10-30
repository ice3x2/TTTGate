/**
 * R3-REQ-06 — CI 공급망 게이트 정적 검증 (dry-run).
 * NO-MOCK: 실 YAML 파일 파싱.
 *
 * 증명 범위:
 *   1) 워크플로우 파일 존재
 *   2) PR 트리거 존재 (pull_request)
 *   3) moderate 게이트 Step 이 판정 스크립트(--server-gate)를 부르고, 온라인 jest 단계보다 먼저 돈다(#293)
 *   4) crypto-js 서버 체인 부재 검증 Step 존재
 *   5) R3 테스트 실행 Step 존재
 *
 * 의도 실패 증명: CRITICAL 게이트는 npm audit 의 exit code 계약(--audit-level >= found → exit 1)으로,
 *   moderate 게이트는 판정 스크립트로 막는다(fail-closed.test.ts 가 종료 코드를 본다).
 */
import * as fs from "fs";
import * as path from "path";
import {parse as parseYaml} from "yaml";

const repoRoot = path.resolve(__dirname, "..", "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "supply-chain-audit.yml");

describe("R3-REQ-06 CI supply-chain gate (static)", () => {
    // #293: 릴리스 워크플로가 태그 push 로 부를 때도 돈다(불린 워크플로의 github 문맥은 부른 쪽 것이다). PR 에서는 돌지 않는다.
    test("online audit jobs run on schedule, explicit dispatch, or a release tag", () => {
        const workflow = parseYaml(fs.readFileSync(workflowPath, "utf8"));
        for(const job of [workflow.jobs["audit-runtime"], workflow.jobs["audit-admin"]]) {
            expect(job.if).toBe("github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/')");
            expect(JSON.stringify(job)).not.toMatch(/\|\| echo|grep -q/);
        }
    });
    test("워크플로우 파일 존재", () => {
        expect(fs.existsSync(workflowPath)).toBe(true);
    });

    test("pull_request 트리거 정의", () => {
        const content = fs.readFileSync(workflowPath, "utf8");
        const yaml = parseYaml(content);
        // YAML 'on' key 은 JS 파서에서 true 로 캐스팅되는 경우가 있음.
        const on = yaml.on ?? yaml[true as unknown as string];
        expect(on).toBeDefined();
        expect(on.pull_request).toBeDefined();
    });

    test("moderate 차단 게이트 존재 (검토 예외만 통과하는 서버 게이트, #180, #293)", () => {
        const content = fs.readFileSync(workflowPath, "utf8");
        expect(content).toMatch(/node scripts\/supply-chain-gate\.cjs --server-gate/);
        // 게이트 스크립트가 실제로 moderate 수준 production 감사를 돈다.
        const script = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "supply-chain-gate.cjs"), "utf8");
        expect(script).toMatch(/"audit", "--omit=dev", "--audit-level=moderate", "--json"/);
    });

    test("CRITICAL 차단 게이트 존재 (--audit-level=critical)", () => {
        const content = fs.readFileSync(workflowPath, "utf8");
        expect(content).toMatch(/npm audit [^\n]*--audit-level=critical/);
    });

    test("crypto-js 서버 체인 부재 검증 Step 존재", () => {
        const content = fs.readFileSync(workflowPath, "utf8");
        expect(content).toMatch(/r3-req-02-crypto-js-removed/);
        expect(content).toMatch(/R3-REQ-02/);
    });

    test("R3 supply-chain 테스트 실행 Step 존재", () => {
        const content = fs.readFileSync(workflowPath, "utf8");
        expect(content).toMatch(/jest test\/supply-chain/);
    });

    // 바이너리 빌드 도구(개발 의존성, 예: pkg-fetch → undici)의 critical 권고도 릴리스를 막는다(#293).
    test("루트 전체 트리(개발 의존성 포함)의 CRITICAL 감사 단계 존재", () => {
        const workflow = parseYaml(fs.readFileSync(workflowPath, "utf8"));
        const steps = workflow.jobs["audit-runtime"].steps.filter((step: any) => String(step.run ?? "").trim() === "npm audit --audit-level=critical");
        expect(steps).toHaveLength(1);
        expect(steps[0].env?.NODE_ENV).toBe("development");
    });

    // 판정 단계가 먼저 돌아야 막힐 때 그 사유와 예외 경고가 로그에 남는다. jest 가 먼저 실패하면 뒤 단계는 건너뛴다(#293).
    test("판정 단계가 온라인 jest 단계보다 먼저 돈다", () => {
        const workflow = parseYaml(fs.readFileSync(workflowPath, "utf8"));
        const runs: string[] = workflow.jobs["audit-runtime"].steps.map((step: any) => String(step.run ?? "").trim());
        const gate = runs.indexOf("node scripts/supply-chain-gate.cjs --server-gate");
        const critical = runs.indexOf("npm audit --omit=dev --audit-level=critical");
        const online = runs.findIndex((run) => run.includes("r3-req-04-medium-cleared.test.ts"));
        expect(gate).toBeGreaterThanOrEqual(0);
        expect(critical).toBeGreaterThanOrEqual(0);
        expect(online).toBeGreaterThanOrEqual(0);
        expect(critical).toBeLessThan(online);
        expect(gate).toBeLessThan(online);
    });

    // runtime-only audit 는 --omit=dev 로 빌드 의존성 노이즈를 뺀다. 주석이 아니라 실제 run 단계와 판정 스크립트를 본다(#293).
    test("production 트리 감사가 --omit=dev 로 격리됨", () => {
        const workflow = parseYaml(fs.readFileSync(workflowPath, "utf8"));
        const runs: string[] = workflow.jobs["audit-runtime"].steps.filter((step: any) => step.run).map((step: any) => step.run.trim());
        expect(runs).toContain("npm audit --omit=dev --audit-level=critical");
        expect(runs).toContain("node scripts/supply-chain-gate.cjs --server-gate");

        const script = fs.readFileSync(path.join(path.dirname(workflowPath), "../../scripts/supply-chain-gate.cjs"), "utf8");
        expect(script).toContain('runNpm(["audit", "--omit=dev", "--audit-level=moderate", "--json"])');
    });
});
