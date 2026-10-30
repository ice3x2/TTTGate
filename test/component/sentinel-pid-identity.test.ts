jest.setTimeout(60_000);

import * as fs from "fs";
import * as path from "path";
import {spawn, ChildProcess} from "child_process";
import Sentinel from "../../src/Sentinel";
import Environment from "../../src/Environment";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../helpers/runtime";
import LoggerFactory from "../../src/util/logger/LoggerFactory";

const pidFile = (name: "app" | "sentinel" | "foreground") => path.join(Environment.path.binDir, `.pid_${name}`);
const pidLines = (name: "app" | "sentinel" | "foreground"): string[] =>
    fs.existsSync(pidFile(name)) ? fs.readFileSync(pidFile(name), "utf-8").split("\n").filter((line) => line.trim() !== "") : [];

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (check: () => boolean, timeoutMs: number): Promise<boolean> => {
    const until = Date.now() + timeoutMs;
    while(Date.now() < until) { if(check()) return true; await new Promise((resolve) => setTimeout(resolve, 100)); }
    return check();
};

/** TTTGate 와 다른 실행 파일로 오래 도는 프로세스(재사용된 PID 를 흉내 낸다). */
const spawnUnrelated = (): ChildProcess => process.platform === "win32"
    ? spawn("ping", ["-n", "120", "127.0.0.1"], {stdio: "ignore", windowsHide: true})
    : spawn("sleep", ["120"], {stdio: "ignore"});
/** 이 플랫폼에서 오래 도는 실행 파일의 경로(다른 이름의 폴더로 복사해 쓴다). */
const longRunnerPath = (): string => process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "PING.EXE") : "/bin/sleep";
const longRunnerArgs = (): string[] => process.platform === "win32" ? ["-n", "120", "127.0.0.1"] : ["120"];
const spawnNode = (): ChildProcess => spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
const spawned = (child: ChildProcess): Promise<number> => new Promise((resolve, reject) => {
    child.once("spawn", () => resolve(child.pid!));
    child.once("error", reject);
});

