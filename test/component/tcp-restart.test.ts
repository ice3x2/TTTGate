import {spawnSync} from "child_process";
import * as path from "path";

test.each(["cycles", "collision", "collision-callback", "close-callback"])(
    "TCPServer %s preserves lifecycle callbacks and process liveness", (mode) => {
        const result = spawnSync(process.execPath, ["-r", "ts-node/register/transpile-only",
            path.join(__dirname, "tcp-restart-driver.ts"), mode], {
            cwd: path.resolve(__dirname, "../.."), encoding: "utf8", timeout: 12_000,
        });
        expect(result.error).toBeUndefined();
        expect({status: result.status, stderr: result.stderr}).toEqual({status: 0, stderr: ""});
        const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith("RESULT "));
        expect(line).toBeDefined();
        const expected = mode === "cycles" ? {listen: 3, closed: 3, bound: 3, start: 3, stop: 3}
            : mode === "close-callback" ? {listen: 2, closed: 2, bound: 1, start: 2, stop: 2}
                : {listen: 2, closed: 3, bound: 1, start: mode === "collision-callback" ? 3 : 2, stop: 2};
        expect(JSON.parse(line!.slice(7))).toEqual({mode, ...expected});
    }, 15_000);
