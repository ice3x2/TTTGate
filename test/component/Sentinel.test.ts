jest.setTimeout(120_000);

import * as fs from "fs";
import * as path from "path";
import {spawn, ChildProcess} from "child_process";
import Sentinel from "../../src/Sentinel";
import Environment from "../../src/Environment";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../helpers/runtime";

const DAEMON_CHILD_SCRIPT = path.resolve(__dirname, "sentinel-daemon-child.cjs");

const readPidFile = (name: "app" | "sentinel" | "foreground"): string | undefined => {
    const filePath = path.join(Environment.path.binDir, `.pid_${name}`);
    if(!fs.existsSync(filePath)) return undefined;
    return fs.readFileSync(filePath, "utf-8");
};
/** PID 파일의 pid 들(#256: 한 줄에 JSON 항목 하나). */
const pidsIn = (name: "app" | "sentinel" | "foreground"): number[] =>
    (readPidFile(name) ?? "").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line).pid);

const waitUntilProcessGone = async (pid: number, timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while(Date.now() < deadline) {
        try {
            process.kill(pid, 0);
        } catch {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`process ${pid} did not exit within ${timeoutMs}ms`);
};

const waitForChildExit = (child: ChildProcess, timeoutMs: number): Promise<void> => {
    if(child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`child ${child.pid} did not exit within ${timeoutMs}ms`)), timeoutMs);
        child.once("exit", () => {
            clearTimeout(timer);
            resolve();
        });
    });
};

