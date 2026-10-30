import fs from "fs/promises";
import {mkdirSync, rmSync} from "fs";
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
import {IdentityStore} from "../../src/server/rbac/IdentityStore";
import {IdentityMigration} from "../../src/server/rbac/IdentityMigration";
import {AuditSinkRegistry} from "../../src/server/audit/AuditSink";

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
    IdentityStore.resetForTest();
    IdentityMigration.resetForTest();
    AuditSinkRegistry.reset();
};

const applyTestRoot = (rootDir: string): void => {
    resetRuntimeState();
    Environment.configure({rootDir});
    SocketHandler.fileCacheDirPath = Environment.path.serverCacheDir;
};

/**
 * 정리 뒤의 루트(#264 AC-2). 기본 루트는 cwd(저장소)라, 테스트가 끝난 뒤에도 돌던 서버 작업(시간 초과로 먼저 끝난
 * 요청의 처리 등)이 설정을 쓰면 저장소 config/ 에 server.yaml·identity.yaml 이 생긴다. 그런 늦은 쓰기는 여기로 보낸다.
 */
const AFTER_CLEANUP_ROOT = Path.join(os.tmpdir(), `tttgate-test-after-cleanup-${process.pid}`);
let afterCleanupRootRemovalRegistered = false;

const cleanupTestRoot = async (testRoot?: TestRoot): Promise<void> => {
    resetRuntimeState();
    Environment.reset();
    // 앞 테스트의 늦은 쓰기가 다음 정리 뒤 상태에 남지 않게 매번 비운다. 늦은 쓰기와 겹쳐 지우지 못해도
    // 부수 작업이므로 테스트를 실패시키지 않는다.
    try { rmSync(AFTER_CLEANUP_ROOT, {recursive: true, force: true, maxRetries: 3}); } catch {}
    for(const dir of ["config", "logs", "cert", "web", Path.join("cache", "server"), Path.join("cache", "client")]) {
        mkdirSync(Path.join(AFTER_CLEANUP_ROOT, dir), {recursive: true});
    }
    Environment.configure({rootDir: AFTER_CLEANUP_ROOT});
    SocketHandler.fileCacheDirPath = Environment.path.serverCacheDir;
    // 워커가 끝나면 이 프로세스의 sandbox 를 지운다(다른 실행의 sandbox 는 건드리지 않는다).
    if(!afterCleanupRootRemovalRegistered) {
        afterCleanupRootRemovalRegistered = true;
        process.once("exit", () => { try { rmSync(AFTER_CLEANUP_ROOT, {recursive: true, force: true}); } catch {} });
    }
    if(testRoot) {
        await testRoot.cleanup();
    }
};

const writeWebFixture = async (rootDir: string, fileName: string, content: string): Promise<void> => {
    await fs.writeFile(Path.join(rootDir, "web", fileName), content, {encoding: "utf-8"});
};

export { applyTestRoot, cleanupTestRoot, createTestRoot, resetRuntimeState, TestRoot, writeWebFixture };
