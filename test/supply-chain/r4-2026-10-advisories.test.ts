/**
 * #293 — 2026-10 공급망 감사 실패. 수정 버전이 나온 HIGH 권고를 업그레이드로 푼다.
 * NO-MOCK: 실 매니페스트와 잠금 파일.
 *   - node-forge GHSA-86w9-cpqp-85rv (<= 1.4.0): 서버·관리 화면·소스 배포판
 *   - undici 7.30.1 미만: 바이너리 빌드 도구(@yao-pkg/pkg-fetch)가 Node 바이너리를 내려받을 때 쓴다(TLS 검증 우회 등)
 *   - vite 6.4.3 이하: 관리 화면 개발 서버
 */
import * as fs from "fs";
import * as path from "path";

const repoRoot = path.resolve(__dirname, "..", "..");
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf8"));
const gate = require("../../scripts/supply-chain-gate.cjs");

const numeric = (version: string): number => {
    const [major, minor, patch] = version.replace(/^[\^~>=<\s]+/, "").split(/[-+\s]/)[0].split(".").map((part) => parseInt(part, 10) || 0);
    return major * 1e6 + minor * 1e3 + patch;
};
/** 잠금 파일에서 그 패키지로 설치되는 모든 버전. */
const installed = (lockFile: string, name: string): string[] =>
    Object.entries<any>(readJson(lockFile).packages ?? {})
        .filter(([key]) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`))
        .map(([, meta]) => meta.version as string);

describe("2026-10 advisories are fixed by upgrades (#293)", () => {
    test.each(["package.json", "admin/package.json", "package-build.json"])("%s requires node-forge 1.4.2 or later", (file) => {
        const range = readJson(file).dependencies["node-forge"];
        expect(range).toMatch(/^\^/);
        expect(numeric(range)).toBeGreaterThanOrEqual(numeric("1.4.2"));
    });

    test.each(["package-lock.json", "admin/package-lock.json"])("%s installs node-forge 1.4.1 or later everywhere", (file) => {
        const versions = installed(file, "node-forge");
        expect(versions.length).toBeGreaterThan(0);
        for(const version of versions) expect({version, patched: numeric(version) >= numeric("1.4.1")}).toEqual({version, patched: true});
    });

    test("the root lockfile installs undici 7.30.1 or later everywhere", () => {
        const versions = installed("package-lock.json", "undici");
        expect(versions.length).toBeGreaterThan(0);
        for(const version of versions) expect({version, patched: numeric(version) >= numeric("7.30.1")}).toEqual({version, patched: true});
    });

    test("the admin lockfile installs vite 6.4.4 or later", () => {
        const versions = installed("admin/package-lock.json", "vite");
        expect(versions.length).toBeGreaterThan(0);
        for(const version of versions) expect({version, patched: numeric(version) >= numeric("6.4.4")}).toEqual({version, patched: true});
    });

    test("the node-forge advisory is no longer accepted as a reviewed exception", () => {
        expect(gate.REVIEWED_ADVISORIES.map((entry: {id: string}) => entry.id)).not.toContain("GHSA-86w9-cpqp-85rv");
    });
});
