/**
 * P3-T3 / REQ-02 — allowInsecureTls / allowLegacyFallback YAML 저장 금지
 *                   + --yes-insecure 게이트 검증.
 *
 * Mock 금지: 실 fs/yaml + child_process.spawn(ts-node driver).
 *
 * 시나리오:
 *  (1) 정상 save: loadClientOption(-save=...) 호출 시 YAML 파일에
 *      allowInsecureTls / allowLegacyFallback 필드가 기록되지 않는다.
 *  (2) load + no --yes-insecure: insecure 필드를 가진 YAML을 로드하면
 *      프로세스가 exit code 78로 종료된다. stderr에 REFUSE-INSECURE-YAML 포함.
 *  (3) load + --yes-insecure: 동일 YAML이지만 --yes-insecure 플래그로
 *      override, exit 0으로 로드 성공.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import YAML from "yaml";
import Environment from "../../../src/Environment";
import { __testInternals } from "../../../src/client/ClientApp";

// ts-node CLI 자체를 Node로 직접 실행 (Windows .cmd shim 회피)
const tsNodeEntry = resolve(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");
const driver = resolve(process.cwd(), "test", "helpers", "clientYamlGateDriver.ts");

describe("REQ-02 allowInsecureTls/allowLegacyFallback YAML gate", () => {
    let tmpRoot: string;

    beforeEach(() => {
        tmpRoot = mkdtempSync(join(tmpdir(), "req02-insecure-"));
        mkdirSync(join(tmpRoot, "config"), { recursive: true });
    });

    afterEach(() => {
        try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
        Environment.reset();
    });

    it("(1) -save 시 insecure 필드가 YAML에 기록되지 않는다", () => {
        Environment.configure({ rootDir: tmpRoot });
        __testInternals.loadClientOption({
            save: "",
            allowInsecureTls: "",
            allowLegacyFallback: "",
            key: "x",
            addr: "127.0.0.1:9126"
        });
        const yamlPath = join(tmpRoot, "config", __testInternals.CLIENT_OPTION_FILE_NAME);
        expect(existsSync(yamlPath)).toBe(true);
        const raw = readFileSync(yamlPath, "utf-8");
        const parsed: any = YAML.parse(raw);
        expect(parsed).toBeDefined();
        expect(parsed.allowInsecureTls).toBeUndefined();
        expect(parsed.allowLegacyFallback).toBeUndefined();
    });

    it("(2) insecure 필드를 가진 YAML 로드 시 --yes-insecure 없으면 exit 78", () => {
        // YAML 파일 직접 작성
        const yamlPath = join(tmpRoot, "config", __testInternals.CLIENT_OPTION_FILE_NAME);
        writeFileSync(yamlPath, YAML.stringify({
            key: "k", host: "127.0.0.1", port: 9126, tls: true, name: "n",
            globalMemCacheLimit: 128, keepAlive: 0,
            allowInsecureTls: true
        }), "utf-8");

        const res = spawnSync(process.execPath, [tsNodeEntry, driver, tmpRoot], {
            encoding: "utf-8",
            timeout: 60_000,
            env: { ...process.env, NODE_OPTIONS: "" }
        });
        expect(res.status).toBe(__testInternals.INSECURE_YAML_EXIT_CODE);
        expect(res.stderr + res.stdout).toContain("REFUSE-INSECURE-YAML");
    });

    it("(2b) allowInsecureTls:false 는 게이트 트리거하지 않음 (--yes-insecure 없이 exit 0)", () => {
        const yamlPath = join(tmpRoot, "config", __testInternals.CLIENT_OPTION_FILE_NAME);
        writeFileSync(yamlPath, YAML.stringify({
            key: "k", host: "127.0.0.1", port: 9126, tls: true, name: "n",
            globalMemCacheLimit: 128, keepAlive: 0,
            allowInsecureTls: false,
            allowLegacyFallback: false
        }), "utf-8");

        const res = spawnSync(process.execPath, [tsNodeEntry, driver, tmpRoot], {
            encoding: "utf-8",
            timeout: 60_000,
            env: { ...process.env, NODE_OPTIONS: "" }
        });
        expect(res.status).toBe(0);
        expect(res.stderr + res.stdout).not.toContain("REFUSE-INSECURE-YAML");
    });

    it("(2c) allowInsecureTls:null 도 게이트 트리거하지 않음", () => {
        const yamlPath = join(tmpRoot, "config", __testInternals.CLIENT_OPTION_FILE_NAME);
        // null 값 직접 기록
        writeFileSync(yamlPath, [
            "key: k",
            "host: 127.0.0.1",
            "port: 9126",
            "tls: true",
            "name: n",
            "globalMemCacheLimit: 128",
            "keepAlive: 0",
            "allowInsecureTls: null",
            "allowLegacyFallback: null"
        ].join("\n"), "utf-8");

        const res = spawnSync(process.execPath, [tsNodeEntry, driver, tmpRoot], {
            encoding: "utf-8",
            timeout: 60_000,
            env: { ...process.env, NODE_OPTIONS: "" }
        });
        expect(res.status).toBe(0);
    });

    it("(2d) allowInsecureTls:\"false\" 문자열도 게이트 트리거하지 않음", () => {
        const yamlPath = join(tmpRoot, "config", __testInternals.CLIENT_OPTION_FILE_NAME);
        writeFileSync(yamlPath, [
            "key: k",
            "host: 127.0.0.1",
            "port: 9126",
            "tls: true",
            "name: n",
            "globalMemCacheLimit: 128",
            "keepAlive: 0",
            "allowInsecureTls: \"false\""
        ].join("\n"), "utf-8");

        const res = spawnSync(process.execPath, [tsNodeEntry, driver, tmpRoot], {
            encoding: "utf-8",
            timeout: 60_000,
            env: { ...process.env, NODE_OPTIONS: "" }
        });
        expect(res.status).toBe(0);
    });

    it("(3) --yes-insecure 플래그가 있으면 insecure YAML 로드 허용", () => {
        const yamlPath = join(tmpRoot, "config", __testInternals.CLIENT_OPTION_FILE_NAME);
        writeFileSync(yamlPath, YAML.stringify({
            key: "k", host: "127.0.0.1", port: 9126, tls: true, name: "n",
            globalMemCacheLimit: 128, keepAlive: 0,
            allowInsecureTls: true, allowLegacyFallback: true
        }), "utf-8");

        const res = spawnSync(process.execPath, [tsNodeEntry, driver, tmpRoot, "--yes-insecure"], {
            encoding: "utf-8",
            timeout: 60_000,
            env: { ...process.env, NODE_OPTIONS: "" }
        });
        expect(res.status).toBe(0);
        // stdout은 드라이버의 JSON 출력
        const out = res.stdout.trim().split(/\r?\n/).pop() ?? "";
        const parsed = JSON.parse(out);
        expect(parsed.ok).toBe(true);
        expect(parsed.allowInsecureTls).toBe(true);
        expect(parsed.allowLegacyFallback).toBe(true);
    });
});
