import {CertificationStore, CONTROL_CERT_SERVER_NAME} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import TTTServer from "../../../src/server/TTTServer";
import TTTClient from "../../../src/client/TTTClient";
import {DEFAULT_KEY, ServerOption, TrustedClient} from "../../../src/types/TunnelingOption";
import {requestEnrollment} from "../../../src/client/ClientEnrollment";
import {AuditEvent, AuditSink, AuditSinkRegistry} from "../../../src/server/audit/AuditSink";
import {getFreePort, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(60_000);

class MemorySink implements AuditSink {
    public readonly events: AuditEvent[] = [];
    reserve(): boolean { return true; }
    async record(event: AuditEvent): Promise<void> { this.events.push(event); }
}

const TRUSTED: TrustedClient[] = [
    {clientId: "edge", clientSecret: "edge-secret", displayName: "Edge"},
    {clientId: "other", clientSecret: "other-secret", displayName: "Other"}
];

// #212 등록 교환·핫 갱신, #214 클라이언트 교환
describe("trusted client enrollment and hot update", () => {
    let root: TestRoot;
    let server: TTTServer;
    let port: number;
    let sink: MemorySink;
    const clients: TTTClient[] = [];

    const start = async (override: Partial<ServerOption> = {}) => {
        await CertificationStore.instance.load();
        port = await getFreePort();
        const option: ServerOption = {key: DEFAULT_KEY, adminPort: 9300, adminBindHost: "127.0.0.1", adminTls: true, port, tls: true,
            controlProtocolMode: "mixed", trustedClients: TRUSTED, tunnelingOptions: [], keepAlive: 0, globalMemCacheLimit: 128, ...override};
        if(!ServerOptionStore.instance.updateServerOption(option)) throw new Error("bad fixture option");
        server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();
    };

    const connect = (clientId: string, clientSecret: string): TTTClient => {
        const client = TTTClient.create({host: "127.0.0.1", port, tls: true, key: DEFAULT_KEY, name: clientId, clientId, clientSecret,
            ca: CertificationStore.instance.getTempCert().cert.value, serverName: CONTROL_CERT_SERVER_NAME,
            allowLegacyFallback: false, keepAlive: 0, globalMemCacheLimit: 128});
        clients.push(client);
        client.start();
        return client;
    };
    const onlineIds = () => server.clientStatus().map((status) => status.clientId).sort();
    const poolIdOf = (clientId: string) => server.clientStatus().find((status) => status.clientId === clientId)?.id;

    beforeEach(async () => {
        root = await createTestRoot("enrollment");
        applyTestRoot(root.rootDir);
        sink = new MemorySink();
        AuditSinkRegistry.set(sink);
    });

    afterEach(async () => {
        clients.splice(0).forEach((client) => client.stop());
        await server?.close();
        AuditSinkRegistry.reset();
        await cleanupTestRoot(root);
    });

    test("REQ-4/5/6 a code gives the client id, secret, server name and control certificate once", async () => {
        await start();
        const issued = await server.issueEnrollmentCode("edge");
        if(!issued.ok) throw new Error(issued.reason);

        const result = await requestEnrollment({host: "127.0.0.1", port, code: issued.code});
        expect(result).toEqual({ok: true, payload: {clientId: "edge", clientSecret: "edge-secret", serverName: CONTROL_CERT_SERVER_NAME,
            tls: true, ca: CertificationStore.instance.getTempCert().cert.value}});

        const again = await requestEnrollment({host: "127.0.0.1", port, code: issued.code});
        expect(again).toMatchObject({ok: false, category: "rejected"});
        await waitFor(() => {
            const types = sink.events.map((event) => event.type);
            if(!types.includes("client_enrolled") || !types.includes("client_enroll_failed")) throw new Error("audit pending");
            return true;
        }, {timeoutMs: 5000, intervalMs: 25});
        expect(JSON.stringify(sink.events)).not.toContain(issued.code);
        expect(JSON.stringify(sink.events)).not.toContain("edge-secret");
    });

    test("the received settings authenticate a real client over verified TLS", async () => {
        await start();
        const issued = await server.issueEnrollmentCode("edge");
        if(!issued.ok) throw new Error(issued.reason);
        const result = await requestEnrollment({host: "127.0.0.1", port, code: issued.code});
        if(!result.ok) throw new Error(result.message);
        connect(result.payload.clientId, result.payload.clientSecret);
        await waitFor(() => { if(!onlineIds().includes("edge")) throw new Error("not online"); return true; }, {timeoutMs: 15_000, intervalMs: 50});
    });

    test("REQ-7 a wrong code is rejected without telling why; throttled attempts are not audited and leave no state", async () => {
        await start();
        expect(await requestEnrollment({host: "127.0.0.1", port, code: "0000-0000-0000"}))
            .toMatchObject({ok: false, category: "rejected"});
        for(let n = 0; n < 10; n++) await requestEnrollment({host: "127.0.0.1", port, code: "0000-0000-0000"});
        expect(await requestEnrollment({host: "127.0.0.1", port, code: "0000-0000-0000"})).toMatchObject({ok: false, category: "throttled"});
        await waitFor(() => { if((server.tunnelServer as any)._rejectedHandlerIds.size !== 0) throw new Error("rejected ids remain"); return true; },
            {timeoutMs: 5000, intervalMs: 50});
        // #227: 고정 대기 대신 조건으로 기다린다. 감사 여부는 응답을 보내기 전에 정해지므로, 제한 응답을 받은 뒤에는
        // 제한 사유의 감사가 새로 생길 수 없다.
        const failed = () => sink.events.filter((event) => event.type === "client_enroll_failed");
        await waitFor(() => { if(failed().length < 10) throw new Error(`audit pending: ${failed().length}`); return true; },
            {timeoutMs: 5000, intervalMs: 25});
        expect(failed()).toHaveLength(10);
        expect(failed().filter((event) => (event.detail as {reason?: string} | undefined)?.reason !== "rejected")).toEqual([]);
    });

    test("REQ-8 no code is issued while the control port is plain text or strict mTLS, or for an unknown client", async () => {
        await start({tls: false});
        expect(await server.issueEnrollmentCode("edge")).toEqual({ok: false, reason: "tls-required"});
        await server.close();
        await start({controlProtocolMode: "mtls-strict"});
        expect(await server.issueEnrollmentCode("edge")).toEqual({ok: false, reason: "strict-mode"});
        await server.close();
        await start();
        expect(await server.issueEnrollmentCode("nobody")).toEqual({ok: false, reason: "unknown-client"});
    });

    test("REQ-3 adding, removing and rotating trusted clients disconnects only the affected client", async () => {
        await start();
        connect("edge", "edge-secret");
        connect("other", "other-secret");
        await waitFor(() => { if(onlineIds().join() !== "edge,other") throw new Error(onlineIds().join()); return true; }, {timeoutMs: 15_000, intervalMs: 50});
        const edgePool = poolIdOf("edge");
        const otherPool = poolIdOf("other");

        const apply = async (trustedClients: TrustedClient[]) => {
            const previous = ServerOptionStore.instance.serverOption;
            const next = {...previous, trustedClients};
            expect(ServerOptionStore.instance.updateServerOption(next)).toBeTruthy();
            expect((await server.applyServerOption(next, previous)).success).toBe(true);
        };

        await apply([...TRUSTED, {clientId: "third", clientSecret: "third-secret"}]);
        expect(poolIdOf("edge")).toBe(edgePool);
        expect(poolIdOf("other")).toBe(otherPool);

        await apply([TRUSTED[0], {clientId: "third", clientSecret: "third-secret"}]);
        await waitFor(() => { if(onlineIds().includes("other")) throw new Error("other still online"); return true; }, {timeoutMs: 5000, intervalMs: 25});
        expect(poolIdOf("edge")).toBe(edgePool);

        await apply([{...TRUSTED[0], clientSecret: "rotated"}, {clientId: "third", clientSecret: "third-secret"}]);
        expect(poolIdOf("edge")).toBeUndefined();
    });
});
