import {withConfigurationServer} from "./configuration-revision-fixture";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {getFreePort} from "../../../helpers/network";
import {ADMIN_ROUTES} from "../../../../src/server/admin/routes";

jest.setTimeout(60_000);

const body = (response: {body: string}) => JSON.parse(response.body);
const revision = async (f: any) => (await f.snapshot()).revisionState.currentRevision;

// #212 신뢰 클라이언트 관리 API(REQ-1·1a·2·9·10·11)
describe("trusted client admin API", () => {
    test("REQ-1 create makes a server-generated secret that the API never returns", async () => withConfigurationServer(async f => {
        const created = await f.request("POST", "/api/trustedClients", {clientId: "edge-1", displayName: "Edge 1", expectedRevision: await revision(f)});
        expect(created.statusCode).toBe(201);
        expect(body(created).trustedClient).toEqual({clientId: "edge-1", displayName: "Edge 1"});
        const stored = f.store.serverOption.trustedClients.find((client: any) => client.clientId === "edge-1");
        expect(stored.clientSecret).toMatch(/^[0-9a-f]{64}$/);
        expect(created.body).not.toContain(stored.clientSecret);

        const duplicate = await f.request("POST", "/api/trustedClients", {clientId: "edge-1", expectedRevision: await revision(f)});
        expect(duplicate.statusCode).toBe(409);
        const invalid = await f.request("POST", "/api/trustedClients", {clientId: "bad id!", expectedRevision: await revision(f)});
        expect(invalid.statusCode).toBe(400);
    }));

    test("REQ-9/10 server options hide secrets, keep trusted clients when sent back, and refuse changes", async () => withConfigurationServer(async f => {
        await f.request("POST", "/api/trustedClients", {clientId: "edge-1", expectedRevision: await revision(f)});
        const secret = f.store.serverOption.trustedClients[0].clientSecret;
        const read = await f.snapshot();
        expect(JSON.stringify(read)).not.toContain(secret);
        expect(read.serverOption.trustedClients[0].clientSecret).toBe("********");

        const sentBack = await f.request("POST", "/api/serverOption", {...read.serverOption, globalMemCacheLimit: 129, expectedRevision: read.revisionState.currentRevision});
        expect(sentBack.statusCode).toBe(200);
        expect(f.store.serverOption.trustedClients[0].clientSecret).toBe(secret);

        const without = await f.snapshot();
        const {trustedClients: _omit, ...rest} = without.serverOption;
        expect((await f.request("POST", "/api/serverOption", {...rest, globalMemCacheLimit: 130, expectedRevision: without.revisionState.currentRevision})).statusCode).toBe(200);
        expect(f.store.serverOption.trustedClients).toHaveLength(1);

        const changed = await f.snapshot();
        const refused = await f.request("POST", "/api/serverOption", {...changed.serverOption,
            trustedClients: [{clientId: "edge-1", clientSecret: "attacker-chosen"}], expectedRevision: changed.revisionState.currentRevision});
        expect(refused.statusCode).toBe(400);
        expect(f.store.serverOption.trustedClients[0].clientSecret).toBe(secret);
    }));

    test("REQ-1a a client referenced by a tunnel or a group cannot be deleted", async () => withConfigurationServer(async f => {
        await f.request("POST", "/api/trustedClients", {clientId: "edge-1", expectedRevision: await revision(f)});
        const port = await getFreePort();
        expect((await f.request("POST", "/api/tunnelingOption", {forwardPort: port, protocol: "tcp", tls: false, destinationAddress: "127.0.0.1",
            destinationPort: 9, allowedClientIds: ["edge-1"], expectedRevision: await revision(f)})).statusCode).toBe(200);
        const blocked = await f.request("DELETE", `/api/trustedClients/edge-1`, {expectedRevision: await revision(f)});
        expect(blocked.statusCode).toBe(409);
        expect(body(blocked).references).toEqual([{kind: "tunnel", id: String(port)}]);

        expect((await f.request("DELETE", "/api/tunnelingOption", {forwardPort: port, expectedRevision: await revision(f)})).statusCode).toBe(200);
        const createdGroup = IdentityStore.instance.createGroup({name: "edge-group"});
        if(!createdGroup.success) throw new Error(createdGroup.message);
        const group = createdGroup.value;
        const updated = IdentityStore.instance.updateGroup(group.id, {attributes: {...group.attributes, allowed_trusted_clients: ["edge-1"]}});
        expect(updated.success).toBe(true);
        const byGroup = await f.request("DELETE", `/api/trustedClients/edge-1`, {expectedRevision: await revision(f)});
        expect(byGroup.statusCode).toBe(409);
        expect(body(byGroup).references).toEqual([{kind: "group", id: group.id}]);

        IdentityStore.instance.updateGroup(group.id, {attributes: {...group.attributes, allowed_trusted_clients: []}});
        expect((await f.request("DELETE", `/api/trustedClients/edge-1`, {expectedRevision: await revision(f)})).statusCode).toBe(200);
        expect(f.store.serverOption.trustedClients).toEqual([]);
    }));

    test("REQ-7 rotating the secret replaces it", async () => withConfigurationServer(async f => {
        await f.request("POST", "/api/trustedClients", {clientId: "edge-1", expectedRevision: await revision(f)});
        const before = f.store.serverOption.trustedClients[0].clientSecret;
        const rotated = await f.request("POST", `/api/trustedClients/edge-1/secret`, {expectedRevision: await revision(f)});
        expect(rotated.statusCode).toBe(200);
        expect(f.store.serverOption.trustedClients[0].clientSecret).not.toBe(before);
        expect(rotated.body).not.toContain(f.store.serverOption.trustedClients[0].clientSecret);
        expect((await f.request("POST", `/api/trustedClients/nobody/secret`, {expectedRevision: await revision(f)})).statusCode).toBe(404);
    }));

    test("REQ-4/8 enrollment codes need TLS on the control port and name the control port", async () => withConfigurationServer(async f => {
        await f.request("POST", "/api/trustedClients", {clientId: "edge-1", expectedRevision: await revision(f)});
        const plain = await f.request("POST", `/api/trustedClients/edge-1/enrollmentCode`, {});
        expect(plain.statusCode).toBe(409);
        expect(body(plain).code).toBe("TLS_REQUIRED");

        const read = await f.snapshot();
        expect((await f.request("POST", "/api/serverOption", {...read.serverOption, tls: true, expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
        const issued = await f.request("POST", `/api/trustedClients/edge-1/enrollmentCode`, {ttlMinutes: 30});
        expect(issued.statusCode).toBe(200);
        const value = body(issued);
        expect(value.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
        expect(value.expiresAt - Date.now()).toBeGreaterThan(29 * 60_000);
        expect(value.controlPort).toBe(f.store.serverOption.port);
        expect((await f.request("POST", `/api/trustedClients/nobody/enrollmentCode`, {})).statusCode).toBe(404);
    }));

    // #313: 감사 기록은 발급한 코드의 만료를 남긴다(없으면 기본 15분, null 은 만료 없음).
    test("#313 the enrollment_code_issued audit records the chosen expiry", () => {
        const route = ADMIN_ROUTES.find((candidate) => candidate.handler === "onIssueEnrollmentCode")!;
        const metaOf = (body: object) => (route.audit as any)({params: {id: "edge-1"}, body});
        expect(metaOf({ttlMinutes: null}).detail).toEqual({ttlMinutes: null, provisional: false});
        expect(metaOf({}).detail).toEqual({ttlMinutes: 15, provisional: false});
        expect(metaOf({ttlMinutes: 10080}).detail).toEqual({ttlMinutes: 10080, provisional: false});
        // 임시 발급은 확인할 때까지 기본 기한이다. 감사자가 실제 기한을 가릴 수 있게 남긴다.
        expect(metaOf({ttlMinutes: null, provisional: true}).detail).toEqual({ttlMinutes: null, provisional: true});
        // 감사 메타는 검증 전에 만든다. 정수와 null 이 아닌 값은 본문을 그대로 남기지 않는다.
        for(const wrong of ["x".repeat(1000), {nested: true}, 1.5, true]) expect(metaOf({ttlMinutes: wrong}).detail).toEqual({ttlMinutes: "invalid", provisional: false});
    });

    // #313: 확인 감사는 어느 발급을 확인했는지(issueId) 남겨 발급 기록과 짝짓게 한다.
    test("#313 the enrollment_code_confirmed audit records the issue it confirms", () => {
        const route = ADMIN_ROUTES.find((candidate) => candidate.handler === "onConfirmEnrollmentCode")!;
        const metaOf = (body: object) => (route.audit as any)({params: {id: "edge-1"}, body});
        expect(metaOf({issueId: 7}).detail).toEqual({issueId: 7});
        for(const wrong of ["x".repeat(1000), 1.5, -1, null]) expect(metaOf({issueId: wrong}).detail).toEqual({issueId: "invalid"});
    });

    // #313: 발급하는 사이에 더 새 발급이나 무효화가 있으면 서버는 superseded 를 돌려주고, API 는 409 ENROLLMENT_SUPERSEDED 로 알린다.
    test("#313 a superseded issue answers 409 ENROLLMENT_SUPERSEDED", async () => withConfigurationServer(async f => {
        await f.request("POST", "/api/trustedClients", {clientId: "edge-3", expectedRevision: await revision(f)});
        const original = f.tunnel.issueEnrollmentCode;
        f.tunnel.issueEnrollmentCode = async () => ({ok: false, reason: "superseded"});
        try {
            const answer = await f.request("POST", `/api/trustedClients/edge-3/enrollmentCode`, {ttlMinutes: null});
            expect({status: answer.statusCode, code: body(answer).code}).toEqual({status: 409, code: "ENROLLMENT_SUPERSEDED"});
        } finally {
            f.tunnel.issueEnrollmentCode = original;
        }
    }));

    // #313: 관리 화면은 provisional 로 받는다. 코드를 보여 준 뒤 확인해야 고른 기한이 되고, 확인이 없으면 기본 15분 뒤 사라진다.
    test("#313 a provisional code keeps the default expiry until it is confirmed", async () => withConfigurationServer(async f => {
        await f.request("POST", "/api/trustedClients", {clientId: "edge-4", expectedRevision: await revision(f)});
        const read = await f.snapshot();
        expect((await f.request("POST", "/api/serverOption", {...read.serverOption, tls: true, expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
        const confirmPath = "/api/trustedClients/edge-4/enrollmentCode/confirm";

        const first = await f.request("POST", "/api/trustedClients/edge-4/enrollmentCode", {ttlMinutes: null, provisional: true});
        expect(first.statusCode).toBe(200);
        const left = body(first).expiresAt - Date.now();
        expect(left).toBeGreaterThan(14 * 60_000);
        expect(left).toBeLessThanOrEqual(15 * 60_000);
        expect(Number.isInteger(body(first).issueId)).toBe(true);

        const second = await f.request("POST", "/api/trustedClients/edge-4/enrollmentCode", {ttlMinutes: null, provisional: true});
        const stale = await f.request("POST", confirmPath, {issueId: body(first).issueId});
        expect({status: stale.statusCode, code: body(stale).code}).toEqual({status: 409, code: "ENROLLMENT_SUPERSEDED"});
        const confirmed = await f.request("POST", confirmPath, {issueId: body(second).issueId});
        expect(confirmed.statusCode).toBe(200);
        expect(body(confirmed).expiresAt).toBeNull();

        for(const wrong of ["yes", 1, null]) {
            const rejected = await f.request("POST", "/api/trustedClients/edge-4/enrollmentCode", {provisional: wrong});
            expect({wrong, status: rejected.statusCode, code: body(rejected).code}).toEqual({wrong, status: 400, code: "INVALID_PROVISIONAL"});
        }
        for(const wrong of [undefined, "1", 1.5, -1]) {
            const rejected = await f.request("POST", confirmPath, {issueId: wrong});
            expect({wrong, status: rejected.statusCode, code: body(rejected).code}).toEqual({wrong, status: 400, code: "INVALID_ISSUE_ID"});
        }
        expect((await f.request("POST", "/api/trustedClients/nobody/enrollmentCode/confirm", {issueId: 1})).statusCode).toBe(404);
    }));

    // #313: ttlMinutes 는 1–43200(30일) 정수이거나 null(만료 없음)이다.
    test("#313 enrollment codes take 1..43200 minutes or null for no expiry", async () => withConfigurationServer(async f => {
        await f.request("POST", "/api/trustedClients", {clientId: "edge-2", expectedRevision: await revision(f)});
        const read = await f.snapshot();
        expect((await f.request("POST", "/api/serverOption", {...read.serverOption, tls: true, expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
        const never = await f.request("POST", `/api/trustedClients/edge-2/enrollmentCode`, {ttlMinutes: null});
        expect(never.statusCode).toBe(200);
        expect(body(never).expiresAt).toBeNull();
        const month = await f.request("POST", `/api/trustedClients/edge-2/enrollmentCode`, {ttlMinutes: 43200});
        expect(month.statusCode).toBe(200);
        expect(body(month).expiresAt - Date.now()).toBeGreaterThan(43199 * 60_000);
        for(const wrong of [43201, 0, 1.5, -1, "60", true]) {
            const rejected = await f.request("POST", `/api/trustedClients/edge-2/enrollmentCode`, {ttlMinutes: wrong});
            expect({wrong, status: rejected.statusCode, code: body(rejected).code}).toEqual({wrong, status: 400, code: "INVALID_TTL"});
        }
    }));
});
