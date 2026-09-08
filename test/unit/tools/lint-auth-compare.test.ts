import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {cleanupOwnedLintRoot, runLintProcess} from "../../helpers/lintProcess";

/**
 * P1-T2 / REQ-21 — lint-auth-compare 스크립트의 실환경 검증.
 * Mock 금지: 실제 임시 FS + child_process.spawnSync로 Node 스크립트를 실행한다.
 */
describe("scripts/lint-auth-compare.mjs", () => {
    const scriptPath = resolve(process.cwd(), "scripts", "lint-auth-compare.mjs");
    let tmpRoot: string;

    beforeEach(() => {
        tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "lint-auth-")));
    });

    afterEach(() => {
        cleanupOwnedLintRoot(tmpRoot);
    });

    function runScript(targetPath: string, env: Record<string, string> = {}, reportDir?: string, expectedExit: 0 | 1 = 0) {
        // HIGH-2 격리: 리포트 디렉터리를 tmpRoot 하위로 돌려 cwd/reports/auth-compare.json 오염 금지.
        const rDir = reportDir ?? join(tmpRoot, "reports");
        const res = runLintProcess({script: scriptPath, target: targetPath, reportDir: rDir, cwd: tmpRoot, strict: env.LINT_AUTH_COMPARE_STRICT === "1", expectedExit});
        return { res, reportDir: rDir };
    }

    it("detects authKey === comparison and writes report (exit 0 in non-strict)", () => {
        const srcDir = join(tmpRoot, "src");
        mkdirSync(srcDir, { recursive: true });
        const offendingPath = join(srcDir, "bad.ts");
        writeFileSync(offendingPath,
            `export function verify(authKey: string, expected: string) {\n` +
            `    return authKey === expected;\n` +
            `}\n`,
            { encoding: "utf-8" }
        );

        const { res, reportDir } = runScript(srcDir);
        expect(res.status).toBe(0); // warn 모드 기본
        const stdoutLines = res.stdout.trim().split(/\r?\n/).filter((l) => l.length > 0);
        const violations = stdoutLines
            .map((l) => JSON.parse(l))
            .filter((o: any) => o.type === "violation");
        expect(violations.length).toBeGreaterThanOrEqual(1);
        expect(violations[0].operator).toBe("===");
        expect(violations[0].file).toContain("bad.ts");

        const summary = stdoutLines
            .map((l) => JSON.parse(l))
            .find((o: any) => o.type === "summary");
        expect(summary).toBeDefined();
        expect(summary.violationCount).toBeGreaterThanOrEqual(1);

        // HIGH-2 격리: tmp 리포트 디렉터리에서 리포트 확인 (cwd/reports 오염 금지).
        const reportPath = resolve(reportDir, "auth-compare.json");
        expect(existsSync(reportPath)).toBe(true);
        const report = JSON.parse(readFileSync(reportPath, { encoding: "utf-8" }));
        expect(report).toHaveProperty("summary");
    });

    it("returns exit 1 in strict mode when violations exist", () => {
        const srcDir = join(tmpRoot, "src");
        mkdirSync(srcDir, { recursive: true });
        writeFileSync(join(srcDir, "bad2.ts"),
            `const token = "x";\nif (token !== "y") { /* noop */ }\n`,
            { encoding: "utf-8" }
        );

        const { res } = runScript(srcDir, { LINT_AUTH_COMPARE_STRICT: "1" }, undefined, 1);
        expect(res.status).toBe(1);
    });

    it("returns exit 0 on clean source", () => {
        const srcDir = join(tmpRoot, "src");
        mkdirSync(srcDir, { recursive: true });
        writeFileSync(join(srcDir, "clean.ts"),
            `export function ok(a: number, b: number) { return a + b; }\n`,
            { encoding: "utf-8" }
        );

        const { res } = runScript(srcDir, { LINT_AUTH_COMPARE_STRICT: "1" }, undefined, 0);
        expect(res.status).toBe(0);
    });
});
