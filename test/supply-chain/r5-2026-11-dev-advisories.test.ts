/**
 * #300 — 2026-10-31 에 공개된 개발 의존성 권고. 상위 패키지(jest·test-exclude·rimraf)가 고친 주 버전을 받아들이지 않아
 * 루트 package.json 의 overrides 로 강제한다. NO-MOCK: 실 매니페스트와 잠금 파일.
 *   - glob GHSA-3g3m-2fjr-6pw4 (>= 9.0.0, <= 14.0.1)
 *   - minimatch GHSA-g3hv-75wg-m249 (< 11.0.1)
 */
import * as fs from "fs";
import * as path from "path";
import {installedVersions, numericVersion} from "../helpers/SupplyChainGate";

const rootManifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8"));

describe("2026-11 development advisories are fixed by overrides (#300)", () => {
    test.each([["glob", "14.0.2"], ["minimatch", "11.0.1"]])("the root lockfile installs %s %s or later everywhere", (name, fixed) => {
        const versions = installedVersions("package-lock.json", name);
        expect(versions.length).toBeGreaterThan(0);
        for(const version of versions) expect({version, patched: numericVersion(version) >= numericVersion(fixed)}).toEqual({version, patched: true});
    });

    test.each([["glob", "14.0.2"], ["minimatch", "11.0.1"]])("the root overrides force %s %s or later", (name, fixed) => {
        const range = rootManifest.overrides?.[name];
        expect(range).toMatch(/^\^/);
        expect(numericVersion(range)).toBeGreaterThanOrEqual(numericVersion(fixed));
    });
});
