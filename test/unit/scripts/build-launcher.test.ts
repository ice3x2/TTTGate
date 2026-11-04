import * as path from "path";
import {spawnSync} from "child_process";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {launcherBuildPlan, LAUNCHER_FILE_NAME} = require("../../../scripts/build-launcher.cjs");

const root = path.resolve(__dirname, "../../..");

// #322 REQ-11 Windows 런처를 dist/bin 에 넣는다.
describe("build-launcher", () => {
    test("on Windows it builds the locked release and copies it into the bin folder", () => {
        const plan = launcherBuildPlan("win32", root, path.join(root, "dist", "bin"));
        expect(plan).toEqual({
            skip: false,
            // rust-toolchain.toml 은 현재 폴더에서 찾으므로 그 폴더에서 cargo 를 실행한다.
            cwd: path.join(root, "launcher", "src-tauri"),
            cargoArgs: ["build", "--release", "--locked"],
            source: path.join(root, "launcher", "src-tauri", "target", "release", "TTTGate-launcher.exe"),
            target: path.join(root, "dist", "bin", LAUNCHER_FILE_NAME)
        });
        expect(LAUNCHER_FILE_NAME).toBe("TTTGate-launcher-win-x64.exe");
    });

    test("on other platforms it skips and says where the launcher is built", () => {
        expect(launcherBuildPlan("linux", root, "out")).toEqual({skip: true, reason: expect.stringContaining("Windows")});
        if(process.platform === "win32") return;
        const result = spawnSync(process.execPath, [path.join(root, "scripts", "build-launcher.cjs"), "out-not-created"], {encoding: "utf-8"});
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("skipped");
    });

    test("the npm script builds into the pkg output folder", () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        expect(require("../../../package.json").scripts["launcher:build"]).toBe("node scripts/build-launcher.cjs dist/bin");
    });

    test("the launcher version comes from package.json", () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        expect(require("../../../launcher/src-tauri/tauri.conf.json").version).toBe("../../package.json");
    });
});
