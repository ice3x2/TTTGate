jest.setTimeout(60_000);

import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import YAML from "yaml";
import {createTestRoot, TestRoot} from "../helpers/runtime";
import {getFreePort, spawnProcess, waitUntil, SpawnedProcess} from "../helpers/smokeProcess";

const APP_JS = path.resolve(__dirname, "../../build/src/app.js");

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

describe("app.ts entrypoint (in-process)", () => {
    let root: TestRoot;

    beforeEach(async () => {
        root = await createTestRoot("app-entry");
        fs.mkdirSync(path.join(root.rootDir, "bin"), {recursive: true});
    });

    afterEach(async () => {
        await root.cleanup();
    });

    test("no mode prints the version line then the full usage block", () => {
        const originalArgv = process.argv;
        process.argv = [process.execPath, "app.js"];
        let LoggerFactory: any;
        let LoggerConfig: any;
        const logs: string[] = [];
        let logSpy: jest.SpyInstance | undefined;
        try {
            jest.isolateModules(() => {
                require("../../src/Environment").default.configure({rootDir: root.rootDir});
                LoggerFactory = require("../../src/util/logger/LoggerFactory").default;
                ({LoggerConfig} = require("../../src/util/logger/LoggerConfig"));
                logSpy = jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
                    logs.push(args.map(String).join(" "));
                });
                require("../../src/app");
            });

            expect(logs.some((line) => line.startsWith("TTTGate v"))).toBe(true);
            // #208: 사용법은 정의 표에서 만든 한 덩어리로 출력한다.
            expect(logs[logs.length - 1]).toContain("Usage: TTTGate <server|client|stop> [options]");
            expect(logs[logs.length - 1]).toContain("TTTGate client --help");
        } finally {
            logSpy?.mockRestore();
            LoggerFactory?.updateConfig(LoggerConfig.create(root.rootDir));
            process.argv = originalArgv;
        }
    });

    test("stop mode prints the stop banner, calls Sentinel.stop() without throwing, and skips the usage block", () => {
        const originalArgv = process.argv;
        process.argv = [process.execPath, "app.js", "stop"];
        let LoggerFactory: any;
        let LoggerConfig: any;
        const logs: string[] = [];
        let logSpy: jest.SpyInstance | undefined;
        try {
            expect(() => {
                jest.isolateModules(() => {
                    require("../../src/Environment").default.configure({rootDir: root.rootDir});
                    LoggerFactory = require("../../src/util/logger/LoggerFactory").default;
                    ({LoggerConfig} = require("../../src/util/logger/LoggerConfig"));
                    logSpy = jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
                        logs.push(args.map(String).join(" "));
                    });
                    require("../../src/app");
                });
            }).not.toThrow();

            expect(logs).toContain("Stop TTTGate processes ...");
            expect(logs.some((line) => line.startsWith("Usage:"))).toBe(false);
        } finally {
            logSpy?.mockRestore();
            LoggerFactory?.updateConfig(LoggerConfig.create(root.rootDir));
            process.argv = originalArgv;
        }
    });
});

describe("app.ts entrypoint (process boundary)", () => {
    let child: SpawnedProcess | undefined;
    let rootDir: string | undefined;

    afterEach(async () => {
        if(child && child.child.exitCode === null && child.child.signalCode === null) {
            child.kill("SIGKILL");
            await child.waitForExit(5000);
        }
        child = undefined;
        if(rootDir) fs.rmSync(rootDir, {recursive: true, force: true});
        rootDir = undefined;
    });

    const makeRoot = (): string => {
        const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "app-entry-proc-"));
        for(const sub of ["config", "bin", "logs"]) fs.mkdirSync(path.join(dir, sub), {recursive: true});
        return dir;
    };

    test("no args prints the usage block and exits with code 0", async () => {
        rootDir = makeRoot();
        child = spawnProcess(process.execPath, [APP_JS], {cwd: rootDir});
        const exitCode = await child.waitForExit(10_000);

        expect(exitCode).toBe(0);
        expect(child.readChannel().stdout).toContain("Usage: TTTGate <server|client|stop> [options]");
    });

    test("server mode with adminTls:true boots, answers /api/version, and stops cleanly on SIGTERM", async () => {
        rootDir = makeRoot();
        const adminPort = await getFreePort();
        const controlPort = await getFreePort();
        fs.writeFileSync(path.join(rootDir, "config", "server.yaml"), YAML.stringify({
            key: "app-entry-test",
            adminPort,
            adminBindHost: "127.0.0.1",
            adminTls: true,
            port: controlPort,
            tls: false,
            controlProtocolMode: "mixed",
            allowLegacyControlAuth: false,
            trustedClients: [],
            tunnelingOptions: [],
            keepAlive: 0,
            globalMemCacheLimit: 128
        }), {encoding: "utf-8"});

        child = spawnProcess(process.execPath, [APP_JS, "server"], {cwd: rootDir});

        await waitUntil(async () => {
            const result = await httpsGetJson(adminPort, "/api/version");
            return result.status === 200 ? true : undefined;
        }, {timeoutMs: 20_000, label: "admin ready"});

        child.kill("SIGTERM");
        const exitCode = await child.waitForExit(5000);
        expect(exitCode === 0 || child.child.signalCode === "SIGTERM").toBe(true);
    });

    test("client mode with an unreachable address stays alive and schedules a reconnect", async () => {
        rootDir = makeRoot();
        const emptyPort = await getFreePort();

        child = spawnProcess(process.execPath,
            [APP_JS, "client", "-addr", `127.0.0.1:${emptyPort}`, "-name", "e2e-orphan"], {cwd: rootDir});

        await new Promise((resolve) => setTimeout(resolve, 3000));

        expect(child.child.exitCode).toBeNull();
        expect(child.readChannel().stdout).toContain("Try reconnect after 5000ms");
    });
});
