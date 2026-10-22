jest.setTimeout(90_000);

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import YAML from "yaml";
import {getFreePort, spawnProcess, SpawnedProcess, waitUntil} from "../helpers/smokeProcess";
import {stopDaemon} from "../helpers/daemonCleanup";

const APP_JS = path.resolve(__dirname, "../../build/src/app.js");

/** 프로세스 경계에서 CLI 진입점을 검사한다(#204·#207·#208). */
describe("CLI entrypoint (process boundary)", () => {
    const children: SpawnedProcess[] = [];
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "cli-entry-"));
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
        // -daemon 테스트가 띄운 자식이 남지 않게 한다. 기록된 PID 가 끝났는지 확인하고, 남으면 끝낸 뒤 실패로 알린다(#227).
        const leftover = await stopDaemon(APP_JS, root);
        fs.rmSync(root, {recursive: true, force: true});
        expect(leftover).toEqual([]);
    });

    const run = async (args: string[], env: {[key: string]: string} = {}, timeoutMs = 20_000) => {
        const child = spawnProcess(process.execPath, [APP_JS, ...args], {cwd: root, env});
        children.push(child);
        const code = await child.waitForExit(timeoutMs);
        return {code, ...child.readChannel()};
    };
    const binFiles = () => fs.readdirSync(path.join(root, "bin"));

    describe("help and version (#208)", () => {
        test("--help prints the usage without the banner and leaves no pid or log files", async () => {
            const result = await run(["--help"]);
            expect(result.code).toBe(0);
            expect(result.stdout).toContain("Usage: TTTGate <server|client|stop> [options]");
            expect(result.stdout).not.toMatch(/^TTTGate v/m);
            expect(binFiles()).toEqual([]);
            expect(fs.existsSync(path.join(root, "logs"))).toBe(false);
        });

        test("client --help shows client options only and --version prints one line", async () => {
            const help = await run(["client", "--help"]);
            expect(help.code).toBe(0);
            expect(help.stdout).toContain("-addr <host:port>");
            expect(help.stdout).not.toContain("-adminPort");
            const version = await run(["--version"]);
            expect(version.code).toBe(0);
            expect(version.stdout.trim()).toMatch(/^TTTGate v\S+ \(\S+\)$/);
        });
    });

    describe("command-line errors exit with 2 (#204)", () => {
        test("an unknown option names the closest option", async () => {
            const result = await run(["client", "-adr", "x.com"]);
            expect(result.code).toBe(2);
            expect(result.stderr).toContain("Did you mean '-addr'?");
            expect(binFiles()).toEqual([]);
        });

        test("an unknown mode and options without a mode", async () => {
            expect((await run(["clinet"])).code).toBe(2);
            const daemonOnly = await run(["-daemon"]);
            expect(daemonOnly.code).toBe(2);
            expect(binFiles()).toEqual([]);
        });
    });

    describe("client commands (#214, #215)", () => {
        test("config show prints values with their source, hides secrets and writes nothing", async () => {
            fs.writeFileSync(path.join(root, "config", "client.yaml"), YAML.stringify({host: "gw.example.com", clientSecret: "yaml-secret"}));
            const result = await run(["client", "config", "show", "-addr", "tls://gw2:9300", "-clientId", "edge"]);
            expect(result.code).toBe(0);
            // 기계로 읽는 출력이므로 버전 배너를 붙이지 않는다.
            expect(result.stdout.split(/\r?\n/)[0]).not.toMatch(/^TTTGate v/);
            expect(result.stdout).toMatch(/host: gw2 +\(command line\)/);
            expect(result.stdout).toMatch(/tls: true +\(command line\)/);
            expect(result.stdout).toMatch(/clientSecret: \(hidden\) +\(client\.yaml\)/);
            expect(result.stdout).not.toContain("yaml-secret");
            expect(binFiles()).toEqual([]);
            expect(fs.existsSync(path.join(root, "logs"))).toBe(false);
        });

        test("REQ-6 config show reports insecure client.yaml fields instead of failing with 78", async () => {
            fs.writeFileSync(path.join(root, "config", "client.yaml"), YAML.stringify({host: "gw", allowInsecureTls: true}));
            const result = await run(["client", "config", "show"]);
            expect(result.code).toBe(0);
            expect(result.stdout + result.stderr).toContain("allowInsecureTls");
        });

        test("config save writes client.yaml without connecting", async () => {
            const result = await run(["client", "config", "save", "-addr", "gw:9300", "-clientId", "edge"]);
            expect(result.code).toBe(0);
            expect(YAML.parse(fs.readFileSync(path.join(root, "config", "client.yaml"), "utf-8"))).toMatchObject({host: "gw", port: 9300, clientId: "edge"});
            expect(binFiles()).toEqual([]);
        });

        test("client run is the same as client; join without --code and join with -daemon fail with 2 and spawn nothing", async () => {
            const help = await run(["client", "run", "--help"]);
            expect(help.code).toBe(0);
            expect((await run(["client", "join", "127.0.0.1:1"])).code).toBe(2);
            expect((await run(["client", "join", "127.0.0.1:1", "--code", "0000-0000-0000", "-daemon"])).code).toBe(2);
            expect(binFiles()).toEqual([]);
        });
    });

    describe("-daemon validates before spawning (#207)", () => {
        test("REQ-1 a bad command-line value exits with 2 and spawns nothing", async () => {
            const result = await run(["client", "-daemon", "-bufferLimit", "abc"]);
            expect(result.code).toBe(2);
            expect(result.stderr).toContain("-bufferLimit");
            expect(binFiles()).toEqual([]);
        });

        test("REQ-1 an insecure client.yaml exits with 78 and spawns nothing", async () => {
            fs.writeFileSync(path.join(root, "config", "client.yaml"), YAML.stringify({host: "127.0.0.1", allowInsecureTls: true}));
            const result = await run(["client", "-daemon"]);
            expect(result.code).toBe(78);
            expect(result.stderr).toContain("REFUSE-INSECURE-YAML");
            expect(binFiles()).toEqual([]);
        });

        test("REQ-2 the parent does not run -reset or -save", async () => {
            fs.writeFileSync(path.join(root, "config", "decoy.txt"), "keep");
            const server = await run(["server", "-daemon", "-reset", "-adminPort", "0"]);
            expect(server.code).toBe(1);
            expect(fs.existsSync(path.join(root, "config", "decoy.txt"))).toBe(true);

            const client = await run(["client", "-daemon", "-save", "-bufferLimit", "1"]);
            expect(client.code).toBe(2);
            expect(fs.existsSync(path.join(root, "config", "client.yaml"))).toBe(false);
            expect(binFiles()).toEqual([]);
        });

        test("REQ-1 a server.yaml that breaks the admin security policy fails in the parent with 1", async () => {
            fs.writeFileSync(path.join(root, "config", "server.yaml"), YAML.stringify({key: "k", port: 9126, adminPort: 9300,
                adminTls: false, adminBindHost: "127.0.0.1", tunnelingOptions: []}));
            const result = await run(["server", "-daemon"]);
            expect(result.code).toBe(1);
            expect(result.stderr).toContain("admin TLS is disabled");
            expect(binFiles()).toEqual([]);
        });

        test("a server option error does not print 'server started'", async () => {
            const result = await run(["server", "-adminPort", "70000"]);
            expect(result.code).toBe(1);
            expect(result.stdout).not.toContain("server started");
        });

        test("REQ-5 a sentinel whose app left the config error marker stops and removes the pid files", async () => {
            // 이미 끝난 앱 프로세스의 PID 를 쓴다.
            const gone = spawnProcess(process.execPath, ["-e", "0"]);
            await gone.waitForExit(10_000);
            const appPid = String(gone.child.pid);
            fs.writeFileSync(path.join(root, "bin", ".config_error"), "78 bad config\n");
            fs.writeFileSync(path.join(root, "bin", ".pid_app"), `${appPid}\n`);
            fs.writeFileSync(path.join(root, "bin", ".pid_sentinel"), "2147483645\n");
            const result = await run(["client", "-daemon"], {EXECUTE_MODE: "sentinel", APP_PID: appPid}, 30_000);
            expect(result.code).toBe(0);
            expect(fs.existsSync(path.join(root, "bin", ".pid_app"))).toBe(false);
            expect(fs.existsSync(path.join(root, "bin", ".pid_sentinel"))).toBe(false);
        });

        test("REQ-6 a new daemon start clears an old marker", async () => {
            fs.writeFileSync(path.join(root, "bin", ".config_error"), "78 old\n");
            const port = await getFreePort();
            const result = await run(["client", "-daemon", "-addr", `127.0.0.1:${port}`]);
            expect(result.code).toBe(0);
            expect(fs.existsSync(path.join(root, "bin", ".config_error"))).toBe(false);
            await waitUntil(async () => fs.existsSync(path.join(root, "bin", ".pid_sentinel")) ? true : undefined,
                {timeoutMs: 10_000, label: "sentinel pid"});
        });
    });
});
