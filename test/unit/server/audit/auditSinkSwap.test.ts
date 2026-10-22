import Path from "path";
import Environment from "../../../../src/Environment";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import TTTServer from "../../../../src/server/TTTServer";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {FileAuditSink} from "../../../../src/server/audit/FileAuditSink";
import {ServerOption} from "../../../../src/types/TunnelingOption";
import {getFreePort} from "../../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

jest.setTimeout(30_000);

/**
 * 저장된 서버 옵션을 실행 중 서버에 반영하는 단 하나의 경로가 TTTServer.applyServerOption 이므로
 * 감사 싱크 교체도 거기 한 곳에서만 일어난다(이슈 본문의 ServerApp.updateServerOption 은 저장소에 없다).
 */
describe("감사 싱크 교체는 applyServerOption 한 곳에서만 한다", () => {
    let testRoot: TestRoot;
    let server: TTTServer;
    let baseOption: ServerOption;

    beforeEach(async () => {
        testRoot = await createTestRoot("audit-sink-swap");
        applyTestRoot(testRoot.rootDir);
        await CertificationStore.instance.load();
        const store = ServerOptionStore.instance;
        baseOption = {
            ...store.serverOption, port: await getFreePort(), adminBindHost: "127.0.0.1", adminTls: false,
            tls: false, keepAlive: 0, tunnelingOptions: [], auditRetentionDays: 90, auditQueueSize: 1000
        };
        server = TTTServer.create(baseOption);
    });

    afterEach(async () => {
        const sink = AuditSinkRegistry.current();
        if(sink instanceof FileAuditSink) await sink.close();
        await server.close();
        await cleanupTestRoot(testRoot);
    });

    const registerFileSink = (retentionDays: number, queueSize: number): FileAuditSink => {
        const sink = new FileAuditSink({dir: Path.join(Environment.path.logDir, "audit"), queueSize, retentionDays});
        AuditSinkRegistry.set(sink);
        return sink;
    };

    it("보존 기간이 바뀌면 새 인스턴스로 갈고 옛 인스턴스를 닫는다", async () => {
        const previous = registerFileSink(90, 1000);

        const applied = await server.applyServerOption({...baseOption, auditRetentionDays: 30}, baseOption);
        expect(applied.success).toBe(true);

        const current = AuditSinkRegistry.current();
        expect(current).not.toBe(previous);
        expect(current).toBeInstanceOf(FileAuditSink);
        expect((current as FileAuditSink).retentionDays).toBe(30);
        expect(previous.reserve()).toBe(false);
    });

    it("값이 그대로면 싱크를 교체하지 않는다", async () => {
        const previous = registerFileSink(90, 1000);

        const applied = await server.applyServerOption({...baseOption}, baseOption);
        expect(applied.success).toBe(true);

        expect(AuditSinkRegistry.current()).toBe(previous);
        expect(previous.reserve()).toBe(true);
    });

    it("큐 상한만 바뀌어도 교체한다", async () => {
        const previous = registerFileSink(90, 1000);

        const applied = await server.applyServerOption({...baseOption, auditQueueSize: 500}, baseOption);
        expect(applied.success).toBe(true);

        const current = AuditSinkRegistry.current();
        expect(current).not.toBe(previous);
        expect((current as FileAuditSink).queueSize).toBe(500);
        expect((current as FileAuditSink).retentionDays).toBe(90);
    });
});
