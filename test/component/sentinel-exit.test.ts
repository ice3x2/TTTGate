import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {spawnSync} from "child_process";

const repoRoot = path.resolve(__dirname, "../..");
const runChild = (mode: string, prepare?: (rootDir: string) => void) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-sentinel-"));
    const journal = path.join(directory, "events.jsonl");
    const rootDir = path.join(directory, "root");
    fs.mkdirSync(path.join(rootDir, "bin"), {recursive: true});
    prepare?.(rootDir);
    try {
        const result = spawnSync(process.execPath, ["-r", "ts-node/register/transpile-only",
            path.join(__dirname, "sentinel-exit-driver.cjs"), journal, mode, rootDir], {
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

test("an app that ended with a config error is not restarted: the sentinel removes the pid files and exits 0 (#207)", () => {
    let rootDir = "";
    const {result, events} = runChild("gone", (root) => {
        rootDir = root;
        fs.writeFileSync(path.join(root, "bin", ".config_error"), "78 fixture\n");
        fs.writeFileSync(path.join(root, "bin", ".pid_app"), "1\n");
        fs.writeFileSync(path.join(root, "bin", ".pid_sentinel"), "2\n");
    });
    expect(events.filter((event) => event.kind === "lookup")).toEqual([
        {kind: "lookup", lookupKind: "pid", pid: result.pid},
    ]);
    expect(events.filter((event) => event.kind === "signal")).toEqual([]);
    expect(events).not.toContainEqual({kind: "watchdog"});
    expect(result.status).toBe(0);
    expect(rootDir).not.toBe("");
}, 15_000);

test("a present application remains monitored for a second real polling interval", () => {
    const {result, events} = runChild("present");
    expect(events.filter((event) => event.kind === "lookup")).toHaveLength(2);
    expect(events.filter((event) => event.kind === "signal")).toEqual([]);
    expect(events).not.toContainEqual({kind: "watchdog"});
    expect(result.status).toBe(0);
}, 15_000);
