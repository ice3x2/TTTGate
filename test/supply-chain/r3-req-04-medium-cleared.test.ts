/**
 * R3-REQ-04 — 런타임(production) MEDIUM advisory 정리 검증.
 * NO-MOCK: 실 npm audit CLI.
 *
 * 범위:
 *   - 서버 런타임: npm audit --omit=dev --audit-level=moderate 0건
 *   - yaml / lodash / qs / nanoid / js-yaml / diff / formidable 개별 advisory 부재
 */
import {execSync} from "child_process";
import * as path from "path";

const repoRoot = path.resolve(__dirname, "..", "..");

const runAudit = (args: string): string => {
    try {
        return execSync(`npm audit ${args} --json`, {
            cwd: repoRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            env: {...process.env, NODE_ENV: "development"},
        });
    } catch(e: any) {
        return e.stdout ? e.stdout.toString() : "{}";
    }
};

describe("R3-REQ-04 runtime MEDIUM advisories cleared", () => {
    test("npm audit --omit=dev --audit-level=moderate → 총 0건", () => {
        const out = runAudit("--omit=dev --audit-level=moderate");
        const parsed = JSON.parse(out);
        const vulns = parsed.vulnerabilities || {};
        const hits = Object.keys(vulns);
        expect(hits).toEqual([]);
    }, 60_000);

    test("대상 패키지별 advisory 부재 (yaml/lodash/qs/nanoid/js-yaml/diff/formidable)", () => {
        const out = runAudit("--omit=dev --audit-level=low");
        const parsed = JSON.parse(out);
        const vulns = parsed.vulnerabilities || {};
        const targets = ["yaml", "lodash", "qs", "nanoid", "js-yaml", "diff", "formidable"];
        const hits = targets.filter((name) => vulns[name] !== undefined);
        expect(hits).toEqual([]);
    }, 60_000);
});
