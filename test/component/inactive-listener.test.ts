import {spawnSync} from "child_process";
import * as path from "path";

test.each(["startup", "timeout"])("inactive %s rejection preserves the process and session bookkeeping", (mode) => {
    const result = spawnSync(process.execPath, ["-r", "ts-node/register/transpile-only",
        path.join(__dirname, "inactive-listener-driver.ts"), mode], {
        cwd: path.resolve(__dirname, "../.."), encoding: "utf8", timeout: 15_000,
    });
    expect(result.error).toBeUndefined();
    expect({status: result.status, stderr: result.stderr}).toEqual({status: 0, stderr: ""});
    const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith("RESULT "));
    expect(line).toBeDefined();
    expect(JSON.parse(line!.slice(7))).toEqual({mode, rejectedSessions: 0, rejectedEvents: 0,
        rejectedTerminations: 0, acceptedSessions: 1, terminations: 1, finalSessions: 0, finalRegistered: 0});
}, 20_000);
