import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {spawnSync} from "child_process";

const repoRoot = path.resolve(__dirname, "../..");
const runChild = (mode: string) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-sentinel-"));
    const journal = path.join(directory, "events.jsonl");
    try {
        const result = spawnSync(process.execPath, ["-r", "ts-node/register/transpile-only",
            path.join(__dirname, "sentinel-exit-driver.cjs"), journal, mode], {
            cwd: repoRoot, encoding: "utf8", timeout: 12_000,
        });
        expect(result.error).toBeUndefined();
        expect(fs.existsSync(journal)).toBe(true);
        const events = fs.readFileSync(journal, "utf8").trim().split("\n").map((line) => JSON.parse(line));
        return {result, events};
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
};

test("lookup failure exits the sentinel child with status 1 without sending signals", () => {
    const {result, events} = runChild("failure");
    expect(events.filter((event) => event.kind === "lookup")).toEqual([
        {kind: "lookup", lookupKind: "pid", pid: result.pid},
    ]);
    expect(events.filter((event) => event.kind === "signal")).toEqual([]);
    expect(events).not.toContainEqual({kind: "watchdog"});
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(events).toContainEqual({kind: "exit", code: 1});
    expect(result.stdout + result.stderr).toContain("fixture-lookup-failure");
}, 15_000);

test("a present application remains monitored for a second real polling interval", () => {
    const {result, events} = runChild("present");
    expect(events.filter((event) => event.kind === "lookup")).toHaveLength(2);
    expect(events.filter((event) => event.kind === "signal")).toEqual([]);
    expect(events).not.toContainEqual({kind: "watchdog"});
    expect(result.status).toBe(0);
}, 15_000);
