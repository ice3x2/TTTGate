import fs from "fs/promises";
import os from "os";
import Path from "path";
import Environment from "../../src/Environment";
import {SystemInfoProviderRegistry} from "../../src/commons/SystemInfoProvider";
import {TTTClientRuntimeRegistry} from "../../src/client/TTTClientRuntime";
import {AdminSecurityPolicyRegistry} from "../../src/server/AdminSecurityPolicy";
import {TunnelHandshakePolicyRegistry} from "../../src/server/TunnelHandshakePolicy";
import {ClockRngProvider} from "../../src/util/ClockRng";
import {QueueLimiterRegistry} from "../../src/util/QueueLimiter";
import {ResourcePolicyRegistry} from "../../src/util/ResourcePolicy";
import {SchedulerRegistry} from "../../src/util/Scheduler";
import {SocketHandler} from "../../src/util/SocketHandler";
import {TlsOptionsFactoryRegistry} from "../../src/util/TlsOptionsFactory";
import SessionStore from "../../src/server/admin/SessionStore";
import ServerOptionStore from "../../src/server/ServerOptionStore";
import {CertificationStore} from "../../src/server/CertificationStore";

type TestRoot = {
    rootDir: string;
    cleanup(): Promise<void>;
}

const createTestRoot = async (prefix: string = "tttgate-test"): Promise<TestRoot> => {
    const rootDir = await fs.mkdtemp(Path.join(os.tmpdir(), `${prefix}-`));
    const directories = [
        "web",
        "config",
        "logs",
        "cert",
        Path.join("cache", "server"),
        Path.join("cache", "client")
    ];

    await Promise.all(directories.map((dir) => fs.mkdir(Path.join(rootDir, dir), {recursive: true})));

    return {
        rootDir,
        async cleanup(): Promise<void> {
            await fs.rm(rootDir, {recursive: true, force: true});
        }
    };
};

const resetRuntimeState = (): void => {
    AdminSecurityPolicyRegistry.reset();
    ClockRngProvider.reset();
    SystemInfoProviderRegistry.reset();
    TTTClientRuntimeRegistry.reset();
    SchedulerRegistry.reset();
    TlsOptionsFactoryRegistry.reset();
    QueueLimiterRegistry.reset();
    ResourcePolicyRegistry.reset();
    TunnelHandshakePolicyRegistry.reset();
    SessionStore.resetForTest();
    ServerOptionStore.resetForTest();
    CertificationStore.resetForTest();
};

const applyTestRoot = (rootDir: string): void => {
    resetRuntimeState();
    Environment.configure({rootDir});
    SocketHandler.fileCacheDirPath = Environment.path.serverCacheDir;
};

const cleanupTestRoot = async (testRoot?: TestRoot): Promise<void> => {
    resetRuntimeState();
    Environment.reset();
    if(testRoot) {
        await testRoot.cleanup();
    }
};

const writeWebFixture = async (rootDir: string, fileName: string, content: string): Promise<void> => {
    await fs.writeFile(Path.join(rootDir, "web", fileName), content, {encoding: "utf-8"});
};

export { applyTestRoot, cleanupTestRoot, createTestRoot, resetRuntimeState, TestRoot, writeWebFixture };
