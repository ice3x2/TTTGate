import * as fs from "fs";
import * as path from "path";
import Sentinel from "../../src/Sentinel";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../helpers/runtime";
import {clearConfigErrorMarker, configErrorMarkerPath} from "../../src/util/ConfigExit";

// #207 REQ-5·REQ-7: 설정 오류 표시 파일이 있으면 다시 시작하지 않는다. 없으면 지금처럼 다시 시작한다.
describe("Sentinel restart decision (#207)", () => {
    let root: TestRoot;
    beforeEach(async () => {
        root = await createTestRoot("sentinel-decision");
        fs.mkdirSync(path.join(root.rootDir, "bin"));
        applyTestRoot(root.rootDir);
    });
    afterEach(async () => cleanupTestRoot(root));

    test("an app that ended without a marker is restarted", () => {
        expect(Sentinel.shouldRestartApp()).toBe(true);
    });

    test("an app that ended with a config error is not restarted", () => {
        fs.writeFileSync(configErrorMarkerPath(), "78 bad config\n");
        expect(Sentinel.shouldRestartApp()).toBe(false);
    });

    test("clearConfigErrorMarker removes the marker and tolerates a missing one", () => {
        fs.writeFileSync(configErrorMarkerPath(), "78\n");
        clearConfigErrorMarker();
        expect(fs.existsSync(configErrorMarkerPath())).toBe(false);
        expect(() => clearConfigErrorMarker()).not.toThrow();
    });

    test("isProcessAlive answers from the pid alone (no process table query)", async () => {
        expect(Sentinel.isProcessAlive(process.pid)).toBe(true);
        const {spawnSync} = require("child_process");
        const gone = spawnSync(process.execPath, ["-e", "0"]);
        expect(Sentinel.isProcessAlive(gone.pid)).toBe(false);
        expect(Sentinel.isProcessAlive(0)).toBe(false);
        expect(Sentinel.isProcessAlive(Number.NaN)).toBe(false);
    });
});
