import Environment from "../../../src/Environment";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import TTTServer from "../../../src/server/TTTServer";
import {CertificationStore} from "../../../src/server/CertificationStore";
import {AdmissionController} from "../../../src/server/security/AdmissionController";
import {ServerOption} from "../../../src/types/TunnelingOption";
import {getFreePort} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(30_000);

// #327 REQ-16 · AC-8: 거절 로그 보관 일수는 저장하면 다시 시작하지 않고 적용된다.
describe("denialLogRetentionDays is applied by applyServerOption", () => {
    let testRoot: TestRoot;
    let server: TTTServer;
    let baseOption: ServerOption;

    beforeEach(async () => {
        testRoot = await createTestRoot("denial-log-apply");
        applyTestRoot(testRoot.rootDir);
        AdmissionController.resetForTest();
        await CertificationStore.instance.load();
        baseOption = {
            ...ServerOptionStore.instance.serverOption, port: await getFreePort(), adminBindHost: "127.0.0.1", adminTls: false,
            tls: false, keepAlive: 0, tunnelingOptions: [], denialLogRetentionDays: 20
        };
        server = TTTServer.create(baseOption);
    });

    afterEach(async () => {
        AdmissionController.resetForTest();
        await server.close();
        await cleanupTestRoot(testRoot);
    });

    it("AC-8 saving 0 turns the file log off at once, and a positive value turns it on in the log directory", async () => {
        expect((await server.applyServerOption({...baseOption, denialLogRetentionDays: 0}, baseOption)).success).toBe(true);
        expect(AdmissionController.instance.denialFileLog?.enabled).toBe(false);

        expect((await server.applyServerOption({...baseOption, denialLogRetentionDays: 5}, {...baseOption, denialLogRetentionDays: 0})).success).toBe(true);
        expect(AdmissionController.instance.denialFileLog?.enabled).toBe(true);
        expect(AdmissionController.instance.denialFileLog?.directory).toBe(Environment.path.logDir);
    });
});
