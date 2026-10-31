/**
 * #300 — 2026-10-31 에 공개된 개발 의존성 권고. 상위 패키지(jest·test-exclude·rimraf)가 고친 주 버전을 받아들이지 않아
 * 루트 package.json 의 overrides 로 강제한다. NO-MOCK: 실 매니페스트와 잠금 파일.
 *   - glob GHSA-3g3m-2fjr-6pw4 (>= 9.0.0, <= 14.0.1)
 *   - minimatch GHSA-g3hv-75wg-m249 (< 11.0.1)
 */
import {installedVersions, numericVersion, readRepoJson} from "../helpers/SupplyChainGate";

// 상위 패키지(jest·test-exclude)가 이 버전 이상을 받아들이면 package.json 의 overrides 항목과 이 표를 지운다.
const FIXED_VERSIONS = [["glob", "14.0.2"], ["minimatch", "11.0.1"]];

describe("2026-11 development advisories are fixed by overrides (#300)", () => {
    // 프리릴리스(예: 14.0.2-rc.1)는 고친 버전보다 앞이다. 꼬리표를 버리고 비교하면 고친 것으로 잘못 본다.
    test("version comparison rejects prerelease versions", () => {
        expect(() => numericVersion("14.0.2-rc.1")).toThrow("prerelease");
        expect(numericVersion("^14.0.2")).toBe(numericVersion("14.0.2"));
    });

    test.each(FIXED_VERSIONS)("the root lockfile installs %s %s or later everywhere", (name, fixed) => {
        const versions = installedVersions("package-lock.json", name);
        expect(versions.length).toBeGreaterThan(0);
        for(const version of versions) expect({version, patched: numericVersion(version) >= numericVersion(fixed)}).toEqual({version, patched: true});
    });

    test.each(FIXED_VERSIONS)("the root overrides force %s %s or later", (name, fixed) => {
        const range = readRepoJson("package.json").overrides?.[name];
        expect(range).toMatch(/^\^/);
        expect(numericVersion(range)).toBeGreaterThanOrEqual(numericVersion(fixed));
    });
});
