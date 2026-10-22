import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {spawnSync} from "child_process";

// #207 REQ-4: 설정 오류 종료는 로그를 끝까지 쓰고, 데몬 자식이면 표시 파일을 남긴다.
const driver = path.resolve(process.cwd(), "test", "helpers", "configExitDriver.ts");
const tsNode = require.resolve("ts-node/dist/bin.js");

describe("exitWithConfigError (#207)", () => {
    let root: string;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-config-exit-"));
        fs.mkdirSync(path.join(root, "bin"));
    });
    afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

    const run = (env: {[key: string]: string | undefined}) => {
        const childEnv = {...process.env, ...env};
        if(env.EXECUTE_MODE === undefined) delete childEnv.EXECUTE_MODE;
        return spawnSync(process.execPath, [tsNode, "-T", driver, root, "78"], {env: childEnv, encoding: "utf-8", timeout: 60_000});
    };
    const bootLog = (): string => fs.readdirSync(path.join(root, "logs")).filter(f => f.startsWith("boot-"))
        .map(f => fs.readFileSync(path.join(root, "logs", f), "utf-8")).join("");

    test("exits with the given code after the last log line reaches the file, and writes stderr", () => {
        const result = run({EXECUTE_MODE: undefined});
        expect(result.status).toBe(78);
        expect(result.stderr).toContain("LAST-CONFIG-ERROR-LINE");
        const log = bootLog();
        expect(log).toContain("filler-299");
        expect(log).toContain("LAST-CONFIG-ERROR-LINE");
        expect(fs.existsSync(path.join(root, "bin", ".config_error"))).toBe(false);
    });

    test("a daemon app child leaves the config error marker for the sentinel", () => {
        const result = run({EXECUTE_MODE: "execute"});
        expect(result.status).toBe(78);
        expect(fs.readFileSync(path.join(root, "bin", ".config_error"), "utf-8")).toContain("LAST-CONFIG-ERROR-LINE");
    });
});
