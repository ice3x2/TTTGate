import {withConfigurationServer} from "./configuration-revision-fixture";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {AuditEvent, AuditSink, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {httpRequest} from "../../../helpers/http";
import {waitFor} from "../../../helpers/network";

jest.setTimeout(60_000);

class MemorySink implements AuditSink {
    public readonly events: AuditEvent[] = [];
    reserve(): boolean { return true; }
    async record(event: AuditEvent): Promise<void> { this.events.push(event); }
}

const REGULAR = {username: "tc-regular", password: "Regular-Password-1!"};
const revision = async (f: any) => (await f.snapshot()).revisionState.currentRevision;

/** 일반 사용자를 만들고 로그인해 그 세션으로 요청하는 함수를 돌려준다. */
const regularRequester = async (f: any) => {
    const previousCost = IdentityStore.bcryptCost;
    IdentityStore.bcryptCost = 4;
    try {
        const created = await IdentityStore.instance.createUser({username: REGULAR.username, role: "regular", password: REGULAR.password, mustChangePassword: false});
        if(!created.success) throw new Error(created.message);
    } finally { IdentityStore.bcryptCost = previousCost; }
    const login = await httpRequest({port: f.ports[0], path: "/api/login", method: "POST",
        headers: {"Content-Type": "application/json"}, body: JSON.stringify(REGULAR)});
    if(login.statusCode !== 200) throw new Error(`regular login failed: ${login.body}`);
    const cookies = login.headers["set-cookie"] as string[];
    const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
    const csrf = cookies.find((value) => value.startsWith("csrfToken="))!.split(";")[0].slice("csrfToken=".length);
    return (method: string, endpoint: string, body: object = {}) => httpRequest({port: f.ports[0], path: endpoint, method,
        headers: {"Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf, "Content-Length": String(Buffer.byteLength(JSON.stringify(body)))},
        body: JSON.stringify(body)});
};

// #220 — 신뢰 클라이언트 API 의 권한 거부(#212 REQ-2)와 관리 감사(#212 REQ-11)
describe("trusted client API authorization and audit (#220)", () => {
    afterEach(() => AuditSinkRegistry.reset());

    test("REQ-1 a user without server:manage gets 403 on every write route and nothing changes", async () => withConfigurationServer(async f => {
        expect((await f.request("POST", "/api/trustedClients", {clientId: "edge-1", expectedRevision: await revision(f)})).statusCode).toBe(201);
        const before = JSON.stringify(f.store.serverOption.trustedClients);
        const asRegular = await regularRequester(f);
        const rev = await revision(f);
        const attempts: Array<[string, string, object]> = [
            ["POST", "/api/trustedClients", {clientId: "intruder", expectedRevision: rev}],
            ["DELETE", "/api/trustedClients/edge-1", {expectedRevision: rev}],
            ["POST", "/api/trustedClients/edge-1/secret", {expectedRevision: rev}],
            ["POST", "/api/trustedClients/edge-1/enrollmentCode", {}]
        ];
        for(const [method, endpoint, body] of attempts) {
            const response = await asRegular(method, endpoint, body);
            expect([method, endpoint, response.statusCode]).toEqual([method, endpoint, 403]);
        }
        expect(JSON.stringify(f.store.serverOption.trustedClients)).toBe(before);
    }));

    test("REQ-2/3 every management action is audited on the trusted client, without secrets or codes", async () => withConfigurationServer(async f => {
        // 픽스처가 applyTestRoot 로 런타임 상태(감사 싱크 포함)를 초기화하므로 그 뒤에 건다.
        const sink = new MemorySink();
        AuditSinkRegistry.set(sink);
        expect((await f.request("POST", "/api/trustedClients", {clientId: "edge-1", expectedRevision: await revision(f)})).statusCode).toBe(201);
        expect((await f.request("POST", "/api/trustedClients/edge-1/secret", {expectedRevision: await revision(f)})).statusCode).toBe(200);
        const read = await f.snapshot();
        expect((await f.request("POST", "/api/serverOption", {...read.serverOption, tls: true, expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
        const issued = await f.request("POST", "/api/trustedClients/edge-1/enrollmentCode", {});
        expect(issued.statusCode).toBe(200);
        const code = JSON.parse(issued.body).code as string;
        const secret = f.store.serverOption.trustedClients[0].clientSecret as string;
        expect((await f.request("DELETE", "/api/trustedClients/edge-1", {expectedRevision: await revision(f)})).statusCode).toBe(200);

        const expected = ["trusted_client_created", "trusted_client_secret_rotated", "enrollment_code_issued", "trusted_client_deleted"];
        await waitFor(() => {
            const types = sink.events.map((event) => event.type);
            if(!expected.every((type) => types.includes(type as any))) throw new Error(`audit pending: ${types.join(",")}`);
            return true;
        }, {timeoutMs: 5000, intervalMs: 25});
        for(const type of expected) {
            const event = sink.events.find((candidate) => candidate.type === type)!;
            expect([type, event.target, event.outcome]).toEqual([type, {kind: "trusted_client", id: "edge-1"}, "success"]);
        }
        const dump = JSON.stringify(sink.events);
        expect(dump).not.toContain(secret);
        expect(dump).not.toContain(code);
        expect(dump).not.toContain(code.replace(/-/g, ""));
    }));
});
