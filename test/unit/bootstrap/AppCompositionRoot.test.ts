import AppCompositionRoot from "../../../src/bootstrap/AppCompositionRoot";
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
        AppCompositionRoot.useServerCacheDir();
        expect((SocketHandler as any).FileCacheDirPath).toBe(Environment.path.serverCacheDir);

        AppCompositionRoot.useClientCacheDir();
        expect((SocketHandler as any).FileCacheDirPath).toBe(Environment.path.clientCacheDir);
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
