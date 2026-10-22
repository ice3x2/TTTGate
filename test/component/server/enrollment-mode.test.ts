import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import TTTServer from "../../../src/server/TTTServer";
import {CtrlPacket} from "../../../src/commons/CtrlPacket";
import {deriveEnrollmentKeys, ENROLLMENT_PROTOCOL} from "../../../src/commons/Enrollment";
import {DEFAULT_KEY, ServerOption} from "../../../src/types/TunnelingOption";
import {requestEnrollment} from "../../../src/client/ClientEnrollment";
import {getFreePort} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(60_000);

// #221 — 교환 시점에 제어 포트 모드를 다시 확인하고, 모드가 바뀌면 발급한 코드를 무효로 한다.
describe("enrollment follows the control port mode (#221)", () => {
    let root: TestRoot;
    let server: TTTServer;
    let port: number;

    beforeEach(async () => {
        root = await createTestRoot("enroll-mode");
        applyTestRoot(root.rootDir);
        await CertificationStore.instance.load();
        port = await getFreePort();
        const option: ServerOption = {key: DEFAULT_KEY, adminPort: 9300, adminBindHost: "127.0.0.1", adminTls: true, port, tls: true,
            controlProtocolMode: "mixed", trustedClients: [{clientId: "edge", clientSecret: "edge-secret"}], tunnelingOptions: [], keepAlive: 0, globalMemCacheLimit: 128};
        if(!ServerOptionStore.instance.updateServerOption(option)) throw new Error("bad fixture");
        server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();
    });
    afterEach(async () => {
        await server.close();
        await cleanupTestRoot(root);
    });

    const apply = async (patch: Partial<ServerOption>) => {
        const previous = ServerOptionStore.instance.serverOption;
        const next = {...previous, ...patch};
        expect(ServerOptionStore.instance.updateServerOption(next)).toBeTruthy();
        expect((await server.applyServerOption(next, previous)).success).toBe(true);
    };

    /** 교환 처리 함수를 직접 불러 응답 meta 를 받는다(TLS 계층을 거치지 않는 방어선 확인용). */
    const exchangeDirectly = async (code: string) => {
        const keys = await deriveEnrollmentKeys(code);
        const sent: Buffer[] = [];
        const handler = {id: 987654, remoteAddress: "127.0.0.1", sendData: (data: Buffer, done?: () => void) => { sent.push(data); done?.(); }, destroy: () => {}};
        (server.tunnelServer as any).handleEnrollRequest(handler, CtrlPacket.createEnrollRequest({protocol: ENROLLMENT_PROTOCOL, lookup: keys.lookup}));
        const [packet] = new (require("../../../src/commons/CtrlPacket").CtrlPacketStreamer)().readCtrlPacketList(Buffer.concat(sent));
        return packet.enrollResponseMetaResult;
    };

    test.each([
        ["mtls-strict", {controlProtocolMode: "mtls-strict" as const}],
        ["plain text", {tls: false}]
    ])("REQ-1 a %s control port answers unavailable and does not use up the code", async (_label, patch) => {
        const issued = await server.issueEnrollmentCode("edge");
        if(!issued.ok) throw new Error(issued.reason);
        const registry = (server as any)._enrollment;
        // 모드만 바꾸고 코드 무효화(REQ-2)는 피해 교환 시점 검사만 본다.
        Object.assign((server.tunnelServer as any)._serverOption, patch);
        expect(await exchangeDirectly(issued.code)).toEqual({kind: "valid", value: {ok: false, reason: "unavailable"}});
        expect(registry._pending.size).toBe(1);
    });

    test.each([
        ["mtls-strict and back", [{controlProtocolMode: "mtls-strict" as const}, {controlProtocolMode: "mixed" as const}]],
        ["plain text and back", [{tls: false}, {tls: true}]]
    ])("REQ-2 switching the control port to %s invalidates issued codes", async (_label, steps) => {
        const issued = await server.issueEnrollmentCode("edge");
        if(!issued.ok) throw new Error(issued.reason);
        for(const step of steps) await apply(step);
        expect(await requestEnrollment({host: "127.0.0.1", port, code: issued.code})).toMatchObject({ok: false, category: "rejected"});
        const fresh = await server.issueEnrollmentCode("edge");
        if(!fresh.ok) throw new Error(fresh.reason);
        expect(await requestEnrollment({host: "127.0.0.1", port, code: fresh.code})).toMatchObject({ok: true});
    });
});
