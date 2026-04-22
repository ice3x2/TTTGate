/**
 * R3-REQ-03 — form-data 및 @babel/traverse CRITICAL 수정 검증.
 * NO-MOCK: 실 npm audit CLI (production 트리) 결과 확인.
 *
 * 근거:
 *   - form-data <4.0.4 : GHSA-fjxv-7rqg-78g4 (boundary 예측 가능)
 *   - @babel/traverse <7.23.2 : GHSA-67hx-6x53-jw92 (빌드 타임 RCE)
 *
 * 런타임(production) 트리에서 CRITICAL 0건이 요구사항.
 * @babel/traverse 는 빌드 타임(dev) 도구 체인에 있으므로 별도 P4 범위이나,
 * 여기서는 production audit 로 form-data 만 강제 검증한다.
 */
import {execSync} from "child_process";
import * as path from "path";

const repoRoot = path.resolve(__dirname, "..", "..");

describe("R3-REQ-03 CRITICAL cleared on production chain", () => {
    test("npm audit --omit=dev --audit-level=critical → 0건", () => {
        let out = "";
        let exitCode = 0;
        try {
            out = execSync("npm audit --omit=dev --audit-level=critical --json", {
                cwd: repoRoot,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
                env: {...process.env, NODE_ENV: "development"},
            });
        } catch(e: any) {
            exitCode = e.status || 1;
            out = e.stdout ? e.stdout.toString() : "";
        }

        // npm audit JSON 구조: vulnerabilities[pkgName].severity
        expect(out.length).toBeGreaterThan(0);
        const parsed = JSON.parse(out);
        const vulnerabilities = parsed.vulnerabilities || {};
        const criticalHits: string[] = [];
        for(const [name, data] of Object.entries<any>(vulnerabilities)) {
            if(data?.severity === "critical") criticalHits.push(name);
        }
        expect(criticalHits).toEqual([]);
    }, 60_000);

    test("npm audit --omit=dev --audit-level=high → form-data/node-forge advisory 0건", () => {
        let out = "";
        try {
            out = execSync("npm audit --omit=dev --audit-level=high --json", {
                cwd: repoRoot,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
                env: {...process.env, NODE_ENV: "development"},
            });
        } catch(e: any) {
            out = e.stdout ? e.stdout.toString() : "";
        }
        const parsed = JSON.parse(out);
        const vulnerabilities = parsed.vulnerabilities || {};
        expect(vulnerabilities["form-data"]).toBeUndefined();
        expect(vulnerabilities["node-forge"]).toBeUndefined();
    }, 60_000);

    test("form-data overrides 설정 존재 (production 트리 트랜지티브 고정)", () => {
        const fs = require("fs");
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
        expect(pkg.overrides).toBeDefined();
        expect(pkg.overrides["form-data"]).toBeDefined();
    });
});
