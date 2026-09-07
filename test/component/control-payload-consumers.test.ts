import {spawnSync} from "child_process";
import * as path from "path";

test.each(["server", "empty", "pending"])("malformed CloseSession keeps %s consumer alive and processes its valid tail", (mode) => {
    const result = spawnSync(process.execPath, ["-r", "ts-node/register/transpile-only",
        path.join(__dirname, "control-payload-driver.ts"), mode], {
        cwd: path.resolve(__dirname, "../.."), encoding: "utf8", timeout: 20_000,
        maxBuffer: 2 * 1024 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect({status: result.status, stderr: result.stderr}).toEqual({status: 0, stderr: ""});
    expect(result.stdout).toContain(mode === "server" ? "RESULT server-alive valid-tail" : "RESULT client-alive valid-tail");
    if(mode === "pending") expect(result.stdout).toContain("PENDING_OUTPUT_CONFIRMED");
}, 25_000);
