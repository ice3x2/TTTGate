/**
 * R3-REQ-06 — CI 공급망 게이트 정적 검증 (dry-run).
 * NO-MOCK: 실 YAML 파일 파싱.
 *
 * 증명 범위:
 *   1) 워크플로우 파일 존재
 *   2) PR 트리거 존재 (pull_request)
 *   3) HIGH 게이트 Step 이 `npm audit --audit-level=high` 를 포함
 *   4) crypto-js 서버 체인 부재 검증 Step 존재
 *   5) R3 테스트 실행 Step 존재
 *
 * 의도 실패 증명(dry-run): 게이트가 CRITICAL/HIGH advisory 를 통과시키지 않음은
 *   npm audit 자체의 exit code 계약으로 보장된다 (--audit-level >= found → exit 1).
 */
import * as fs from "fs";
import * as path from "path";
import {parse as parseYaml} from "yaml";

const repoRoot = path.resolve(__dirname, "..", "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "supply-chain-audit.yml");

describe("R3-REQ-06 CI supply-chain gate (static)", () => {
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

    test("HIGH 차단 게이트 존재 (--audit-level=high)", () => {
        const content = fs.readFileSync(workflowPath, "utf8");
        expect(content).toMatch(/npm audit [^\n]*--audit-level=high/);
    });

    test("CRITICAL 차단 게이트 존재 (--audit-level=critical)", () => {
        const content = fs.readFileSync(workflowPath, "utf8");
        expect(content).toMatch(/npm audit [^\n]*--audit-level=critical/);
    });

    test("crypto-js 서버 체인 부재 검증 Step 존재", () => {
        const content = fs.readFileSync(workflowPath, "utf8");
        expect(content).toMatch(/npm ls crypto-js/);
        expect(content).toMatch(/R3-REQ-02/);
    });

    test("R3 supply-chain 테스트 실행 Step 존재", () => {
        const content = fs.readFileSync(workflowPath, "utf8");
        expect(content).toMatch(/jest test\/supply-chain/);
    });

    test("production 트리 감사가 --omit=dev 로 격리됨", () => {
        const content = fs.readFileSync(workflowPath, "utf8");
        // runtime-only audit 는 --omit=dev 를 반드시 포함해야 함 (빌드 의존성 노이즈 제거).
        const matches = content.match(/npm audit --omit=dev/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
});