describe("Sentinel", () => {
    let root: TestRoot;
    let originalArgv: string[];
    let originalExecuteMode: string | undefined;
    let originalJournal: string | undefined;
    const spawnedChildren: ChildProcess[] = [];

    beforeEach(async () => {
        root = await createTestRoot("sentinel");
        fs.mkdirSync(path.join(root.rootDir, "bin"));
        applyTestRoot(root.rootDir);
        originalArgv = process.argv;
        originalExecuteMode = process.env.EXECUTE_MODE;
        originalJournal = process.env.SENTINEL_TEST_JOURNAL;
    });

    afterEach(async () => {
        for(const child of spawnedChildren.splice(0)) {
            if(child.pid == undefined) continue;
            try {
                process.kill(child.pid, "SIGTERM");
            } catch { /* already dead */ }
            try {
                await waitUntilProcessGone(child.pid, 5000);
            } catch { /* best effort */ }
        }
        process.argv = originalArgv;
        if(originalExecuteMode == undefined) delete process.env.EXECUTE_MODE;
        else process.env.EXECUTE_MODE = originalExecuteMode;
        if(originalJournal == undefined) delete process.env.SENTINEL_TEST_JOURNAL;
        else process.env.SENTINEL_TEST_JOURNAL = originalJournal;
        await cleanupTestRoot(root);
    });

    // #256: 덧붙이지 않고 덮어쓴다. 다시 시작해도 항목은 하나다.
    test("without -daemon, start() returns false and records only the caller's pid in the foreground pid file", () => {
        process.argv = [process.execPath, "app.js", "server"];
        delete process.env.EXECUTE_MODE;

        expect(Sentinel.create(false).start()).toBe(false);
        expect(pidsIn("foreground")).toEqual([process.pid]);

        expect(Sentinel.create(false).start()).toBe(false);
        expect(pidsIn("foreground")).toEqual([process.pid]);
    });

    test("devMode create() builds the dev execute path without touching pid files, and start() still writes the foreground pid", () => {
        process.argv = [process.execPath, "app.js", "server"];
        delete process.env.EXECUTE_MODE;

        const sentinel = Sentinel.create(true);
        expect(sentinel).toBeInstanceOf(Sentinel);
        expect(sentinel.start()).toBe(false);
        expect(pidsIn("foreground")).toEqual([process.pid]);
    });

    test("stop() skips signalling its own pid and rewrites the pid file with that same pid", () => {
        fs.writeFileSync(path.join(root.rootDir, "bin", ".pid_foreground"), `${process.pid}\n`, {encoding: "utf-8"});

        Sentinel.stop();

        expect(pidsIn("foreground")).toEqual([process.pid]);
    });

    test("isDaemonMode/hasExecuteMode/isSentinelMode reflect argv and EXECUTE_MODE independently", () => {
        process.argv = [process.execPath, "app.js", "server"];
        delete process.env.EXECUTE_MODE;
        expect(Sentinel.isDaemonMode()).toBe(false);
        expect(Sentinel.hasExecuteMode()).toBe(false);
        expect(Sentinel.isSentinelMode()).toBe(false);

        process.argv = [process.execPath, "app.js", "server", "-daemon"];
        expect(Sentinel.isDaemonMode()).toBe(true);

        process.env.EXECUTE_MODE = "execute";
        expect(Sentinel.hasExecuteMode()).toBe(true);
        expect(Sentinel.isSentinelMode()).toBe(false);

        process.env.EXECUTE_MODE = "sentinel";
        expect(Sentinel.isSentinelMode()).toBe(true);
    });

    test("EXECUTE_MODE=execute with -daemon returns false via the no-op runApp path and writes no pid files", () => {
        process.argv = [process.execPath, "app.js", "server", "-daemon"];
        process.env.EXECUTE_MODE = "execute";

        expect(Sentinel.create(false).start()).toBe(false);
        expect(fs.readdirSync(path.join(root.rootDir, "bin"))).toEqual([]);
    });

    test("stop() kills only the pid recorded in the app pid file and clears every pid file", async () => {
        // 예전 형식 항목은 실행 파일과(Linux 는) 실행 인자에 이 앱의 진입 스크립트가 있어야 TTTGate 로 본다(#256). 실제 데몬처럼 넘긴다.
        const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", process.argv[1]], {stdio: "ignore"});
        spawnedChildren.push(child);
        await new Promise<void>((resolve, reject) => {
            child.once("spawn", () => resolve());
            child.once("error", reject);
        });
        fs.writeFileSync(path.join(root.rootDir, "bin", ".pid_app"), `not-a-pid\n${child.pid}\n`, {encoding: "utf-8"});

        Sentinel.stop();

        await waitForChildExit(child, 5000);
        expect(readPidFile("app")).toBeUndefined();
        expect(readPidFile("sentinel")).toBeUndefined();
        expect(readPidFile("foreground")).toBeUndefined();
    });

    test("EXECUTE_MODE undefined with -daemon boots real execute/sentinel children that journal their env and argv", async () => {
        const journalPath = path.join(root.rootDir, "journal.jsonl");
        process.env.SENTINEL_TEST_JOURNAL = journalPath;
        process.argv = [process.execPath, DAEMON_CHILD_SCRIPT, "server", "-daemon"];
        delete process.env.EXECUTE_MODE;

        const readJournalLines = async (min: number): Promise<string[]> => {
            const deadline = Date.now() + 5000;
            let lines: string[] = [];
            while(Date.now() < deadline) {
                if(fs.existsSync(journalPath)) {
                    lines = fs.readFileSync(journalPath, "utf-8").trim().split("\n").filter((l) => l.length > 0);
                    if(lines.length >= min) break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            return lines;
        };

        // 앱(execute)의 spawn 직후 sentinel 을 띄우므로 두 자식이 저널에 쓰는 순서는 보장되지 않는다(#195). mode 로 나눈다.
        const byMode = (pair: string[]) => {
            const records = pair.map((line) => JSON.parse(line));
            expect(records.map((record) => record.mode).sort()).toEqual(["execute", "sentinel"]);
            return {execute: records.find((record) => record.mode === "execute"), sentinel: records.find((record) => record.mode === "sentinel")};
        };

        expect(Sentinel.create(false).start()).toBe(true);

        let lines = await readJournalLines(2);
        expect(lines.length).toBe(2);

        const {execute: first, sentinel: second} = byMode(lines);
        // 아래 단언이 실패해도 afterEach 가 자식을 정리하도록 바로 등록한다.
        spawnedChildren.push({pid: first.pid} as ChildProcess, {pid: second.pid} as ChildProcess);
        expect(first.mode).toBe("execute");
        expect(first.appPid).toBe("0");
        expect(first.argv).toEqual(["server", "-daemon"]);
        expect(second.mode).toBe("sentinel");
        expect(second.appPid).toBe(String(first.pid));

        expect(pidsIn("app")).toEqual([first.pid]);
        expect(pidsIn("sentinel")).toEqual([second.pid]);

        // Boot again while the previous pair is still registered: exercises boot()'s
        // "already running" restart branch, which tears down the previous
        // app/sentinel/foreground pids before starting a fresh pair.
        fs.writeFileSync(path.join(root.rootDir, "bin", ".pid_foreground"), "2147483647\n", {encoding: "utf-8"});
        expect(Sentinel.create(false).start()).toBe(true);

        lines = await readJournalLines(4);
        expect(lines.length).toBe(4);
        const {execute: third, sentinel: fourth} = byMode(lines.slice(2));
        spawnedChildren.push({pid: third.pid} as ChildProcess, {pid: fourth.pid} as ChildProcess);
        expect(third.mode).toBe("execute");
        expect(fourth.mode).toBe("sentinel");

        await waitUntilProcessGone(first.pid, 5000);
        await waitUntilProcessGone(second.pid, 5000);

        Sentinel.stop();

        await waitUntilProcessGone(third.pid, 5000);
        await waitUntilProcessGone(fourth.pid, 5000);
    });
});
