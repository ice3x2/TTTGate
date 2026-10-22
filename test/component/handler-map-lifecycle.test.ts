import {spawnSync} from "child_process";
import * as path from "path";

test.each(["control", "http-end", "http-destroy", "http-error", "http-close"])(
    "TCPServer releases closed handlers after %s callback replacement (#26/#27)", (mode) => {
        const result = spawnSync(process.execPath, ["-r", "ts-node/register/transpile-only",
            path.join(__dirname, "handler-map-lifecycle-driver.ts"), mode], {
            cwd: path.resolve(__dirname, "../.."), encoding: "utf8", timeout: 15_000,
        });
        expect(result.error).toBeUndefined();
        expect({status: result.status, stderr: result.status === 0 ? "" : result.stderr}).toEqual({status: 0, stderr: ""});
        expect(result.stdout).toContain(`RESULT ${mode} closed=0 live-retained=1`);
        if(mode === "http-error") expect(result.stderr).toContain("intentional socket failure fixture");
        else expect(result.stderr).toBe("");
    }, 20_000);
