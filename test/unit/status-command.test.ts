import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {buildStatus, runStatus, StatusDeps} from "../../src/StatusCommand";
import {writeClientStatus} from "../../src/client/ClientStatusFile";

// #322 REQ-13 TTTGate status [--json]
describe("status command", () => {
    let dir: string;
    let binDir: string;
    let configDir: string;
    let out: string[];
    const deps = (running?: {pid: number, mode: "server" | "client" | null, daemon: boolean}): StatusDeps =>
        ({findRunning: () => running, binDir, configDir, version: "2.1.0"});
    const io = () => ({out: (line: string) => out.push(line)});

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "status-command-"));
        binDir = path.join(dir, "bin");
        configDir = path.join(dir, "config");
        fs.mkdirSync(binDir);
        fs.mkdirSync(configDir);
        out = [];
    });
    afterEach(() => fs.rmSync(dir, {recursive: true, force: true}));

    test("AC-8 nothing running", () => {
        expect(buildStatus(deps())).toEqual({version: "2.1.0", running: false, mode: null, pid: null, daemon: false, client: null, server: null});
    });

    test("AC-8 a running client reports the status file of the same process only", () => {
        writeClientStatus(binDir, {state: "reconnecting", since: 10, failures: 3, pid: 500});
        expect(buildStatus(deps({pid: 500, mode: "client", daemon: true}))).toMatchObject(
            {running: true, mode: "client", pid: 500, daemon: true, client: {state: "reconnecting", since: 10, failures: 3}, server: null});
        // 앞서 죽은 클라이언트가 남긴 파일은 무시한다.
        expect(buildStatus(deps({pid: 501, mode: "client", daemon: true})).client).toBeNull();
    });

    test("AC-8 a running server reports the admin url and the bootstrap token file", () => {
        fs.writeFileSync(path.join(configDir, "server.yaml"), "adminPort: 9400\nadminBindHost: 0.0.0.0\nadminTls: true\nport: 9126\n");
        const status = buildStatus(deps({pid: 600, mode: "server", daemon: true}));
        expect(status.server).toEqual({adminUrl: "https://127.0.0.1:9400/", bootstrapRequired: false, bootstrapTokenFile: null});
        fs.writeFileSync(path.join(configDir, ".bootstrap-token"), "tok");
        expect(buildStatus(deps({pid: 600, mode: "server", daemon: true})).server).toEqual(
            {adminUrl: "https://127.0.0.1:9400/", bootstrapRequired: true, bootstrapTokenFile: path.join(configDir, ".bootstrap-token")});
    });

    test("AC-8 the admin url follows the bind host, TLS and the defaults", () => {
        fs.writeFileSync(path.join(configDir, "server.yaml"), "adminBindHost: ::1\nadminTls: false\n");
        expect(buildStatus(deps({pid: 1, mode: "server", daemon: false})).server?.adminUrl).toBe("http://[::1]:9300/");
        // 서버는 adminTls 가 없는 server.yaml 을 HTTP 로 읽는다(파일이 없을 때 만드는 기본값만 HTTPS 다).
        fs.writeFileSync(path.join(configDir, "server.yaml"), "adminBindHost: '::'\n");
        expect(buildStatus(deps({pid: 1, mode: "server", daemon: false})).server?.adminUrl).toBe("http://127.0.0.1:9300/");
        fs.rmSync(path.join(configDir, "server.yaml"));
        expect(buildStatus(deps({pid: 1, mode: "server", daemon: false})).server?.adminUrl).toBe("https://127.0.0.1:9300/");
    });

    test("REQ-13 --json prints one JSON line; exit code is 0 when running and 3 when not", () => {
        expect(runStatus({json: ""}, io(), deps())).toBe(3);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0])).toMatchObject({running: false});
        out = [];
        expect(runStatus({json: ""}, io(), deps({pid: 7, mode: "client", daemon: true}))).toBe(0);
        expect(JSON.parse(out[0])).toMatchObject({running: true, pid: 7});
    });

    test("REQ-13 without --json the result is a sentence", () => {
        expect(runStatus({}, io(), deps())).toBe(3);
        expect(out.join("\n")).toBe("TTTGate is not running");
        out = [];
        expect(runStatus({}, io(), deps({pid: 7, mode: "server", daemon: true}))).toBe(0);
        expect(out.join("\n")).toBe("TTTGate server is running in the background (pid 7)");
    });
});
