jest.setTimeout(60_000);

import * as fs from "fs";
import * as path from "path";
import Sentinel from "../../src/Sentinel";
import Environment from "../../src/Environment";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../helpers/runtime";

const pidFile = (name: "app" | "foreground") => path.join(Environment.path.binDir, `.pid_${name}`);
const ownEntry = (extra: object = {}) => JSON.stringify({pid: process.pid, start: Date.now() - process.uptime() * 1000, exe: process.execPath, ...extra}) + "\n";

// #322 REQ-14 — PID 항목에 실행 모드를 넣고, status 가 살아 있는 TTTGate 를 찾는다.
describe("Sentinel run mode (#322)", () => {
    let root: TestRoot;
    let originalArgv: string[];

    beforeEach(async () => {
        root = await createTestRoot("sentinel-run-mode");
        fs.mkdirSync(path.join(root.rootDir, "bin"));
        applyTestRoot(root.rootDir);
        originalArgv = process.argv;
    });
    afterEach(async () => {
        process.argv = originalArgv;
        await cleanupTestRoot(root);
    });

    test("REQ-14 the foreground entry records the mode", () => {
        process.argv = [process.execPath, "app.js", "client", "-addr", "gw"];
        expect(Sentinel.create(false).start()).toBe(false);
        expect(JSON.parse(fs.readFileSync(pidFile("foreground"), "utf-8").trim())).toMatchObject({pid: process.pid, mode: "client"});
    });

    test("REQ-14 a spawned app entry records the mode of this command line", () => {
        process.argv = [process.execPath, "app.js", "server", "-daemon"];
        Sentinel.recordSpawnedPid(4242, "app");
        expect(JSON.parse(fs.readFileSync(pidFile("app"), "utf-8").trim())).toMatchObject({pid: 4242, mode: "server"});
    });

    test("REQ-13 findRunning prefers the daemon app entry and returns its mode", () => {
        fs.writeFileSync(pidFile("app"), ownEntry({mode: "server"}));
        expect(Sentinel.findRunning()).toEqual({pid: process.pid, mode: "server", daemon: true});
    });

    test("REQ-13 findRunning sees a foreground process", () => {
        fs.writeFileSync(pidFile("foreground"), ownEntry({mode: "client"}));
        expect(Sentinel.findRunning()).toEqual({pid: process.pid, mode: "client", daemon: false});
    });

    test("REQ-17 findAllRunning lists the daemon and the foreground process together", () => {
        fs.writeFileSync(pidFile("app"), ownEntry({mode: "client"}));
        fs.writeFileSync(pidFile("foreground"), ownEntry({mode: "server"}));
        expect(Sentinel.findAllRunning()).toEqual([
            {pid: process.pid, mode: "client", daemon: true},
            {pid: process.pid, mode: "server", daemon: false}
        ]);
        expect(Sentinel.findRunning()).toEqual({pid: process.pid, mode: "client", daemon: true});
    });

    test("REQ-14 an entry without a mode (older format) is running with an unknown mode", () => {
        fs.writeFileSync(pidFile("app"), ownEntry());
        expect(Sentinel.findRunning()).toEqual({pid: process.pid, mode: null, daemon: true});
    });

    test("REQ-13 a dead or reused pid is not running", () => {
        fs.writeFileSync(pidFile("app"), JSON.stringify({pid: 2147483646, start: Date.now(), mode: "server"}) + "\n");
        expect(Sentinel.findRunning()).toBeUndefined();
        // 같은 PID 라도 시작 시각이 한 시간 다르면 다른 프로세스다.
        fs.writeFileSync(pidFile("app"), ownEntry({start: Date.now() - process.uptime() * 1000 - 3_600_000, mode: "server"}));
        expect(Sentinel.findRunning()).toBeUndefined();
    });
});
