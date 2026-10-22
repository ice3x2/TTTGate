import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import AdminServer from "../../../../src/server/admin/AdminServer";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {BOOTSTRAP_TOKEN_FILE_NAME, IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {AuditEvent, AuditSink, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import UsablePortChecker from "../../../../src/util/UsablePortChecker";
import {getFreePort} from "../../../helpers/network";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

jest.setTimeout(60_000);

const ADMIN_PASSWORD = "ownership-admin-password";
const TRUSTED_CLIENT = "tc1";
const MIGRATED_PORT = 20001;

type ApiResponse = {status: number; headers: any; body: any};
type Auth = {Cookie: string; "X-CSRF-Token": string};
type StubSink = AuditSink & {events: AuditEvent[]};

const createStubSink = (): StubSink => ({
    events: [],
    reserve(): boolean { return true; },
    record(event: AuditEvent): Promise<void> { this.events.push(event); return Promise.resolve(); }
});

/** 포트 하나에 매인 JSON 요청 헬퍼. 두 describe 가 같은 구현을 각각 적지 않도록 여기 한 곳에 둔다. */
const requestTo = (port: number) =>
    async (method: string, target: string, body: object = {}, auth?: Auth): Promise<ApiResponse> => {
        const bytes = JSON.stringify(body);
        const response = await httpRequest({
            port, path: target, method,
            headers: {"Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bytes)), ...(auth ?? {})},
            body: bytes
        });
        let parsed: any;
        try { parsed = JSON.parse(response.body); } catch { parsed = response.body; }
        return {status: response.statusCode, headers: response.headers, body: parsed};
    };

const authOf = (response: ApiResponse): Auth => {
    const pairs = (response.headers["set-cookie"] as string[]).map((value) => value.split(";")[0]);
    return {
        Cookie: pairs.join("; "),
        "X-CSRF-Token": pairs.find((value) => value.startsWith("csrfToken="))!.slice("csrfToken=".length)
    };
};

/** 터널 옵션 본문. 일반 유저는 allowedClientIds 가 비면 ⑤ 단계에서 거부되므로 등록·허용된 tc1 을 싣는다(#99). */
const tunnelBody = (forwardPort: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    forwardPort, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0,
    allowedClientIds: [TRUSTED_CLIENT],
    expectedRevision: ServerOptionStore.instance.revisionState.currentRevision,
    ...extra
});

const groupAttributes = (visibility: string) => ({
    allowed_port_range: [{from: 20000, to: 20099}],
    allowed_protocols: ["TCP", "HTTP"],
    max_tunnel_count: 2,
    tunnel_visibility: visibility,
    allowed_trusted_clients: [TRUSTED_CLIENT]
});

describe("rbac-tunnel-ownership", () => {
    let testRoot: TestRoot;
    let api: AdminServer | undefined;
    let sink: StubSink;
    let bcryptCostBackup: number;
    let request: (method: string, target: string, body?: object, auth?: Auth) => Promise<ApiResponse>;
    let superuser: Auth;
    let alice: {auth: Auth; id: string};
    let bob: {auth: Auth; id: string};
    let carol: {auth: Auth; id: string};
    let groupOne: string;
    let groupTwo: string;
    let runtime: any;

    const serverYamlTunnels = async (): Promise<any[]> => {
        const raw = await fs.readFile(path.join(testRoot.rootDir, "config", "server.yaml"), "utf8");
        return YAML.parse(raw).tunnelingOptions ?? [];
    };

    const storedTunnel = async (forwardPort: number): Promise<any> =>
        (await serverYamlTunnels()).find((option: any) => option.forwardPort === forwardPort);

    const listTunnels = async (auth: Auth): Promise<any[]> => {
        const response = await request("GET", "/api/tunnelingOption", {}, auth);
        expect(response.status).toBe(200);
        return response.body.tunnelingOptions;
    };

    const setGroupAttributes = async (groupId: string, attributes: Record<string, unknown>): Promise<void> => {
        const response = await request("PUT", `/api/groups/${groupId}`, {attributes}, superuser);
        expect(response.status).toBe(200);
    };

    beforeAll(async () => {
        bcryptCostBackup = IdentityStore.bcryptCost;
        IdentityStore.bcryptCost = 4;
        testRoot = await createTestRoot("rbac-tunnel-ownership");
        applyTestRoot(testRoot.rootDir);
        await CertificationStore.instance.load();

        const store = ServerOptionStore.instance;
        // ownerId 가 없는 기존 터널(마이그레이션 전)을 미리 둔다.
        if(!store.updateServerOption({...store.serverOption, port: await getFreePort(),
            adminBindHost: "127.0.0.1", adminTls: false, tls: false, keepAlive: 0,
            trustedClients: [{clientId: TRUSTED_CLIENT, clientSecret: "tc1-secret-value"}],
            tunnelingOptions: [{forwardPort: MIGRATED_PORT, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0}]})) {
            throw new Error("ownership fixture: invalid server option");
        }

        runtime = {
            applyServerOption: jest.fn(async () => ({success: true, partial: false, warnings: [], failedScopes: [], restartRequiredScopes: []})),
            applyTunnelingOption: jest.fn(async () => ({success: true, partial: false, warnings: [], failedScopes: [], restartRequiredScopes: []})),
            externalServerStatus: jest.fn(() => ({online: true, sessions: 0})),
            externalServerStatuses: jest.fn(() => ServerOptionStore.instance.serverOption.tunnelingOptions
                .map((option) => ({port: option.forwardPort, online: true, sessions: 0}))),
            stopExternalPortServer: jest.fn(async () => true),
            activeExternalPortServer: jest.fn(async () => true),
            inactiveExternalPortServer: jest.fn(async () => true),
            applyExternalServerCert: jest.fn(async () => true),
            captureRuntimeState: jest.fn(() => ({external: {}})),
            reapplyActiveCaps: jest.fn()
        };
        api = new AdminServer(runtime as any, false);
        const port = await api.listen(0, "127.0.0.1");

        request = requestTo(port);

        await IdentityMigration.runAtStartup();
        const token = (await fs.readFile(path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();
        const bootstrap = await request("POST", "/api/login", {username: "admin", password: ADMIN_PASSWORD, bootstrapToken: token});
        expect(bootstrap.status).toBe(200);
        superuser = authOf(bootstrap);

        const one = await request("POST", "/api/groups", {name: "G1", attributes: groupAttributes("group_read")}, superuser);
        const two = await request("POST", "/api/groups", {name: "G2", attributes: groupAttributes("private")}, superuser);
        expect([one.status, two.status]).toEqual([201, 201]);
        groupOne = one.body.group.id;
        groupTwo = two.body.group.id;

        const addUser = async (username: string, groupId: string): Promise<{auth: Auth; id: string}> => {
            const created = await request("POST", "/api/users", {username, role: "regular", groupId}, superuser);
            expect(created.status).toBe(201);
            const first = await request("POST", "/api/login", {username, password: created.body.temporaryPassword});
            expect(first.status).toBe(200);
            const auth = authOf(first);
            const changed = await request("PUT", "/api/me/password",
                {currentPassword: created.body.temporaryPassword, newPassword: `${username}-next-password`}, auth);
            expect(changed.status).toBe(200);
            return {auth, id: created.body.user.id};
        };
        alice = await addUser("alice", groupOne);
        bob = await addUser("bob", groupOne);
        carol = await addUser("carol", groupTwo);

        sink = createStubSink();
        AuditSinkRegistry.set(sink);
    });

    afterAll(async () => {
        IdentityStore.bcryptCost = bcryptCostBackup;
        AuditSinkRegistry.reset();
        try { await api?.close(); } finally { await cleanupTestRoot(testRoot); }
    });

    it("일반 유저가 만든 터널은 본문의 ownerId 와 무관하게 자기 소유로 저장된다", async () => {
        const created = await request("POST", "/api/tunnelingOption", tunnelBody(20010, {ownerId: "u_someone"}), alice.auth);
        expect(created.status).toBe(200);
        expect((await storedTunnel(20010)).ownerId).toBe(alice.id);
    });

    it("#141 활성화 타임아웃은 상한 이하의 0 이상 숫자(초)만 받고, 끌 때는 보지 않는다", async () => {
        runtime.activeExternalPortServer.mockClear();
        for(const timeout of ["30", true, -5, 1e12, {}]) {
            const response = await request("POST", `/api/tunneling/active/${MIGRATED_PORT}`, {active: true, timeout}, superuser);
            expect({timeout, status: response.status}).toEqual({timeout, status: 400});
        }
        expect(runtime.activeExternalPortServer).not.toHaveBeenCalled();
        const valid = await request("POST", `/api/tunneling/active/${MIGRATED_PORT}`, {active: true, timeout: 30}, superuser);
        expect(valid.status).toBe(200);
        const absent = await request("POST", `/api/tunneling/active/${MIGRATED_PORT}`, {active: true}, superuser);
        expect(absent.status).toBe(200);
        // 그룹 상한(ms)이 1000 의 배수가 아니면 화면이 소수 초를 보낸다.
        const fractional = await request("POST", `/api/tunneling/active/${MIGRATED_PORT}`, {active: true, timeout: 1.5}, superuser);
        expect(fractional.status).toBe(200);
        expect(runtime.activeExternalPortServer.mock.calls.map((call: any[]) => call.slice(0, 2)))
            .toEqual([[MIGRATED_PORT, 30], [MIGRATED_PORT, 0], [MIGRATED_PORT, 1.5]]);
        const off = await request("POST", `/api/tunneling/active/${MIGRATED_PORT}`, {active: false, timeout: "garbage"}, superuser);
        expect(off.status).toBe(200);
    });

    // #170 — 본문 포트가 문자열이면 설정 행은 == 비교로 지워지지만 런타임 리스너는 키가 달라 남는다.
    it("#170 본문 forwardPort 는 1–65535 의 정수만 받는다", async () => {
        for(const forwardPort of [`${MIGRATED_PORT}.0`, String(MIGRATED_PORT), "0x4E21", 1.5, 0, 65536]) {
            const removed = await request("DELETE", "/api/tunnelingOption", tunnelBody(MIGRATED_PORT, {forwardPort}), superuser);
            expect({forwardPort, status: removed.status}).toEqual({forwardPort, status: 400});
        }
        expect(await storedTunnel(MIGRATED_PORT)).toBeDefined();
        for(const forwardPort of ["20077", "0x4E5D", 20077.5]) {
            const created = await request("POST", "/api/tunnelingOption", tunnelBody(20077, {forwardPort}), superuser);
            expect({forwardPort, status: created.status}).toEqual({forwardPort, status: 400});
        }
        expect((await serverYamlTunnels()).map((option: any) => option.forwardPort)).not.toContain("20077");
    });

    it("그룹 속성 밖의 포트와 프로토콜은 거부된다", async () => {
        const outside = await request("POST", "/api/tunnelingOption", tunnelBody(30000), alice.auth);
        expect({status: outside.status, code: outside.body.code}).toEqual({status: 422, code: "port_not_allowed"});

        const https = await request("POST", "/api/tunnelingOption", tunnelBody(20015, {protocol: "https"}), alice.auth);
        expect({status: https.status, code: https.body.code}).toEqual({status: 422, code: "protocol_not_allowed"});
    });

    it("터널 수 상한을 넘기면 409 다", async () => {
        const second = await request("POST", "/api/tunnelingOption", tunnelBody(20011), alice.auth);
        expect(second.status).toBe(200);

        const third = await request("POST", "/api/tunnelingOption", tunnelBody(20012), alice.auth);
        expect({status: third.status, code: third.body.code}).toEqual({status: 409, code: "tunnel_count_exceeded"});
    });

    it("그룹 범위를 좁히면 기존 터널의 수정도 막힌다", async () => {
        await setGroupAttributes(groupOne, {allowed_port_range: [{from: 20011, to: 20099}]});
        const narrowed = await request("POST", "/api/tunnelingOption", tunnelBody(20010, {destinationPort: 10}), alice.auth);
        expect({status: narrowed.status, code: narrowed.body.code}).toEqual({status: 422, code: "port_not_allowed"});

        await setGroupAttributes(groupOne, {allowed_port_range: [{from: 20000, to: 20099}]});
        const restored = await request("POST", "/api/tunnelingOption", tunnelBody(20010, {destinationPort: 10}), alice.auth);
        expect(restored.status).toBe(200);
    });

    it("일반 유저는 인증서를 함께 올릴 수 없다", async () => {
        const withCert = await request("POST", "/api/tunnelingOption",
            tunnelBody(20010, {certInfo: {key: {name: "k", value: "v"}, cert: {name: "c", value: "v"}, ca: {name: "", value: ""}}}), alice.auth);
        expect({status: withCert.status, code: withCert.body.code}).toEqual({status: 403, code: "forbidden"});
    });

    it("목록은 소유와 가시성으로 걸러지고 owner·editable 이 붙는다", async () => {
        const forAlice = await listTunnels(alice.auth);
        expect(forAlice.map((option: any) => option.forwardPort).sort()).toEqual([20010, 20011]);
        for(const option of forAlice) {
            expect(option.owner).toEqual({id: alice.id, username: "alice"});
            expect(option.editable).toBe(true);
            // 저장된 ownerId 도 응답에 그대로 남아야 한다. owner 는 그것을 풀어 보인 것이지 대체가 아니다.
            expect(option.ownerId).toBe(alice.id);
        }

        const forBob = await listTunnels(bob.auth);
        expect(forBob.map((option: any) => option.forwardPort).sort()).toEqual([20010, 20011]);
        expect(forBob.every((option: any) => option.editable === false)).toBe(true);

        expect(await listTunnels(carol.auth)).toEqual([]);

        const forSuperuser = await listTunnels(superuser);
        expect(forSuperuser.map((option: any) => option.forwardPort).sort()).toEqual([20001, 20010, 20011]);
        expect(forSuperuser.find((option: any) => option.forwardPort === MIGRATED_PORT).owner).toEqual({id: "system:migrated"});
        expect(forSuperuser.every((option: any) => option.editable === true)).toBe(true);
    });

    it("외부 서버 상태도 같은 필터를 거친다", async () => {
        const forCarol = await request("GET", "/api/externalServerStatuses", {}, carol.auth);
        expect(forCarol.status).toBe(200);
        expect(forCarol.body.statuses).toEqual([]);

        const forBob = await request("GET", "/api/externalServerStatuses", {}, bob.auth);
        expect(forBob.status).toBe(200);
        expect(forBob.body.statuses.map((status: any) => status.port).sort()).toEqual([20010, 20011]);
    });

    it("경로 포트는 판정과 동작이 같은 값으로 읽고, 숫자가 아닌 표기는 거절한다", async () => {
        // 피해 터널: 슈퍼유저 소유 20. alice 는 20010 을 소유한다. Number("20.010e3") 는 20010, parseInt 는 20 이다.
        // 생성 API 는 포트를 실제로 열어 본다. 1024 미만은 Linux 에서 root 가 아니면 열 수 없으므로
        // 런타임과 같이 이 검사도 대신한다(#189). 이 테스트가 보는 것은 경로 포트 파싱이다.
        const usable = jest.spyOn(UsablePortChecker, "check").mockResolvedValueOnce(true);
        const victim = await request("POST", "/api/tunnelingOption", tunnelBody(20), superuser);
        usable.mockRestore();
        expect(victim.status).toBe(200);
        const touched = (): number[] => [
            ...runtime.activeExternalPortServer.mock.calls, ...runtime.inactiveExternalPortServer.mock.calls,
            ...runtime.applyExternalServerCert.mock.calls
        ].map((call: any[]) => call[0]);
        runtime.activeExternalPortServer.mockClear();
        runtime.inactiveExternalPortServer.mockClear();
        runtime.applyExternalServerCert.mockClear();
        try {
            for(const disguised of ["20.010e3", "2.0010e1"]) {
                const on = await request("POST", `/api/tunneling/active/${disguised}`, {active: true}, alice.auth);
                const off = await request("POST", `/api/tunneling/active/${disguised}`, {active: false}, alice.auth);
                const certRemoved = await request("DELETE", `/api/externalCert/${disguised}`, {}, alice.auth);
                const certRead = await request("GET", `/api/externalCert/${disguised}`, {}, alice.auth);
                for(const response of [on, off, certRemoved, certRead]) {
                    expect(response.status).not.toBe(200);
                }
            }
            expect(touched()).not.toContain(20);

            // 슈퍼유저에게도 숫자가 아닌 표기는 형식 오류다.
            for(const malformed of ["20.010e3", "0x4E2A", "20010abc", "%2020010", "20010.0", "020010", "02001", "65536", "0"]) {
                const response = await request("POST", `/api/tunneling/active/${malformed}`, {active: true}, superuser);
                expect({malformed, status: response.status}).toEqual({malformed, status: 400});
                // 인증서 라우트(tunnel:cert, 슈퍼유저 전용)도 같은 파싱이다. 예전에는 감사 대상과 실제 포트가 어긋났다.
                const certRemoved = await request("DELETE", `/api/externalCert/${malformed}`, {}, superuser);
                const certRead = await request("GET", `/api/externalCert/${malformed}`, {}, superuser);
                expect({malformed, status: [certRemoved.status, certRead.status]}).toEqual({malformed, status: [400, 400]});
            }
            expect(touched()).toEqual([]);

            // 정상 표기는 그대로 동작한다.
            const valid = await request("POST", "/api/tunneling/active/20010", {active: true}, alice.auth);
            expect(valid.status).toBe(200);
            expect(touched()).toEqual([20010]);
        } finally {
            const removed = await request("DELETE", "/api/tunnelingOption", tunnelBody(20), superuser);
            expect(removed.status).toBe(200);
        }
    });

    it("같은 그룹의 다른 사람은 읽을 수 있어도 고치지 못한다", async () => {
        const write = await request("POST", "/api/tunnelingOption", tunnelBody(20010), bob.auth);
        expect({status: write.status, code: write.body.code}).toEqual({status: 403, code: "read_only"});

        const updated = await request("PUT", "/api/tunnelingOption", tunnelBody(20010), bob.auth);
        expect({status: updated.status, code: updated.body.code}).toEqual({status: 403, code: "read_only"});

        const removed = await request("DELETE", "/api/tunnelingOption", tunnelBody(20010), bob.auth);
        expect({status: removed.status, code: removed.body.code}).toEqual({status: 403, code: "read_only"});

        const activated = await request("POST", "/api/tunneling/active/20010", {active: true}, bob.auth);
        expect(activated.status).toBe(403);
    });

    it("다른 그룹 사람에게는 남의 터널과 없는 터널이 구분되지 않는다", async () => {
        // 전제: 20010 은 실재하며 소유자는 alice 다. 이것이 없으면 아래 응답이 모두 '없는 포트' 라 공회전한다.
        expect((await storedTunnel(20010)).ownerId).toBe(alice.id);
        expect((await listTunnels(alice.auth)).map((option: any) => option.forwardPort)).toContain(20010);

        const write = await request("POST", "/api/tunnelingOption", tunnelBody(20010), carol.auth);
        const updated = await request("PUT", "/api/tunnelingOption", tunnelBody(20010), carol.auth);
        const removed = await request("DELETE", "/api/tunnelingOption", tunnelBody(20010), carol.auth);
        const activated = await request("POST", "/api/tunneling/active/20010", {active: true}, carol.auth);
        const absent = await request("POST", "/api/tunneling/active/65000", {active: true}, carol.auth);

        for(const response of [write, updated, removed, activated, absent]) {
            expect(response.status).toBe(404);
        }
        const bodies = [write, updated, removed, activated, absent].map((response) => JSON.stringify(response.body));
        expect(new Set(bodies).size).toBe(1);
    });

    it("system:migrated 터널은 일반 유저에게 보이지 않고 슈퍼유저만 지운다", async () => {
        // ownerId 가 없는 옛 터널은 슈퍼유저에게만 보이고, 소유자는 system:migrated 로 읽힌다.
        expect((await storedTunnel(MIGRATED_PORT)).ownerId).toBeUndefined();
        const seenBySuperuser = (await listTunnels(superuser)).find((option: any) => option.forwardPort === MIGRATED_PORT);
        expect(seenBySuperuser.owner).toEqual({id: "system:migrated"});
        expect(seenBySuperuser.editable).toBe(true);
        // 전제: alice 목록이 비어 있지 않다. 비어 있으면 아래 not.toContain 이 무엇을 넣어도 통과한다.
        const forAlice = (await listTunnels(alice.auth)).map((option: any) => option.forwardPort);
        expect(forAlice.length).toBeGreaterThan(0);
        expect(forAlice).not.toContain(MIGRATED_PORT);

        const byAlice = await request("DELETE", "/api/tunnelingOption", tunnelBody(MIGRATED_PORT), alice.auth);
        expect(byAlice.status).toBe(404);

        const bySuperuser = await request("DELETE", "/api/tunnelingOption", tunnelBody(MIGRATED_PORT), superuser);
        expect(bySuperuser.status).toBe(200);
    });

    it("포트를 바꿔도 소유자가 유지되고 남의 터널은 바꿀 수 없다", async () => {
        const renamed = await request("POST", "/api/tunnelingOption",
            tunnelBody(20020, {previousForwardPort: 20010}), alice.auth);
        expect(renamed.status).toBe(200);
        expect((await storedTunnel(20020)).ownerId).toBe(alice.id);
        expect(await storedTunnel(20010)).toBeUndefined();

        const byCarol = await request("POST", "/api/tunnelingOption",
            tunnelBody(20021, {previousForwardPort: 20011}), carol.auth);
        expect(byCarol.status).toBe(404);
    });

    it("슈퍼유저는 소유자를 재할당하고 감사에 남는다", async () => {
        sink.events.length = 0;
        const reassigned = await request("PUT", "/api/tunnelingOption/20011/owner",
            {ownerId: carol.id, expectedRevision: ServerOptionStore.instance.revisionState.currentRevision}, superuser);
        expect(reassigned.status).toBe(200);
        expect(reassigned.body.owner).toEqual({id: carol.id, username: "carol"});

        expect((await listTunnels(alice.auth)).map((option: any) => option.forwardPort)).toEqual([20020]);
        expect((await listTunnels(carol.auth)).map((option: any) => option.forwardPort)).toEqual([20011]);

        const event = sink.events.find((candidate) => candidate.type === "tunnel_reassigned");
        expect(event).toBeDefined();
        expect(event!.detail).toMatchObject({from: alice.id, to: carol.id});
    });

    // #137 — 소유자·사용자 그룹·그룹 속성을 바꾸면 활성 중인 터널의 수명 상한을 다시 계산하게 한다.
    it("#137 소유자 재할당·사용자 그룹 이동·그룹 속성 변경 뒤 활성 터널의 상한을 다시 계산한다", async () => {
        const revision = () => ServerOptionStore.instance.revisionState.currentRevision;
        runtime.reapplyActiveCaps.mockClear();
        expect((await request("PUT", "/api/tunnelingOption/20011/owner", {ownerId: alice.id, expectedRevision: revision()}, superuser)).status).toBe(200);
        expect(runtime.reapplyActiveCaps).toHaveBeenCalledTimes(1);
        expect((await request("PUT", `/api/users/${bob.id}`, {groupId: groupTwo}, superuser)).status).toBe(200);
        expect(runtime.reapplyActiveCaps).toHaveBeenCalledTimes(2);
        expect((await request("PUT", `/api/groups/${groupTwo}`, {attributes: {max_tunnel_duration_ms: 60_000}}, superuser)).status).toBe(200);
        expect(runtime.reapplyActiveCaps).toHaveBeenCalledTimes(3);
        // 원래대로 되돌린다(뒤 테스트가 소유·그룹을 전제로 한다).
        expect((await request("PUT", "/api/tunnelingOption/20011/owner", {ownerId: carol.id, expectedRevision: revision()}, superuser)).status).toBe(200);
        expect((await request("PUT", `/api/users/${bob.id}`, {groupId: groupOne}, superuser)).status).toBe(200);
    });

    it("재할당의 잘못된 입력과 권한 없는 호출은 거부된다", async () => {
        const revision = () => ServerOptionStore.instance.revisionState.currentRevision;
        const unknownUser = await request("PUT", "/api/tunnelingOption/20011/owner", {ownerId: "u_none", expectedRevision: revision()}, superuser);
        expect({status: unknownUser.status, code: unknownUser.body.code}).toEqual({status: 422, code: "owner_not_found"});

        const unknownPort = await request("PUT", "/api/tunnelingOption/65000/owner", {ownerId: carol.id, expectedRevision: revision()}, superuser);
        expect(unknownPort.status).toBe(404);

        const byAlice = await request("PUT", "/api/tunnelingOption/20011/owner", {ownerId: alice.id, expectedRevision: revision()}, alice.auth);
        expect({status: byAlice.status, code: byAlice.body.code}).toEqual({status: 403, code: "forbidden"});
    });

    it("슈퍼유저가 만든 터널은 자기 소유가 된다", async () => {
        const created = await request("POST", "/api/tunnelingOption", tunnelBody(20030), superuser);
        expect(created.status).toBe(200);
        const adminUser = IdentityStore.instance.userByUsername("admin")!;
        expect((await storedTunnel(20030)).ownerId).toBe(adminUser.id);
    });

    it("소유 터널이 있는 사용자는 지워지지 않는다", async () => {
        const blocked = await request("DELETE", `/api/users/${carol.id}`, {}, superuser);
        expect({status: blocked.status, code: blocked.body.code}).toEqual({status: 409, code: "user_owns_tunnels"});
        expect(blocked.body.message).toContain("20011");

        const released = await request("PUT", "/api/tunnelingOption/20011/owner",
            {ownerId: "system:migrated", expectedRevision: ServerOptionStore.instance.revisionState.currentRevision}, superuser);
        expect(released.status).toBe(200);

        const removed = await request("DELETE", `/api/users/${carol.id}`, {}, superuser);
        expect(removed.status).toBe(200);
    });

    it("슈퍼유저가 포트를 바꿔도 소유자는 그대로 남는다", async () => {
        // system:migrated 터널의 포트를 슈퍼유저가 바꾼다. 포트가 바뀐 것은 재할당이 아니므로 소유자가 옮겨가서는 안 된다.
        expect((await storedTunnel(20011)).ownerId).toBe("system:migrated");

        const renamed = await request("POST", "/api/tunnelingOption",
            tunnelBody(20021, {previousForwardPort: 20011}), superuser);
        expect(renamed.status).toBe(200);
        expect((await storedTunnel(20021)).ownerId).toBe("system:migrated");

        // 뒤 케이스가 보는 상태를 되돌린다.
        const restored = await request("POST", "/api/tunnelingOption",
            tunnelBody(20011, {previousForwardPort: 20021}), superuser);
        expect(restored.status).toBe(200);
        expect((await storedTunnel(20011)).ownerId).toBe("system:migrated");
    });

    it("목록이 실어 준 owner·editable 을 그대로 되돌려 보내도 설정 파일에 남지 않는다", async () => {
        // 관리자 UI 는 받은 행을 그대로 PUT 한다. 응답 전용 필드가 server.yaml 에 섞여 들어가면 안 된다.
        const row = (await listTunnels(alice.auth)).find((option: any) => option.forwardPort === 20020);
        expect(row.owner).toEqual({id: alice.id, username: "alice"});
        expect(row.editable).toBe(true);

        const echoed = await request("POST", "/api/tunnelingOption",
            {...row, expectedRevision: ServerOptionStore.instance.revisionState.currentRevision}, alice.auth);
        expect(echoed.status).toBe(200);

        const stored = await storedTunnel(20020);
        expect(stored.ownerId).toBe(alice.id);
        expect(Object.keys(stored)).not.toContain("owner");
        expect(Object.keys(stored)).not.toContain("editable");
    });

    it("tunnel_crud 가 read_only 면 쓰기만 막히고 none 이면 목록도 막힌다", async () => {
        await setGroupAttributes(groupOne, {tunnel_crud: "read_only"});
        const write = await request("POST", "/api/tunnelingOption", tunnelBody(20020, {destinationPort: 11}), alice.auth);
        expect({status: write.status, code: write.body.code}).toEqual({status: 403, code: "read_only"});

        const readable = await listTunnels(alice.auth);
        expect(readable.map((option: any) => option.forwardPort)).toEqual([20020]);
        expect(readable[0].editable).toBe(false);

        await setGroupAttributes(groupOne, {tunnel_crud: "none"});
        const denied = await request("GET", "/api/tunnelingOption", {}, alice.auth);
        expect({status: denied.status, code: denied.body.code}).toEqual({status: 403, code: "tunnel_access_disabled"});

        await setGroupAttributes(groupOne, {tunnel_crud: "full"});
    });

    it("소유권은 설정 파일에 남아 저장소를 다시 읽어도 유지된다", async () => {
        // 싱글턴을 버리고 다시 만들면 생성자가 server.yaml 을 다시 읽는다. 재시작과 같은 상태다.
        ServerOptionStore.resetForTest();
        const reloaded = ServerOptionStore.instance;
        expect(reloaded.getTunnelingOption(20020)!.ownerId).toBe(alice.id);
        expect(reloaded.getTunnelingOption(20011)!.ownerId).toBe("system:migrated");
    });
});

describe("rbac-tunnel-ownership: legacy-fallback", () => {
    let testRoot: TestRoot;
    let api: AdminServer | undefined;
    let bcryptCostBackup: number;

    beforeAll(() => { bcryptCostBackup = IdentityStore.bcryptCost; IdentityStore.bcryptCost = 4; });
    afterAll(() => { IdentityStore.bcryptCost = bcryptCostBackup; });

    afterEach(async () => {
        try { await api?.close(); } finally { await cleanupTestRoot(testRoot); }
    });

    it("legacy-admin 이 만든 터널의 소유자는 system:migrated 다", async () => {
        testRoot = await createTestRoot("rbac-tunnel-legacy");
        applyTestRoot(testRoot.rootDir);
        await CertificationStore.instance.load();
        const bcrypt = require("bcryptjs");
        await fs.writeFile(path.join(testRoot.rootDir, "config", "identity.yaml"), "version: 1\nusers: []\ngroups: []\n", "utf-8");
        await fs.writeFile(path.join(testRoot.rootDir, "config", ".key"), bcrypt.hashSync("legacy-password", 4), "utf-8");

        const store = ServerOptionStore.instance;
        if(!store.updateServerOption({...store.serverOption, port: await getFreePort(),
            adminBindHost: "127.0.0.1", adminTls: false, tls: false, keepAlive: 0, tunnelingOptions: []})) {
            throw new Error("legacy fixture: invalid server option");
        }
        const runtime = {
            applyTunnelingOption: jest.fn(async () => ({success: true, partial: false, warnings: [], failedScopes: [], restartRequiredScopes: []})),
            externalServerStatus: jest.fn(() => ({online: true, sessions: 0})),
            externalServerStatuses: jest.fn(() => []),
            stopExternalPortServer: jest.fn(async () => true),
            captureRuntimeState: jest.fn(() => ({external: {}}))
        };
        api = new AdminServer(runtime as any, false);
        const port = await api.listen(0, "127.0.0.1");
        await IdentityMigration.runAtStartup();

        const send = requestTo(port);

        const login = await send("POST", "/api/login", {username: "admin", password: "legacy-password"});
        expect(login.status).toBe(200);

        const created = await send("POST", "/api/tunnelingOption", tunnelBody(20040), authOf(login));
        expect(created.status).toBe(200);

        const raw = await fs.readFile(path.join(testRoot.rootDir, "config", "server.yaml"), "utf8");
        const stored = (YAML.parse(raw).tunnelingOptions ?? []).find((option: any) => option.forwardPort === 20040);
        expect(stored.ownerId).toBe("system:migrated");
    });
});
