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

    // #313: 제어 서버를 다시 만드는 변경(포트·keepAlive 등)에도 발급한 코드를 무효로 한다. 만료 없는 코드는 그렇지 않으면 끝까지 남는다.
    test.each([["the port", "port"], ["keepAlive", "keepAlive"]])("changing %s rebuilds the control server and invalidates a code without expiry", async (_label, field) => {
        const issued = await server.issueEnrollmentCode("edge", null);
        if(!issued.ok) throw new Error(issued.reason);
        expect(issued.expiresAt).toBeNull();
        if(field === "port") port = await getFreePort();
        await apply(field === "port" ? {port} : {keepAlive: 5000});
        expect(await requestEnrollment({host: "127.0.0.1", port, code: issued.code})).toMatchObject({ok: false, category: "rejected"});
        await expectFreshCodeWorks();
    });

    /** 다시 만든 제어 서버가 새 코드는 받는지 확인한다. 모든 등록을 거부해도 무효화 테스트는 통과하기 때문이다. */
    const expectFreshCodeWorks = async () => {
        const fresh = await server.issueEnrollmentCode("edge");
        if(!fresh.ok) throw new Error(fresh.reason);
        expect(await requestEnrollment({host: "127.0.0.1", port, code: fresh.code})).toMatchObject({ok: true});
    };

    /** 제어 서버의 close() 안에서 발급을 시도해, 다시 만드는 동안의 발급 결과를 돌려준다. */
    const issueDuringClose = (control: any) => {
        const realClose = control.close.bind(control);
        const result: {issued?: Awaited<ReturnType<TTTServer["issueEnrollmentCode"]>>} = {};
        control.close = async () => {
            result.issued = await server.issueEnrollmentCode("edge", null);
            return realClose();
        };
        return result;
    };

    // #313: 제어 서버를 다시 만드는 동안에는 발급하지 않는다. 그 틈의 발급은 옛 설정으로 검사되어, 쓸 수 없는 코드를 성공으로 돌려주거나 무효화를 피한다.
    test("issuing while the control server is being rebuilt is refused", async () => {
        const during = issueDuringClose(server.tunnelServer);
        await apply({keepAlive: 5000});
        expect(during.issued).toEqual({ok: false, reason: "superseded"});
        await expectFreshCodeWorks();
    });

    // #313: 제어 서버를 다시 만들기 전의 단계(감사 설정 적용)도 기다린다. 그 틈의 발급도 곧 무효가 되므로 거절한다.
    test("issuing while earlier steps of a control change are applied is refused", async () => {
        const real = (TTTServer as any).applyAuditOption;
        let during: Awaited<ReturnType<TTTServer["issueEnrollmentCode"]>> | undefined;
        const spy = jest.spyOn(TTTServer as any, "applyAuditOption").mockImplementation(async (...args: unknown[]) => {
            during = await server.issueEnrollmentCode("edge", null);
            return real.apply(TTTServer, args);
        });
        try {
            await apply({keepAlive: 5000});
        } finally {
            spy.mockRestore();
        }
        expect(during).toEqual({ok: false, reason: "superseded"});
        await expectFreshCodeWorks();
    });

    test("issuing while a failed change is being rolled back is refused", async () => {
        const state = server.captureRuntimeState();
        await apply({keepAlive: 5000});
        const during = issueDuringClose(server.tunnelServer);
        expect(await server.restoreRuntimeState(state)).toEqual([]);
        expect(during.issued).toEqual({ok: false, reason: "superseded"});
        await expectFreshCodeWorks();
    });

    // #313: 앞선 적용이 끝나지 못해 설정이 같아도 제어 서버를 다시 만드는 복원이 있다. 다시 만들면 코드는 모두 무효다.
    test("a rollback that rebuilds the control server with the same settings invalidates codes", async () => {
        const state = server.captureRuntimeState();
        const issued = await server.issueEnrollmentCode("edge", null);
        if(!issued.ok) throw new Error(issued.reason);
        (server as any)._dirtyControl = true;
        expect(await server.restoreRuntimeState(state)).toEqual([]);
        expect(await requestEnrollment({host: "127.0.0.1", port, code: issued.code})).toMatchObject({ok: false, category: "rejected"});
        await expectFreshCodeWorks();
    });
});
