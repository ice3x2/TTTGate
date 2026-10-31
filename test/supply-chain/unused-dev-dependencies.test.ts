/**
 * #301 — 쓰지 않는 개발 의존성은 공급망 권고만 늘린다. 지운 패키지가 다시 들어오지 않게 지킨다.
 * NO-MOCK: 실 매니페스트와 잠금 파일.
 */
import {installedVersions, readRepoJson} from "../helpers/SupplyChainGate";

const REMOVED_DEV_DEPENDENCIES = ["rimraf"];

describe("removed unused development dependencies (#301)", () => {
    test.each(REMOVED_DEV_DEPENDENCIES)("package.json does not declare %s", (name) => {
        const manifest = readRepoJson("package.json");
        expect({...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies}[name]).toBeUndefined();
    });

    test.each(REMOVED_DEV_DEPENDENCIES)("the root lockfile does not install %s", (name) => {
        expect(installedVersions("package-lock.json", name)).toEqual([]);
    });
});
