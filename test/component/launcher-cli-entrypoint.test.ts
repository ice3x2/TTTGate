jest.setTimeout(90_000);

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import YAML from "yaml";
import {spawn, spawnSync} from "child_process";
import {getFreePort, spawnProcess, SpawnedProcess, waitUntil} from "../helpers/smokeProcess";
import {stopDaemon} from "../helpers/daemonCleanup";

const APP_JS = path.resolve(__dirname, "../../build/src/app.js");

/** 런처가 부르는 명령을 프로세스 경계에서 검사한다(#322 REQ-13·15·16·17). */
describe("launcher commands (process boundary)", () => {
    const children: SpawnedProcess[] = [];
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-entry-"));
        fs.mkdirSync(path.join(root, "bin"));
        fs.mkdirSync(path.join(root, "config"));
    });

    afterEach(async () => {
        for(const child of children.splice(0)) {
            if(child.child.exitCode === null && child.child.signalCode === null) {
                child.kill("SIGKILL");
                await child.waitForExit(5000).catch(() => undefined);
            }
        }
        const leftover = await stopDaemon(APP_JS, root);
        fs.rmSync(root, {recursive: true, force: true});
        expect(leftover).toEqual([]);
    });

    const start = (args: string[]) => {
        const child = spawnProcess(process.execPath, [APP_JS, ...args], {cwd: root, env: {}});
        children.push(child);
        return child;
    };
    const run = async (args: string[]) => {
        const child = start(args);
        const code = await child.waitForExit(20_000);
        return {code, ...child.readChannel()};
    };
    const jsonLine = (stdout: string) => {
        const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
        expect(lines).toHaveLength(1);
        return JSON.parse(lines[0]);
    };

    test("REQ-13 status --json prints one JSON line, exits 3 and leaves no pid files", async () => {
        const result = await run(["status", "--json"]);
        expect(result.code).toBe(3);
        expect(jsonLine(result.stdout)).toMatchObject({running: false, mode: null, pid: null});
        expect(fs.readdirSync(path.join(root, "bin"))).toEqual([]);
    });

    test("REQ-15 status sees a foreground client and its connection state", async () => {
        const port = await getFreePort();
        const client = start(["client", "-addr", `127.0.0.1:${port}`, "-name", "edge"]);
        const status = await waitUntil(async () => {
            const result = await run(["status", "--json"]);
            const parsed = jsonLine(result.stdout);
            return result.code === 0 && parsed.client?.state === "reconnecting" ? parsed : null;
        }, {timeoutMs: 30_000, intervalMs: 300, label: "client status"});
        expect(status).toMatchObject({running: true, mode: "client", pid: client.child.pid, daemon: false, client: {state: "reconnecting"}});
        expect(status.client.failures).toBeGreaterThanOrEqual(1);
    });

    test("REQ-16 client join --json prints only the JSON result", async () => {
        const result = await run(["client", "join", "127.0.0.1:9", "--code", "short", "--json"]);
        expect(result.code).toBe(2);
        expect(jsonLine(result.stdout)).toMatchObject({ok: false, category: "argument"});
    });

    test("REQ-2 client join --code-stdin reads the code from standard input and never prints it", async () => {
        const port = await getFreePort();
        const code = "7Q4K-M2XP-AB01";
        const result = spawnSync(process.execPath, [APP_JS, "client", "join", `127.0.0.1:${port}`, "--code-stdin", "--json"],
            {cwd: root, input: `${code}\n`, encoding: "utf-8", timeout: 30_000});
        expect(result.status).toBe(1);
        expect(jsonLine(result.stdout)).toMatchObject({ok: false, category: "network"});
        expect(result.stdout + result.stderr).not.toContain(code);
        expect(result.stdout + result.stderr).not.toContain(code.replace(/-/g, ""));
    });

    test("REQ-2 client join --code-stdin waits for a producer that writes the code late", async () => {
        // Linux 에서 process.stdin 을 건드리면 파이프가 논블로킹이 되어, 늦게 온 입력에서 EAGAIN 으로 끝났다.
        const port = await getFreePort();
        const code = "7Q4K-M2XP-AB01";
        const child = spawn(process.execPath, [APP_JS, "client", "join", `127.0.0.1:${port}`, "--code-stdin", "--json"],
            {cwd: root, stdio: ["pipe", "pipe", "pipe"]});
        let stdout = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        const timer = setTimeout(() => { child.stdin.end(`${code}\n`); }, 3000);
        const exitCode = await new Promise<number | null>((resolve) => child.on("close", resolve));
        clearTimeout(timer);
        expect(exitCode).toBe(1);
        expect(jsonLine(stdout)).toMatchObject({ok: false, category: "network"});
    });

    test("REQ-17 server config save writes server.yaml and refuses a remote admin address without the flag", async () => {
        const saved = await run(["server", "config", "save", "-adminPort", "9400", "-controlPort", "9127"]);
        expect(saved.code).toBe(0);
        const yaml = YAML.parse(fs.readFileSync(path.join(root, "config", "server.yaml"), "utf-8"));
        expect(yaml).toMatchObject({adminPort: 9400, port: 9127});
        const refused = await run(["server", "config", "save", "-adminBindHost", "0.0.0.0"]);
        expect(refused.code).toBe(77);
        expect(refused.stderr).toContain("-allowLegacyAdminRemote");
        expect(fs.readdirSync(path.join(root, "bin"))).toEqual([]);
    });
});
