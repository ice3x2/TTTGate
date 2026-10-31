import {spawnSync} from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const repoRoot = path.resolve(__dirname, "../..");

test("unreachable audit registry fails the online medium gate", () => {
    const result = spawnSync(process.execPath, [
        path.join(repoRoot, "node_modules/jest/bin/jest.js"),
        "--runInBand", "--runTestsByPath",
        "test/supply-chain/r3-req-04-medium-cleared.test.ts",
    ], {
        cwd: repoRoot, encoding: "utf8", timeout: 30_000,
        env: {...process.env, SUPPLY_CHAIN_ONLINE: "1",
            npm_config_registry: "http://127.0.0.1:1",
            npm_config_fetch_retries: "0", npm_config_fetch_timeout: "1000"},
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FAIL");
}, 35_000);

// A temporary npm executable emits protocol fixtures. These check the real
// gate's assertions and child-process plumbing, not registry advisory accuracy.
const runWithFakeNpm = (output: string, status: string, args: string[]) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-supply-"));
    try {
        const emitter = path.join(directory, "emit.cjs");
        fs.writeFileSync(emitter, "process.stdout.write(process.env.FIXTURE_OUTPUT); process.exit(Number(process.env.FIXTURE_STATUS));");
        const windows = process.platform === "win32";
        fs.writeFileSync(path.join(directory, windows ? "npm.cmd" : "npm"), windows
            ? `@echo off\r\n"${process.execPath}" "${emitter}"\r\n`
            : `#!/bin/sh\nexec '${process.execPath}' '${emitter}'\n`, {mode: 0o755});
        const environment = {...process.env};
        // Windows environment names are case insensitive; avoid duplicate Path/PATH.
        const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") || "PATH";
        environment[pathKey] = directory + path.delimiter + environment[pathKey];
        return spawnSync(process.execPath, args, {cwd: repoRoot, encoding: "utf8", timeout: 30_000,
            env: {...environment, SUPPLY_CHAIN_ONLINE: "1", FIXTURE_OUTPUT: output, FIXTURE_STATUS: status}});
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
};

test.each([
    ["empty npm ls output", "r3-req-02-crypto-js-removed", "", "0"],
    ["vulnerable audit", "r3-req-04-medium-cleared", JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {lodash: {name: "lodash", severity: "critical", via: [{source: 1, name: "lodash", dependency: "lodash", title: "fixture",
            url: "https://github.com/advisories/GHSA-4444-5555-6666", severity: "critical", range: "*"}]}},
        metadata: {vulnerabilities: {info: 0, low: 0, moderate: 0, high: 0, critical: 1, total: 1}},
    }), "1"],
    ["CRITICAL advisory in the report command", "critical-report", JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {"fixture-critical": {severity: "critical"}},
        metadata: {vulnerabilities: {info: 0, low: 0, moderate: 0, high: 0, critical: 1, total: 1}},
    }), "1"],
    ["report-only HIGH advisory", "admin-report", JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {"fixture-high": {severity: "high"}},
        metadata: {vulnerabilities: {info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1}},
    }), "1"],
])("blocks %s in the actual gate", (_label, suite, output, status) => {
    const result = runWithFakeNpm(output, status, suite === "admin-report" || suite === "critical-report" ? [
        path.join(repoRoot, "scripts/supply-chain-gate.cjs"), "--high-report",
    ] : [
        path.join(repoRoot, "node_modules/jest/bin/jest.js"), "--runInBand", "--runTestsByPath",
        `test/supply-chain/${suite}.test.ts`,
    ]);
    expect(result.error).toBeUndefined();
    if(suite === "admin-report") {
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("::warning::HIGH advisories (report only): fixture-high");
        return;
    }
    if(suite === "critical-report") {
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("CRITICAL advisories: fixture-critical");
        return;
    }
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FAIL");
    expect(result.stderr).toContain(suite === "r3-req-02-crypto-js-removed"
        ? "empty output" : "lodash GHSA-4444-5555-6666");
}, 35_000);

// #293: 서버 판정 명령(--server-gate)은 moderate 수준으로 판정하고, 막을 때 종료 코드 1 과 사유를 낸다.
// 예외로 통과한 권고는 ::warning:: 으로 남긴다(단위 판정은 reviewed-advisories.test.ts 가 본다).
const runServerGate = (output: string, status: string) =>
    runWithFakeNpm(output, status, [path.join(repoRoot, "scripts/supply-chain-gate.cjs"), "--server-gate"]);

test("the server gate CLI blocks an unreviewed moderate advisory with its reason", () => {
    const result = runServerGate(JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {lodash: {name: "lodash", severity: "moderate", via: [{source: 1, name: "lodash", dependency: "lodash", title: "fixture",
            url: "https://github.com/advisories/GHSA-1111-2222-3333", severity: "moderate", range: "*"}]}},
        metadata: {vulnerabilities: {info: 0, low: 0, moderate: 1, high: 0, critical: 0, total: 1}},
    }), "1");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Blocked server advisories: lodash GHSA-1111-2222-3333");
}, 35_000);

test("the server gate CLI passes a clean report", () => {
    const result = runServerGate(JSON.stringify({auditReportVersion: 2, vulnerabilities: {},
        metadata: {vulnerabilities: {info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0}}}), "0");
    expect({status: result.status, stdout: result.stdout.trim()}).toEqual({status: 0, stdout: "No blocked server advisories"});
}, 35_000);
