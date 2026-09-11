jest.setTimeout(60_000);

import * as fs from "fs";
import * as https from "https";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import YAML from "yaml";
import {getFreePort, spawnProcess, waitUntil, SpawnedProcess} from "../../helpers/smokeProcess";

const APP_JS = path.resolve(__dirname, "../../../build/src/app.js");
const RESERVED_DEFAULT_CONTROL_PORT = 9126;

type YamlOptionOverrides = {[key: string]: unknown};

const httpsGetJson = (port: number, requestPath: string): Promise<{status: number; body: string}> => {
    return new Promise((resolve, reject) => {
        const req = https.request({
            host: "127.0.0.1",
            port,
            path: requestPath,
            method: "GET",
            rejectUnauthorized: false,
            timeout: 4000
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve({status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8")}));
        });
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("https request timeout")));
        req.end();
    });
};

const expectConnectionRefused = (port: number): Promise<void> => {
    return new Promise((resolve, reject) => {
        const socket = net.connect({port, host: "127.0.0.1"});
        socket.once("connect", () => {
            socket.destroy();
            reject(new Error(`expected ECONNREFUSED on port ${port}, but connected`));
        });
        socket.once("error", (err: NodeJS.ErrnoException) => {
            if(err.code === "ECONNREFUSED") resolve();
            else reject(err);
        });
    });
};

const makeTestRoot = (): string => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-app-test-"));
    for(const dir of ["config", "bin", "logs"]) fs.mkdirSync(path.join(rootDir, dir), {recursive: true});
    return rootDir;
};

const writeServerYaml = (rootDir: string, overrides: YamlOptionOverrides = {}): void => {
    const option = {
        key: "server-app-test",
        adminPort: overrides.adminPort,
        adminBindHost: "127.0.0.1",
        adminTls: true,
        port: overrides.port,
        tls: false,
        controlProtocolMode: "mixed",
        allowLegacyControlAuth: false,
        trustedClients: [],
        tunnelingOptions: [],
        keepAlive: 0,
        globalMemCacheLimit: 128,
        ...overrides
    };
    fs.writeFileSync(path.join(rootDir, "config", "server.yaml"), YAML.stringify(option), {encoding: "utf-8"});
};

const ensureReservedControlPortIsFree = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", () => {
            reject(new Error(`Port ${RESERVED_DEFAULT_CONTROL_PORT} is busy; free it before running ServerApp.test.ts`));
        });
        server.listen(RESERVED_DEFAULT_CONTROL_PORT, "127.0.0.1", () => {
            server.close(() => resolve());
        });
    });
};

describe("ServerApp process boundary", () => {
    let root: string | undefined;
    let child: SpawnedProcess | undefined;

    afterEach(async () => {
        if(child && child.child.exitCode === null && child.child.signalCode === null) {
            child.kill("SIGKILL");
            await child.waitForExit(5000);
        }
        child = undefined;
        if(root) fs.rmSync(root, {recursive: true, force: true});
        root = undefined;
    });

    test("CLI -adminPort overrides the yaml admin port and /api/version answers on the new port only", async () => {
        root = makeTestRoot();
        const yamlAdminPort = await getFreePort();
        const cliAdminPort = await getFreePort();
        const controlPort = await getFreePort();
        writeServerYaml(root, {adminPort: yamlAdminPort, port: controlPort});

        child = spawnProcess(process.execPath, [APP_JS, "server", "-adminPort", String(cliAdminPort)], {cwd: root});

        const response = await waitUntil(async () => {
            const result = await httpsGetJson(cliAdminPort, "/api/version");
            return result.status === 200 ? result : undefined;
        }, {timeoutMs: 20_000, label: "admin ready"});
        const body = JSON.parse(response.body);
        expect(body.name).toBeDefined();
        expect(body.build).toBeDefined();

        await expectConnectionRefused(yamlAdminPort);
    });

    test("-reset true wipes config/ and reinitializes it with a freshly generated key", async () => {
        await ensureReservedControlPortIsFree();
        root = makeTestRoot();
        const yamlAdminPort = await getFreePort();
        const controlPort = await getFreePort();
        const cliAdminPort = await getFreePort();
        writeServerYaml(root, {adminPort: yamlAdminPort, port: controlPort});
        fs.writeFileSync(path.join(root, "config", "decoy.txt"), "should be deleted", {encoding: "utf-8"});

        child = spawnProcess(process.execPath, [APP_JS, "server", "-reset", "true", "-adminPort", String(cliAdminPort)], {cwd: root});

        await waitUntil(async () => {
            const result = await httpsGetJson(cliAdminPort, "/api/version");
            return result.status === 200 ? true : undefined;
        }, {timeoutMs: 20_000, label: "admin ready after reset"});

        expect(fs.existsSync(path.join(root, "config", "decoy.txt"))).toBe(false);
        expect(fs.existsSync(path.join(root, "config", "server.yaml"))).toBe(true);
        expect(fs.existsSync(path.join(root, "config", ".server.state.json"))).toBe(true);

        const resetYaml = YAML.parse(fs.readFileSync(path.join(root, "config", "server.yaml"), "utf-8"));
        expect(resetYaml.key).not.toBe("server-app-test");
        expect(resetYaml.key.startsWith("srv-")).toBe(true);
    });

    test("SIGTERM stops the server within 5 seconds and the admin port stops answering", async () => {
        root = makeTestRoot();
        const yamlAdminPort = await getFreePort();
        const controlPort = await getFreePort();
        writeServerYaml(root, {adminPort: yamlAdminPort, port: controlPort});

        child = spawnProcess(process.execPath, [APP_JS, "server"], {cwd: root});

        await waitUntil(async () => {
            const result = await httpsGetJson(yamlAdminPort, "/api/version");
            return result.status === 200 ? true : undefined;
        }, {timeoutMs: 20_000, label: "admin ready"});

        child.kill("SIGTERM");
        const exitCode = await child.waitForExit(5000);
        expect(exitCode === 0 || child.child.signalCode === "SIGTERM").toBe(true);

        await expectConnectionRefused(yamlAdminPort);
    });

    test("an out-of-range -adminPort exits with code 1 and the documented stderr message", async () => {
        root = makeTestRoot();
        const yamlAdminPort = await getFreePort();
        const controlPort = await getFreePort();
        writeServerYaml(root, {adminPort: yamlAdminPort, port: controlPort});

        child = spawnProcess(process.execPath, [APP_JS, "server", "-adminPort", "70000"], {cwd: root});
        const exitCode = await child.waitForExit(15_000);

        expect(exitCode).toBe(1);
        expect(child.readChannel().stderr).toContain("Invalid admin port number (1 ~ 65535)");
    });

    test("adminTls:false in the yaml is rejected by the admin security policy with exit code 1", async () => {
        root = makeTestRoot();
        const yamlAdminPort = await getFreePort();
        const controlPort = await getFreePort();
        writeServerYaml(root, {adminPort: yamlAdminPort, port: controlPort, adminTls: false});

        child = spawnProcess(process.execPath, [APP_JS, "server"], {cwd: root});
        const exitCode = await child.waitForExit(15_000);

        expect(exitCode).toBe(1);
        expect(child.readChannel().stderr).toContain("admin TLS is disabled");
    });
});
