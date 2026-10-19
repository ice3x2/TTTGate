/**
 * P7-T2 / REQ-21 — lint-auth-compare 가 strict(error) 승격 모드에서 exit 1 을 내고,
 * 클린 소스에서는 exit 0 을 내는지 검증한다.
 */
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {cleanupOwnedLintRoot, runLintProcess} from "../../helpers/lintProcess";

describe("REQ-21: lint-auth-compare strict(error) mode", () => {
    const scriptPath = resolve(process.cwd(), "scripts", "lint-auth-compare.mjs");
    let tmpRoot: string;

    beforeEach(() => {
        tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "lint-err-")));
    });
    afterEach(() => {
        cleanupOwnedLintRoot(tmpRoot);
    });

    function run(target: string, strict: boolean, expectedExit: 0 | 1 = 0) {
        const reportDir = join(tmpRoot, "reports");
        return runLintProcess({script: scriptPath, target, reportDir, cwd: tmpRoot, strict, expectedExit});
    }

    it("(a) 위반 파일 → strict 모드에서 exit≠0", () => {
        const srcDir = join(tmpRoot, "src");
        mkdirSync(srcDir, { recursive: true });
        writeFileSync(join(srcDir, "auth.ts"),
            `export function verify(authKey: string, expected: string) {\n` +
            `    return authKey === expected;\n` +
            `}\n`,
            { encoding: "utf-8" }
        );
        const res = run(srcDir, true, 1);
        expect(res.status).toBe(1);
    });

    it("(b) 클린 소스 → strict 모드에서 exit 0", () => {
        const srcDir = join(tmpRoot, "src");
        mkdirSync(srcDir, { recursive: true });
        writeFileSync(join(srcDir, "ok.ts"),
            `import { timingSafeStringEqual } from "./util";\n` +
            `export function verify(authKey: string, expected: string) {\n` +
            `    return timingSafeStringEqual(authKey, expected);\n` +
            `}\n`,
            { encoding: "utf-8" }
        );
        const res = run(srcDir, true);
        expect(res.status).toBe(0);
    });

    it("(c) 실제 프로젝트 src 는 strict 모드에서 violation 0 (exit 0)", () => {
        // 회귀 가드: 프로젝트 전체를 재스캔해 0 위반을 보장한다.
        const projectSrc = resolve(process.cwd(), "src");
        const res = run(projectSrc, true);
        expect(res.status).toBe(0);
    });
});
