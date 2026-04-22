/**
 * R3-REQ-01 — node-forge >= 1.3.1 (GHSA 6건 HIGH 수정) 검증.
 * NO-MOCK: 실 package.json + 실 CACertGenerator API 호환성.
 */
import * as fs from "fs";
import * as path from "path";

const repoRoot = path.resolve(__dirname, "..", "..");

const parseVersion = (v: string): [number, number, number] => {
    const clean = v.replace(/^[\^~>=<\s]+/, "").split(/[\s|]/)[0];
    const parts = clean.split(".").map((x) => parseInt(x, 10));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
};

const atLeast = (actual: string, min: [number, number, number]): boolean => {
    const [a, b, c] = parseVersion(actual);
    const [x, y, z] = min;
    if(a !== x) return a > x;
    if(b !== y) return b > y;
    return c >= z;
};

describe("R3-REQ-01 node-forge minimum version", () => {
    test("package.json node-forge >= 1.3.1 (수정 버전)", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
        expect(pkg.dependencies["node-forge"]).toBeDefined();
        expect(atLeast(pkg.dependencies["node-forge"], [1, 3, 1])).toBe(true);
    });

    test("admin/package.json node-forge >= 1.3.1", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "admin", "package.json"), "utf8"));
        expect(pkg.dependencies["node-forge"]).toBeDefined();
        expect(atLeast(pkg.dependencies["node-forge"], [1, 3, 1])).toBe(true);
    });

    test("lockfile 전역에서 설치된 node-forge >= 1.3.1", () => {
        const lockPath = path.join(repoRoot, "package-lock.json");
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        const offenders: Array<{key: string; version: string}> = [];
        for(const [key, meta] of Object.entries<any>(lock.packages || {})) {
            if(!meta || typeof meta !== "object") continue;
            if(!key.includes("node-forge")) continue;
            if(!meta.version) continue;
            if(!atLeast(meta.version, [1, 3, 1])) offenders.push({key, version: meta.version});
        }
        expect(offenders).toEqual([]);
    });

    test("CACertGenerator API 호환성 — genCACert 호출 및 PEM 결과 회귀", async () => {
        const CACertGenerator = require("../../src/commons/CACertGenerator").default;
        const result = await CACertGenerator.genCACert({commonName: "TTTGate-R3-Test", bits: 2048});
        expect(result).toBeTruthy();
        expect(typeof result.key).toBe("string");
        expect(typeof result.cert).toBe("string");
        expect(typeof result.fingerprint).toBe("string");
        expect(result.cert).toContain("BEGIN CERTIFICATE");
        expect(result.key).toContain("PRIVATE KEY");
        expect(result.fingerprint.length).toBeGreaterThan(0);
    }, 30_000);
});
