import * as fs from "fs";
import * as path from "path";
import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import TTTServer from "../../../src/server/TTTServer";
import {DEFAULT_KEY, ServerOption} from "../../../src/types/TunnelingOption";
import {runClientJoin} from "../../../src/client/ClientJoin";
import {getFreePort} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(60_000);

// #322 REQ-16 client join --json: 런처가 영어 문장을 해석하지 않고 결과 종류를 읽는다.
describe("client join --json", () => {
    let root: TestRoot;
    let server: TTTServer;
    let port: number;
    let configDir: string;
    let out: string[];
    let err: string[];

    beforeEach(async () => {
        root = await createTestRoot("client-join-json");
        applyTestRoot(root.rootDir);
        await CertificationStore.instance.load();
        port = await getFreePort();
        const option: ServerOption = {key: DEFAULT_KEY, adminPort: 9300, adminBindHost: "127.0.0.1", adminTls: true, port, tls: true,
            controlProtocolMode: "mixed", trustedClients: [{clientId: "edge", clientSecret: "edge-secret-value", displayName: "Edge"}],
            tunnelingOptions: [], keepAlive: 0, globalMemCacheLimit: 128};
        if(!ServerOptionStore.instance.updateServerOption(option)) throw new Error("bad fixture");
        server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();
        configDir = path.join(root.rootDir, "client-config");
        fs.mkdirSync(configDir);
        out = [];
        err = [];
    });

    afterEach(async () => {
        await server.close();
        await cleanupTestRoot(root);
    });

    const issue = async () => {
        const issued = await server.issueEnrollmentCode("edge");
        if(!issued.ok) throw new Error(issued.reason);
        return issued.code;
    };
    let input = "";
    const join = (addr: string, options: {[key: string]: string}, dir = configDir) =>
        runClientJoin(addr, {...options, json: ""}, {configDir: dir, out: (line) => out.push(line), err: (line) => err.push(line),
            readInput: () => input});
    /** stdout 은 JSON 한 줄뿐이어야 한다. */
    const result = () => {
        expect(out).toHaveLength(1);
        return JSON.parse(out[0]);
    };
    const expectNoCode = (code: string) => {
        const all = out.concat(err).join("\n");
        expect(all).not.toContain(code);
        expect(all).not.toContain(code.replace(/-/g, ""));
    };

    test("AC-9 success prints ok, clientId and server only", async () => {
        const code = await issue();
        expect(await join(`127.0.0.1:${port}`, {code})).toBe(0);
        expect(result()).toEqual({ok: true, clientId: "edge", server: `127.0.0.1:${port}`});
        expectNoCode(code);
        expect(out.concat(err).join("\n")).not.toContain("edge-secret-value");
    });

    test("AC-9 a rejected code reports category rejected", async () => {
        const code = "0000-0000-0000";
        expect(await join(`127.0.0.1:${port}`, {code})).toBe(1);
        expect(result()).toMatchObject({ok: false, category: "rejected"});
        expect(typeof result().message).toBe("string");
        expectNoCode(code);
    });

    test("AC-9 an unreachable server reports category network", async () => {
        const closed = await getFreePort();
        expect(await join(`127.0.0.1:${closed}`, {code: "0000-0000-0000"})).toBe(1);
        expect(result()).toMatchObject({ok: false, category: "network"});
    });

    test("AC-9 bad input reports category argument", async () => {
        expect(await join(`127.0.0.1:${port}`, {})).toBe(2);
        expect(result()).toMatchObject({ok: false, category: "argument"});
        out = [];
        expect(await join(`127.0.0.1:${port}`, {code: "too-short"})).toBe(2);
        expect(result()).toMatchObject({ok: false, category: "argument"});
        expectNoCode("too-short");
        out = [];
        expect(await join(`tcp://127.0.0.1:${port}`, {code: "0000-0000-0000"})).toBe(2);
        expect(result()).toMatchObject({ok: false, category: "argument"});
    });

    test("AC-9 an existing client.yaml reports category exists", async () => {
        fs.writeFileSync(path.join(configDir, "client.yaml"), "host: old\n");
        expect(await join(`127.0.0.1:${port}`, {code: await issue()})).toBe(78);
        expect(result()).toMatchObject({ok: false, category: "exists"});
    });

    test("REQ-2 --code-stdin reads the code from standard input so that it is not on the command line", async () => {
        const code = await issue();
        input = `${code}\r\nignored second line\n`;
        expect(await join(`127.0.0.1:${port}`, {"code-stdin": ""})).toBe(0);
        expect(result()).toMatchObject({ok: true, clientId: "edge"});
        expectNoCode(code);
    });

    test("REQ-2 --code-stdin with --code, or with empty input, is an argument error", async () => {
        input = "0000-0000-0000\n";
        expect(await join(`127.0.0.1:${port}`, {"code-stdin": "", code: "0000-0000-0000"})).toBe(2);
        expect(result()).toMatchObject({ok: false, category: "argument"});
        out = [];
        input = "\n";
        expect(await join(`127.0.0.1:${port}`, {"code-stdin": ""})).toBe(2);
        expect(result()).toMatchObject({ok: false, category: "argument"});
    });

    test("AC-9 a settings folder that cannot be written reports category write", async () => {
        const blocked = path.join(root.rootDir, "not-a-folder");
        fs.writeFileSync(blocked, "a file where the folder should be");
        expect(await join(`127.0.0.1:${port}`, {code: await issue()}, blocked)).toBe(78);
        expect(result()).toMatchObject({ok: false, category: "write"});
    });
});
