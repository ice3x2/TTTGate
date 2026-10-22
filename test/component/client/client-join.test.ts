import * as fs from "fs";
import * as path from "path";
import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import TTTServer from "../../../src/server/TTTServer";
import TTTClient from "../../../src/client/TTTClient";
import {DEFAULT_KEY, ServerOption} from "../../../src/types/TunnelingOption";
import {runClientJoin} from "../../../src/client/ClientJoin";
import {resolveClientOption} from "../../../src/client/ClientOptionResolver";
import {getFreePort, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(60_000);

// #214 client join
describe("client join", () => {
    let root: TestRoot;
    let server: TTTServer;
    let port: number;
    let configDir: string;
    let out: string[];
    let err: string[];
    const clients: TTTClient[] = [];

    beforeEach(async () => {
        root = await createTestRoot("client-join");
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
        clients.splice(0).forEach((client) => client.stop());
        await server.close();
        await cleanupTestRoot(root);
    });

    const code = async () => {
        const issued = await server.issueEnrollmentCode("edge");
        if(!issued.ok) throw new Error(issued.reason);
        return issued.code;
    };
    const join = (addr: string, options: {[key: string]: string}) =>
        runClientJoin(addr, options, {configDir, out: (line) => out.push(line), err: (line) => err.push(line)});
    const yamlPath = () => path.join(configDir, "client.yaml");

    test("REQ-1/2/6 writes client.yaml and the CA, prints the next command, and the result connects", async () => {
        const exitCode = await join(`127.0.0.1:${port}`, {code: await code()});
        expect(exitCode).toBe(0);
        expect(fs.readFileSync(path.join(configDir, "server-ca.pem"), "utf-8")).toBe(CertificationStore.instance.getTempCert().cert.value);
        if(process.platform !== "win32") expect(fs.statSync(yamlPath()).mode & 0o777).toBe(0o600);
        const text = out.join("\n");
        expect(text).toContain(yamlPath());
        expect(text).toContain("TTTGate client");
        expect(text + err.join("\n")).not.toContain("edge-secret-value");

        const resolved = resolveClientOption({cli: {}, env: {}, configDir, cwd: root.rootDir});
        if(!resolved.ok) throw new Error(resolved.message);
        expect(resolved.saveOption).toMatchObject({host: "127.0.0.1", port, tls: true, clientId: "edge", ca: "server-ca.pem", serverName: "tttgate-control"});
        const client = TTTClient.create(resolved.option);
        clients.push(client);
        client.start();
        await waitFor(() => { if(!server.clientStatus().some((s) => s.clientId === "edge")) throw new Error("offline"); return true; },
            {timeoutMs: 15_000, intervalMs: 50});
    });

    test("REQ-4 keeps an existing client.yaml unless --force, which keeps a backup", async () => {
        fs.writeFileSync(yamlPath(), "host: old\n");
        expect(await join(`127.0.0.1:${port}`, {code: await code()})).toBe(78);
        expect(fs.readFileSync(yamlPath(), "utf-8")).toBe("host: old\n");
        expect(err.join("\n")).toContain("--force");

        expect(await join(`127.0.0.1:${port}`, {code: await code(), force: ""})).toBe(0);
        expect(fs.readFileSync(path.join(configDir, "client.yaml.bak"), "utf-8")).toBe("host: old\n");
        if(process.platform !== "win32") expect(fs.statSync(path.join(configDir, "client.yaml.bak")).mode & 0o777).toBe(0o600);
    });

    test("REQ-7 a rejected code writes nothing and exits with 1", async () => {
        expect(await join(`127.0.0.1:${port}`, {code: "0000-0000-0000"})).toBe(1);
        expect(err.join("\n")).toContain("rejected");
        expect(fs.readdirSync(configDir)).toEqual([]);
    });

    test("REQ-7 an unreachable server exits with 1; bad input exits with 2", async () => {
        const closed = await getFreePort();
        expect(await join(`127.0.0.1:${closed}`, {code: "0000-0000-0000"})).toBe(1);
        expect(await join(`127.0.0.1:${port}`, {})).toBe(2);
        expect(await join(`127.0.0.1:${port}`, {code: "too-short"})).toBe(2);
        expect(await join(`tcp://127.0.0.1:${port}`, {code: "0000-0000-0000"})).toBe(2);
        expect(await join("host:x", {code: "0000-0000-0000"})).toBe(2);
        expect(fs.readdirSync(configDir)).toEqual([]);
    });
});