// #256 — PID 파일에는 지금 살아 있는 자기 프로세스 하나만 남고, stop 은 확인한 TTTGate 프로세스만 끝낸다.
describe("Sentinel pid files (#256)", () => {
    let root: TestRoot;
    let originalArgv: string[];
    let originalExitCode: typeof process.exitCode;
    const children: ChildProcess[] = [];

    beforeEach(async () => {
        root = await createTestRoot("sentinel-pid-identity");
        fs.mkdirSync(path.join(root.rootDir, "bin"));
        applyTestRoot(root.rootDir);
        originalArgv = process.argv;
        process.argv = [process.execPath, "app.js", "server"];
        // 거부된 데몬 부팅은 process.exitCode 를 1 로 둔다. 테스트마다 되돌리지 않으면 jest 프로세스가 실패로 끝난다.
        originalExitCode = process.exitCode;
    });
    afterEach(async () => {
        // 실행 파일을 지우기 전에 자식이 끝날 때까지 기다린다. Windows 는 실행 중인 파일을 지우지 못한다(EPERM).
        await Promise.all(children.splice(0).map(async (child) => {
            if(child.exitCode !== null || child.signalCode !== null) return;
            const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
            try { child.kill(); } catch { return; }
            await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5000).unref())]);
        }));
        process.argv = originalArgv;
        process.exitCode = originalExitCode;
        await cleanupTestRoot(root);
    });

    // REQ-1 / AC-1
    test("starting three times leaves exactly one pid entry, for the current process", () => {
        for(let n = 0; n < 3; n++) expect(Sentinel.create(false).start()).toBe(false);
        const lines = pidLines("foreground");
        expect(lines.length).toBe(1);
        expect(JSON.parse(lines[0])).toMatchObject({pid: process.pid});
    });

    // REQ-1 — 자기 항목은 OS 조회 없이 알아본다. 부하로 프로세스 조회가 시간 초과(unknown)여도 항목이 늘지 않는다.
    test("starting three times leaves one entry even when the process query fails", () => {
        const identity = jest.spyOn(Sentinel, "processIdentity").mockReturnValue(undefined);
        try {
            for(let n = 0; n < 3; n++) expect(Sentinel.create(false).start()).toBe(false);
        } finally {
            identity.mockRestore();
        }
        expect(pidLines("foreground")).toHaveLength(1);
    });

    // REQ-1 — 같은 PID 라도 시작 시각이 다르면(앞서 죽은 프로세스의 PID 재사용) 자기 항목이 아니다. 새 항목을 덧붙인다.
    test("an entry with the same pid but another start time is not taken as the current process", () => {
        fs.writeFileSync(path.join(root.rootDir, "bin", ".pid_foreground"),
            JSON.stringify({pid: process.pid, start: Date.now() - process.uptime() * 1000 - 3_600_000, exe: process.execPath}) + "\n");
        const identity = jest.spyOn(Sentinel, "processIdentity").mockReturnValue(undefined);
        try {
            expect(Sentinel.create(false).start()).toBe(false);
        } finally {
            identity.mockRestore();
        }
        expect(pidLines("foreground")).toHaveLength(2);
    });

    // REQ-2 / AC-2 — 예전 형식(숫자만)의 PID 를 다른 프로그램이 쓰고 있으면 끝내지 않는다.
    test("stop() does not kill a live process of another program whose pid is in a legacy pid file", async () => {
        const child = spawnUnrelated();
        children.push(child);
        const pid = await spawned(child);
        fs.writeFileSync(pidFile("app"), `${pid}\n`);
        Sentinel.stop();
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(alive(pid)).toBe(true);
        expect(pidLines("app")).toEqual([]);
    });

    // REQ-2 — 새 형식인데 시작 시각이 다르면(PID 가 재사용됨) 같은 실행 파일이어도 끝내지 않는다.
    test("stop() does not kill a process whose start time differs from the recorded one", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        fs.writeFileSync(pidFile("app"), JSON.stringify({pid, start: Date.now() - 3_600_000}) + "\n");
        Sentinel.stop();
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(alive(pid)).toBe(true);
    });

    // REQ-3 — 기록한 그 프로세스는 끝낸다.
    test("stop() kills the recorded process when its identity matches", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        const identity = Sentinel.processIdentity(pid);
        expect(identity?.start).toBeDefined();
        fs.writeFileSync(pidFile("app"), JSON.stringify({pid, start: identity!.start, exe: identity!.exe}) + "\n");
        Sentinel.stop();
        expect(await waitFor(() => !alive(pid), 5_000)).toBe(true);
    });

    // Linux 에서 실행 파일을 바꾸면(업그레이드) /proc/<pid>/exe 가 " (deleted)" 를 붙여 돌려준다.
    test("a replaced executable on Linux is compared without the ' (deleted)' suffix", () => {
        expect(Sentinel.normalizeExePath("/opt/tttgate/tttgate (deleted)")).toBe("/opt/tttgate/tttgate");
        expect(Sentinel.normalizeExePath("/opt/tttgate/tttgate")).toBe("/opt/tttgate/tttgate");
    });

    // 비ASCII 경로(예: 사용자 이름이 한글인 폴더)의 실행 파일도 경로를 그대로 읽는다(Windows PowerShell 출력 인코딩).
    test("the executable path of a process under a non-ASCII folder is read intact", async () => {
        const dir = path.join(root.rootDir, "한글 폴더");
        fs.mkdirSync(dir);
        const exe = path.join(dir, path.basename(longRunnerPath()));
        fs.copyFileSync(longRunnerPath(), exe);
        if(process.platform !== "win32") fs.chmodSync(exe, 0o755);
        const child = spawn(exe, longRunnerArgs(), {stdio: "ignore", windowsHide: true});
        children.push(child);
        const pid = await spawned(child);
        const identity = Sentinel.processIdentity(pid);
        expect(identity?.exe && path.resolve(identity.exe).toLowerCase()).toBe(path.resolve(exe).toLowerCase());
    });

    // 확인할 수 없는(알 수 없는) 살아 있는 항목은 끝내지 않고 파일에도 남긴다. 지우면 그 데몬을 다시는 멈출 수 없다.
    test("a live entry whose identity cannot be determined is neither killed nor dropped", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        fs.writeFileSync(pidFile("app"), JSON.stringify({pid, start: Date.now()}) + "\n");
        const identity = jest.spyOn(Sentinel, "processIdentity").mockReturnValue(undefined);
        try {
            Sentinel.stop();
        } finally { identity.mockRestore(); }
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(alive(pid)).toBe(true);
        expect(pidLines("app").map((line) => JSON.parse(line).pid)).toEqual([pid]);
    });

    // sentinel 은 app 이 사라지면 몇 초 뒤 다시 띄운다. app 을 먼저 끝내면 그 사이에 다시 뜰 수 있으므로 sentinel 을 먼저 끝낸다.
    test("stop() stops the sentinel before the app", () => {
        const order: string[] = [];
        const kill = jest.spyOn(Sentinel as any, "processKill").mockImplementation((type: unknown) => { order.push(String(type)); });
        try {
            Sentinel.stop();
        } finally { kill.mockRestore(); }
        expect(order.indexOf("sentinel")).toBeLessThan(order.indexOf("app"));
    });

    // 형식이 잘못된 필드는 버린다. start 가 숫자가 아니면 확인 없이 통과하던 길(fail-open)을 막는다.
    test("an entry with a malformed start is not trusted as verified", async () => {
        const child = spawnUnrelated();
        children.push(child);
        const pid = await spawned(child);
        fs.writeFileSync(pidFile("app"), JSON.stringify({pid, start: "x", exe: 42}) + "\n");
        expect(() => Sentinel.stop()).not.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(alive(pid)).toBe(true);
    });

    // Linux 는 벽시계 대신 /proc 의 시작 tick 을 기록하고 비교한다. 시계가 보정돼도(NTP) 같은 프로세스로 확인된다.
    (process.platform === "linux" ? test : test.skip)("on Linux the recorded start ticks decide, not the wall clock", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        const identity = Sentinel.processIdentity(pid)!;
        expect(identity.ticks).toBeDefined();
        // 벽시계 값은 크게 어긋나도(시계 보정) tick 이 같으면 그 프로세스다.
        fs.writeFileSync(pidFile("app"), JSON.stringify({pid, start: 1, ticks: identity.ticks}) + "\n");
        Sentinel.stop();
        expect(await waitFor(() => !alive(pid), 5_000)).toBe(true);
    });

    // 확인하지 못한 sentinel·app 이 살아 있으면 새 쌍을 띄우지 않는다(데몬이 둘이 되어 포트가 부딪친다).
    test("a daemon boot does not start a second pair while an unconfirmed sentinel is still alive", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        fs.writeFileSync(pidFile("sentinel"), JSON.stringify({pid, start: Date.now()}) + "\n");
        const previousMode = process.env.EXECUTE_MODE;
        delete process.env.EXECUTE_MODE;
        process.argv = [process.execPath, "app.js", "server", "-daemon"];
        const identity = jest.spyOn(Sentinel, "processIdentity").mockReturnValue(undefined);
        const startAll = jest.spyOn(Sentinel.prototype as any, "startAllProcess").mockImplementation(() => undefined);
        try {
            Sentinel.create(false).start();
            expect(startAll).not.toHaveBeenCalled();
        } finally {
            identity.mockRestore();
            startAll.mockRestore();
            if(previousMode === undefined) delete process.env.EXECUTE_MODE; else process.env.EXECUTE_MODE = previousMode;
        }
        expect(alive(pid)).toBe(true);
        expect(pidLines("sentinel").map((line) => JSON.parse(line).pid)).toEqual([pid]);
    });

    /** 데몬 모드로 부팅하고, 새 쌍을 띄우려 했는지 돌려준다(실제로 띄우지는 않는다). */
    const bootDaemon = (): boolean => {
        const previousMode = process.env.EXECUTE_MODE;
        delete process.env.EXECUTE_MODE;
        process.argv = [process.execPath, "app.js", "server", "-daemon"];
        const startAll = jest.spyOn(Sentinel.prototype as any, "startAllProcess").mockImplementation(() => undefined);
        try {
            Sentinel.create(false).start();
            return startAll.mock.calls.length > 0;
        } finally {
            startAll.mockRestore();
            if(previousMode === undefined) delete process.env.EXECUTE_MODE; else process.env.EXECUTE_MODE = previousMode;
        }
    };

    /** process.kill 이 이 PID 에만 EPERM 을 던지게 한다(다른 사용자의 프로세스처럼). 실제 신호는 보내지 않는다. */
    const mockEperm = (foreignPid: number) => {
        const realKill = process.kill.bind(process);
        return jest.spyOn(process, "kill").mockImplementation(((pid: number, signal?: string | number) => {
            if(pid === foreignPid) throw Object.assign(new Error("kill EPERM"), {code: "EPERM"});
            return realKill(pid, signal as any);
        }) as typeof process.kill);
    };

    // 다른 사용자(또는 SYSTEM)가 다시 쓰는 PID(EPERM)이고 기록과 다르면, 끝낼 수도 없으니 버리고 부팅도 막지 않는다.
    test("an EPERM entry that does not match the recorded process is dropped and does not block a daemon boot", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        fs.writeFileSync(pidFile("sentinel"), JSON.stringify({pid, start: Date.now() - 3_600_000}) + "\n");
        const kill = mockEperm(pid);
        try {
            expect(bootDaemon()).toBe(true);
        } finally { kill.mockRestore(); }
        expect(pidLines("sentinel")).toEqual([]);
    });

    // 다른 사용자(관리자·root)로 띄운, 기록과 같은 데몬이면 기록을 남기고 부팅을 거부한다(그 사용자로 멈춰야 한다).
    test("an EPERM entry that matches the recorded process is kept and blocks a daemon boot", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        const identity = Sentinel.processIdentity(pid)!;
        fs.writeFileSync(pidFile("sentinel"), JSON.stringify({pid, start: identity.start, ticks: identity.ticks}) + "\n");
        const kill = mockEperm(pid);
        try {
            Sentinel.stop();
            expect(pidLines("sentinel").map((line) => JSON.parse(line).pid)).toEqual([pid]);
            expect(bootDaemon()).toBe(false);
        } finally { kill.mockRestore(); }
        expect(alive(pid)).toBe(true);
    });

    // EPERM 이고 확인할 수 없으면(Windows 의 권한 밖 프로세스, Linux 예전 형식) 기록은 남기되 부팅은 막지 않는다.
    test("an EPERM entry that cannot be confirmed is kept but does not block a daemon boot", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        fs.writeFileSync(pidFile("app"), JSON.stringify({pid, start: Date.now()}) + "\n");
        const kill = mockEperm(pid);
        const identity = jest.spyOn(Sentinel, "processIdentity").mockReturnValue(undefined);
        const warn = jest.spyOn(LoggerFactory.getLogger("boot", "Sentinel"), "warn");
        try {
            expect(bootDaemon()).toBe(true);
            // 새 쌍을 띄우지만, 다른 사용자의 TTTGate 일 수 있다고 알린다.
            expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain("starting a new pair anyway");
        } finally { kill.mockRestore(); identity.mockRestore(); warn.mockRestore(); }
        expect(pidLines("app").map((line) => JSON.parse(line).pid)).toEqual([pid]);
    });

    // Linux 의 PID 1(root 의 init)은 일반 사용자가 신호를 보낼 수도 /proc/1/exe 를 읽을 수도 없다. 예전 형식 항목이 그 PID 여도 부팅이 막히지 않는다.
    // PID 1 이 같은 사용자의 프로세스인 환경(컨테이너 안)에서는 돌리지 않고, 신호도 실제로 보내지 않는다.
    const pid1IsForeign = process.platform === "linux" && process.getuid?.() !== 0 &&
        (() => { try { return fs.statSync("/proc/1").uid !== process.getuid?.(); } catch { return false; } })();
    (pid1IsForeign ? test : test.skip)("on Linux a legacy entry for pid 1 does not block a daemon boot", () => {
        fs.writeFileSync(pidFile("app"), "1\n");
        const realKill = process.kill.bind(process);
        const kill = jest.spyOn(process, "kill").mockImplementation(((pid: number, signal?: string | number) => {
            if(pid === 1 && signal !== 0) throw new Error("test must not signal pid 1");
            return realKill(pid, signal as any);
        }) as typeof process.kill);
        try {
            expect(bootDaemon()).toBe(true);
        } finally { kill.mockRestore(); }
    });

    // 부팅을 거부할 때 무엇을 멈추고 무엇을 지울지 알 수 있게 PID 와 PID 파일 경로를 알린다.
    test("a refused daemon boot names the remaining pids and their pid files", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        fs.writeFileSync(pidFile("app"), JSON.stringify({pid, start: Date.now()}) + "\n");
        const identity = jest.spyOn(Sentinel, "processIdentity").mockReturnValue(undefined);
        const error = jest.spyOn(LoggerFactory.getLogger("boot", "Sentinel"), "error");
        try {
            expect(bootDaemon()).toBe(false);
            const messages = error.mock.calls.map((call) => String(call[0])).join("\n");
            expect(messages).toContain(String(pid));
            expect(messages).toContain(pidFile("app"));
        } finally { identity.mockRestore(); error.mockRestore(); }
    });

    // 확인하지 못한 foreground 서버가 살아 있어도 새 데몬 쌍을 띄우지 않는다(포트가 부딪친다).
    test("an unconfirmed live foreground server also blocks a daemon boot", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        fs.writeFileSync(pidFile("foreground"), JSON.stringify({pid, start: Date.now()}) + "\n");
        const identity = jest.spyOn(Sentinel, "processIdentity").mockReturnValue(undefined);
        try {
            expect(bootDaemon()).toBe(false);
        } finally { identity.mockRestore(); }
        expect(alive(pid)).toBe(true);
    });

    // 거부된 데몬 부팅은 실패로 끝난다(systemd·스크립트가 알 수 있게).
    test("a refused daemon boot sets a failing exit code", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        fs.writeFileSync(pidFile("app"), JSON.stringify({pid, start: Date.now()}) + "\n");
        const identity = jest.spyOn(Sentinel, "processIdentity").mockReturnValue(undefined);
        const previousExitCode = process.exitCode;
        try {
            expect(bootDaemon()).toBe(false);
            expect(process.exitCode).toBe(1);
        } finally { identity.mockRestore(); process.exitCode = previousExitCode; }
    });

    // PID 파일에 쓸 수 없어도 stop 이 예외로 죽지 않고, 경로를 담은 오류를 남기며 실패 코드로 끝난다.
    test("stop() reports an unwritable pid file instead of throwing", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        fs.writeFileSync(pidFile("app"), JSON.stringify({pid, start: Date.now()}) + "\n");
        const identity = jest.spyOn(Sentinel, "processIdentity").mockReturnValue(undefined);
        // Sentinel 과 같은 CommonJS 모듈 객체를 바꾼다(import * as 로 받은 객체는 속성을 바꿀 수 없다).
        const write = jest.spyOn(require("fs") as typeof fs, "writeFileSync").mockImplementation(() => { throw Object.assign(new Error("EACCES: permission denied"), {code: "EACCES"}); });
        const error = jest.spyOn(LoggerFactory.getLogger("boot", "Sentinel"), "error");
        const previousExitCode = process.exitCode;
        try {
            expect(() => Sentinel.stop()).not.toThrow();
            expect(error.mock.calls.map((call) => String(call[0])).join("\n")).toContain(pidFile("app"));
            expect(process.exitCode).toBe(1);
        } finally { identity.mockRestore(); write.mockRestore(); error.mockRestore(); process.exitCode = previousExitCode; }
        // 쓰기에 실패해도 남기려던 항목은 그대로다(지운 뒤 쓰지 않는다).
        expect(pidLines("app").map((line) => JSON.parse(line).pid)).toEqual([pid]);
    });

    // 예전(덧붙이기) 형식의 여러 줄 파일에서, 확인하지 못한 살아 있는 항목은 모두 남긴다.
    test("every unconfirmed live entry of a multi-line legacy pid file is kept", async () => {
        const first = spawnNode();
        const second = spawnNode();
        children.push(first, second);
        // 두 자식의 spawn 을 함께 기다린다(하나씩 기다리면 둘째의 이벤트를 놓칠 수 있다).
        const pids = await Promise.all([spawned(first), spawned(second)]);
        fs.writeFileSync(pidFile("app"), pids.join("\n") + "\n");
        const identity = jest.spyOn(Sentinel, "processIdentity").mockReturnValue(undefined);
        try {
            Sentinel.stop();
        } finally { identity.mockRestore(); }
        expect(pidLines("app").map((line) => JSON.parse(line).pid).sort()).toEqual([...pids].sort());
    });

    // node 로 운영할 때 예전 형식 항목은 실행 파일(node)만으로는 TTTGate 인지 알 수 없다.
    // Linux 에서는 실행 인자에 이 앱의 진입 스크립트가 있어야 한다.
    (process.platform === "linux" ? test : test.skip)("on Linux a legacy entry of a node process that is not running this app is not killed", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        fs.writeFileSync(pidFile("app"), `${pid}\n`);
        Sentinel.stop();
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(alive(pid)).toBe(true);
    });

    // pkg 바이너리에서는 진입 스크립트가 바이너리 안(/snapshot)이라, 사용자가 직접 띄운 서버의 실행 인자에 없다.
    // 실행 인자 검사는 node 로 실행할 때만 한다.
    test("in a packaged binary a legacy entry is matched by the executable alone", async () => {
        const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "server"], {stdio: "ignore"});
        children.push(child);
        const pid = await spawned(child);
        const processWithPkg = process as unknown as {pkg?: unknown};
        const previousArgv1 = process.argv[1];
        processWithPkg.pkg = {};
        process.argv[1] = "/snapshot/TTTGate/build/src/app.js";
        try {
            expect(Sentinel.matchRecordedProcess({pid})).toBe("match");
        } finally {
            delete processWithPkg.pkg;
            process.argv[1] = previousArgv1;
        }
    });

    // PID 파일을 읽지 못해도(권한) stop 이 예외로 죽지 않는다.
    test("stop() reports an unreadable pid file instead of throwing", () => {
        fs.writeFileSync(pidFile("app"), "123\n");
        // 원본을 먼저 잡아 둔다(바꾼 함수를 다시 부르면 끝없이 되돌아온다).
        const cjsFs = require("fs") as typeof fs;
        const realRead = cjsFs.readFileSync.bind(cjsFs);
        const read = jest.spyOn(cjsFs, "readFileSync").mockImplementation(((target: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
            if(String(target).endsWith(".pid_app")) throw Object.assign(new Error("EACCES: permission denied"), {code: "EACCES"});
            return realRead(target, ...(rest as [any]));
        }) as typeof fs.readFileSync);
        const previousExitCode = process.exitCode;
        try {
            expect(() => Sentinel.stop()).not.toThrow();
            expect(process.exitCode).toBe(1);
        } finally { read.mockRestore(); process.exitCode = previousExitCode; }
    });

    // 서버와 클라이언트는 같은 foreground 파일을 쓴다. 다른 살아 있는 foreground 항목은 남기고 자기 항목을 더한다.
    test("starting in the foreground keeps another live foreground entry", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        fs.writeFileSync(pidFile("foreground"), JSON.stringify({pid, start: Date.now()}) + "\n");
        expect(Sentinel.create(false).start()).toBe(false);
        expect(pidLines("foreground").map((line) => JSON.parse(line).pid).sort()).toEqual([pid, process.pid].sort());
    });

    // 서버와 클라이언트가 동시에 뜨면 읽고-덮어쓰기는 한쪽 항목을 잃는다. foreground 는 덧붙이기만 한다.
    // 죽은 항목이 있어도 다시 쓰지 않는다(정리는 stop 과 데몬 부팅이 한다).
    test("starting in the foreground only appends its entry, even when a dead entry is present", async () => {
        const child = spawnNode();
        children.push(child);
        const pid = await spawned(child);
        fs.writeFileSync(pidFile("foreground"), JSON.stringify({pid, start: Date.now()}) + "\n" + JSON.stringify({pid: 2_000_003, start: 1}) + "\n");
        const cjsFs = require("fs") as typeof fs;
        const write = jest.spyOn(cjsFs, "writeFileSync");
        try {
            expect(Sentinel.create(false).start()).toBe(false);
            // appendFileSync 도 안에서 writeFileSync(flag 'a') 를 부른다. 덧붙이기가 아닌 쓰기(덮어쓰기)만 센다.
            const rewrites = write.mock.calls.filter((call) => String(call[0]).endsWith(".pid_foreground") &&
                (call[2] as {flag?: string} | undefined)?.flag !== "a");
            expect(rewrites).toEqual([]);
        } finally { write.mockRestore(); }
        expect(pidLines("foreground").map((line) => JSON.parse(line).pid).sort()).toEqual([pid, 2_000_003, process.pid].sort());
        // 죽은 항목은 stop 이 정리한다.
        const identity = jest.spyOn(Sentinel, "processIdentity").mockReturnValue(undefined);
        try { Sentinel.stop(); } finally { identity.mockRestore(); }
        expect(pidLines("foreground").map((line) => JSON.parse(line).pid).sort()).toEqual([pid, process.pid].sort());
    });

    // 손으로 고쳐 끝에 줄바꿈이 없는 파일에 덧붙여도 항목이 앞 줄과 붙지 않는다.
    test("appending to a pid file without a trailing newline keeps the entries on separate lines", () => {
        fs.writeFileSync(pidFile("foreground"), "2000004");
        expect(Sentinel.create(false).start()).toBe(false);
        expect(pidLines("foreground")).toEqual(["2000004", expect.stringContaining(`"pid":${process.pid}`)]);
    });

    // 앞서 죽은 foreground 프로세스와 같은 PID 를 받았으면(재사용), 옛 항목이 있어도 자기 항목을 덧붙인다.
    test("a new foreground process that reuses a recorded pid appends its own entry", () => {
        fs.writeFileSync(pidFile("foreground"), JSON.stringify({pid: process.pid, start: 1, ticks: 1}) + "\n");
        expect(Sentinel.create(false).start()).toBe(false);
        const entries = pidLines("foreground").map((line) => JSON.parse(line));
        expect(entries.length).toBe(2);
        expect(entries.every((entry) => entry.pid === process.pid)).toBe(true);
        expect(entries[1].start).toBeGreaterThan(1);
    });
});
