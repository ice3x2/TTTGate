import fs from "fs";
import path from "path";
import AppCompositionRoot from "../../../src/bootstrap/AppCompositionRoot";
import {FileCache} from "../../../src/util/FileCache";
import Environment from "../../../src/Environment";
import LoggerFactory from "../../../src/util/logger/LoggerFactory";
import {LoggerConfig} from "../../../src/util/logger/LoggerConfig";
import {SocketHandler} from "../../../src/util/SocketHandler";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {CertificationStore} from "../../../src/server/CertificationStore";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

describe("AppCompositionRoot", () => {
    let root: TestRoot;

    beforeAll(async () => {
        root = await createTestRoot("composition");
        applyTestRoot(root.rootDir);
    });

    afterAll(async () => {
        LoggerFactory.updateConfig(LoggerConfig.create(root.rootDir));
        await cleanupTestRoot(root);
    });

    test("configureLogger() wires the server/client/boot/socket write configs to Environment.path.logDir", () => {
        AppCompositionRoot.configureLogger();
        const config = LoggerFactory.cloneConfig();

        const serverConfig = config.writeConfig("server");
        expect(serverConfig).toBeDefined();
        expect(serverConfig!.history).toBe(2);
        expect(serverConfig!.console).toBe(true);
        expect(serverConfig!.path).toBe(Environment.path.logDir);

        expect(config.writeConfig("client")).toBeDefined();
        expect(config.writeConfig("boot")).toBeDefined();
        expect(config.writeConfig("socket")).toBeDefined();

        expect(config.defaultWriteConfig.path).toBe(Environment.path.logDir);
    });

    // NOTE: SocketHandler.fileCacheDirPath and SocketHandler.GlobalMemCacheLimit are
    // write-only static accessors (setters with no matching getter) — reading either
    // back always yields undefined. This diverges from the issue's acceptance
    // criteria, which assumes both round-trip; reported in the issue comments.
    // GlobalMemCacheLimit's effect is observable through the separate public getter
    // SocketHandler.maxGlobalMemoryBufferSize. fileCacheDirPath has no such getter,
    // so the underlying private static field is read directly to observe the effect.
    test("useServerCacheDir()/useClientCacheDir() point SocketHandler at the server/client cache directories", () => {
        // beforeAll's applyTestRoot() already points fileCacheDirPath at
        // serverCacheDir, so calling useServerCacheDir() first would pass even if it
        // were a no-op. Start from useClientCacheDir() instead so each call below is
        // asserted to actually change the value away from what preceded it.
        AppCompositionRoot.useClientCacheDir();
        expect((SocketHandler as any).FileCacheDirPath).toBe(Environment.path.clientCacheDir);

        AppCompositionRoot.useServerCacheDir();
        expect((SocketHandler as any).FileCacheDirPath).toBe(Environment.path.serverCacheDir);

        AppCompositionRoot.useClientCacheDir();
        expect((SocketHandler as any).FileCacheDirPath).toBe(Environment.path.clientCacheDir);
    });

    // #258 REQ-2 — 캐시 폴더를 정할 때 죽은 프로세스가 남긴 캐시 파일을 지운다.
    test("useServerCacheDir()/useClientCacheDir() remove cache files left by dead processes", () => {
        const deadPid = Number(require("child_process").spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {encoding: "utf-8"}).stdout);
        for(const [dir, use] of [[Environment.path.serverCacheDir, AppCompositionRoot.useServerCacheDir],
            [Environment.path.clientCacheDir, AppCompositionRoot.useClientCacheDir]] as const) {
            fs.mkdirSync(dir, {recursive: true});
            const stale = path.join(dir, `${deadPid}.260101000000.1.cache`);
            fs.writeFileSync(stale, "stale");
            const mine = FileCache.create(dir);
            mine.writeSync(Buffer.from("mine"));
            try {
                use();
                expect({dir, stale: fs.existsSync(stale), mine: fs.existsSync(mine.filePath)}).toEqual({dir, stale: false, mine: true});
            } finally {
                mine.deleteSync();
            }
        }
    });

    test("applyGlobalMemLimitMiB() sets the global memory cache limit in bytes, defaulting to 128 MiB", () => {
        AppCompositionRoot.applyGlobalMemLimitMiB(4);
        expect(SocketHandler.maxGlobalMemoryBufferSize).toBe(4 * 1024 * 1024);

        AppCompositionRoot.applyGlobalMemLimitMiB();
        expect(SocketHandler.maxGlobalMemoryBufferSize).toBe(134217728);
    });

    test("serverStores() returns the same singleton store instances on every call", () => {
        const first = AppCompositionRoot.serverStores();
        const second = AppCompositionRoot.serverStores();

        expect(first.serverOptionStore).toBe(ServerOptionStore.instance);
        expect(first.certStore).toBe(CertificationStore.instance);
        expect(second.serverOptionStore).toBe(first.serverOptionStore);
        expect(second.certStore).toBe(first.certStore);
    });
});
