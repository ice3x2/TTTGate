import {spawnSync} from "child_process";
import path from "path";

test.each(["last-drain", "followers", "survivor", "short-read", "success"])(
    "real cache/socket ownership remains accurate (%s)", (mode) => {
        const result = spawnSync(process.execPath, ["-r", "ts-node/register/transpile-only",
            path.join(__dirname, "cache-read-failure-driver.ts"), mode], {
            cwd: path.resolve(__dirname, "../.."), encoding: "utf8", timeout: 25_000,
        });
        expect(result.error).toBeUndefined();
        expect({status: result.status, stderr: result.status === 0 ? "" : result.stderr}).toEqual({status: 0, stderr: ""});
        const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith("RESULT "));
        expect(line).toBeDefined();
        const report = JSON.parse(line!.slice(7));
        if(mode === "last-drain") expect(report.drains).toEqual([false]);
        if(mode === "survivor") {
            expect(report.survivorBytes).toBe(8192);
            expect(report.globalBytes).toBe(report.survivorBytes);
            expect(report.survivorLive).toBe(true);
        }
        const successful = mode === "success";
        expect(report.writes.map((write: any) => [write.label, write.success])).toEqual([
            ["prefix", true], ["current", successful],
            ...(mode === "followers" || successful ? [["follower", successful]] : []),
        ]);
        if(!successful) expect(report.writes[1].error).toBe(true);
        expect(report.drains).toEqual([successful]);
        expect(report.sendLength).toBe(128 * 1024 + (successful ? 4096 + 6144 : 0));
        expect(report.pending).toBe(0);
        expect(report.cacheBytes).toBe(0);
        expect(report.ended).toBe(!successful);
        expect(report.ownerRetained).toBe(successful);
        expect(report.payloadValid).toBe(true);
    }, 30_000);
