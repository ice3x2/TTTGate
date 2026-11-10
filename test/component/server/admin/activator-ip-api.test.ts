import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import AdminServer from "../../../../src/server/admin/AdminServer";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {BOOTSTRAP_TOKEN_FILE_NAME, IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {AuditEvent, AuditSink, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {AdminSecurityPolicyRegistry} from "../../../../src/server/AdminSecurityPolicy";
import {activatorIpRestriction} from "../../../../src/server/rbac/TunnelActivatorIps";
import {getFreePort} from "../../../helpers/network";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

// 이슈 348 — 터널을 켠 사람의 IP 만 받는 설정과 허용 IP 목록의 관리 API. 런타임은 가짜로 두고 저장·권한·감사·응답을 본다.
// 요청자 IP 는 trustXForwardedFor 를 켜고 X-Forwarded-For 로 바꾼다(관리 화면이 리버스 프록시 뒤에 있는 배치와 같다).
jest.setTimeout(60_000);

const ADMIN_PASSWORD = "activator-admin-password";
const TRUSTED_CLIENT = "tc1";
const IP_ADMIN = "192.0.2.1";
const IP_ALICE = "198.51.100.10";
const IP_TOM = "198.51.100.20";

type ApiResponse = {status: number; headers: any; body: any};
type Auth = {Cookie: string; "X-CSRF-Token": string};
type Member = {auth: Auth; id: string};

const authOf = (response: ApiResponse): Auth => {
    const pairs = (response.headers["set-cookie"] as string[]).map((value) => value.split(";")[0]);
    return {
        Cookie: pairs.join("; "),
        "X-CSRF-Token": pairs.find((value) => value.startsWith("csrfToken="))!.slice("csrfToken=".length)
    };
};

const groupAttributes = (crud: string, visibility = "private") => ({
    tunnel_crud: crud,
    allowed_port_range: [{from: 21000, to: 21099}],
    allowed_protocols: ["TCP"],
    max_tunnel_count: 50,
    tunnel_visibility: visibility,
    allowed_trusted_clients: [TRUSTED_CLIENT]
});

describe("activator-ip API (이슈 348)", () => {
    let testRoot: TestRoot;
    let api: AdminServer | undefined;
    let sink: AuditSink & {events: AuditEvent[]};
    let bcryptCostBackup: number;
    let port: number;
    let superuser: Auth;
    let superuserId: string;
    let alice: Member;   // full
    let eve: Member;     // full, 다른 그룹(alice 의 터널을 볼 수 없다)
    let tom: Member;     // toggle(group_read). alice 의 터널을 공유받는다
    let tim: Member;     // toggle(group_read). tom 과 같은 그룹이라 tom 의 터널(21070)을 보기만 한다
    let toggleGroupId: string;
    let runtime: any;

    const request = async (method: string, target: string, body: object = {}, auth?: Auth, ip?: string): Promise<ApiResponse> => {
        const bytes = JSON.stringify(body);
        const response = await httpRequest({
            port, path: target, method,
            headers: {"Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bytes)), ...(auth ?? {}),
                ...(ip ? {"X-Forwarded-For": ip} : {})},
            body: bytes
        });
        let parsed: any;
        try { parsed = JSON.parse(response.body); } catch { parsed = response.body; }
        return {status: response.statusCode, headers: response.headers, body: parsed};
    };

    const revision = () => ServerOptionStore.instance.revisionState.currentRevision;
    const tunnelBody = (forwardPort: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
        forwardPort, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0,
        allowedClientIds: [TRUSTED_CLIENT], expectedRevision: revision(), ...extra
    });
    const saveTunnel = (auth: Auth, forwardPort: number, extra: Record<string, unknown> = {}, ip?: string) =>
        request("POST", "/api/tunnelingOption", tunnelBody(forwardPort, extra), auth, ip);
    const storedTunnel = async (forwardPort: number): Promise<any> => {
        const raw = await fs.readFile(path.join(testRoot.rootDir, "config", "server.yaml"), "utf8");
        return (YAML.parse(raw).tunnelingOptions ?? []).find((option: any) => option.forwardPort === forwardPort);
    };
    const storedIps = async (forwardPort: number) => (await storedTunnel(forwardPort))?.activatorIps;
    const activate = (auth: Auth, forwardPort: number, ip: string, active = true, timeout = 0) =>
        request("POST", `/api/tunneling/active/${forwardPort}`, {active, timeout}, auth, ip);
    const setLimit = (auth: Auth, forwardPort: number, enabled: unknown, ip: string) =>
        request("PUT", `/api/tunneling/${forwardPort}/activatorIpOnly`, {enabled}, auth, ip);
    const refresh = (auth: Auth, forwardPort: number, ip: string) =>
        request("POST", `/api/tunneling/${forwardPort}/activatorIp`, {}, auth, ip);
    const rowOf = async (auth: Auth, forwardPort: number) => {
        const response = await request("GET", "/api/tunnelingOption", {}, auth);
        expect(response.status).toBe(200);
        return response.body.tunnelingOptions.find((row: any) => row.forwardPort === forwardPort);
    };
    const statusOf = async (auth: Auth, forwardPort: number, ip: string) => {
        const response = await request("GET", "/api/externalServerStatuses", {}, auth, ip);
        expect(response.status).toBe(200);
        return {body: response.body, status: response.body.statuses.find((entry: any) => entry.port === forwardPort)};
    };
    const lastEvent = (type: string) => [...sink.events].reverse().find((event) => event.type === type)!;
    /** 판정에 쓰이는 허용 IP. 접속 판정과 같은 함수를 부른다. */
    const allowedOf = (forwardPort: number) => [...(activatorIpRestriction(forwardPort) ?? [])].sort();

    beforeAll(async () => {
        bcryptCostBackup = IdentityStore.bcryptCost;
        IdentityStore.bcryptCost = 4;
        testRoot = await createTestRoot("activator-ip-api");
        applyTestRoot(testRoot.rootDir);
        AdminSecurityPolicyRegistry.configure({trustXForwardedFor: true, trustedProxyHops: 1});
        await CertificationStore.instance.load();
        const store = ServerOptionStore.instance;
        if(!store.updateServerOption({...store.serverOption, port: await getFreePort(),
            adminBindHost: "127.0.0.1", adminTls: false, tls: false, keepAlive: 0,
            trustedClients: [{clientId: TRUSTED_CLIENT, clientSecret: "tc1-secret-value"}], tunnelingOptions: []})) {
            throw new Error("activator fixture: invalid server option");
        }
        const ok = () => ({success: true, partial: false, warnings: [], failedScopes: [], restartRequiredScopes: []});
        runtime = {
            applyServerOption: jest.fn(async () => ok()),
            applyTunnelingOption: jest.fn(async () => ok()),
            externalServerStatus: jest.fn(() => ({online: true, sessions: 0})),
            externalServerStatuses: jest.fn(() => ServerOptionStore.instance.serverOption.tunnelingOptions
                .map((option) => ({port: option.forwardPort, online: true, sessions: 0}))),
            stopExternalPortServer: jest.fn(async () => true),
            activeExternalPortServer: jest.fn(async () => true),
            inactiveExternalPortServer: jest.fn(async () => true),
            applyExternalServerCert: jest.fn(async () => true),
            applyConnectionSecurity: jest.fn(),
            captureRuntimeState: jest.fn(() => ({external: {}})),
            reapplyActiveCaps: jest.fn(),
            enforceActivatorIps: jest.fn(async () => undefined)
        };
        api = new AdminServer(runtime as any, false);
        port = await api.listen(0, "127.0.0.1");

        await IdentityMigration.runAtStartup();
        const token = (await fs.readFile(path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();
        const bootstrap = await request("POST", "/api/login", {username: "admin", password: ADMIN_PASSWORD, bootstrapToken: token});
        expect(bootstrap.status).toBe(200);
        superuser = authOf(bootstrap);
        superuserId = IdentityStore.instance.userByUsername("admin")!.id;

        const groupOf = async (name: string, attributes: object): Promise<string> => {
            const created = await request("POST", "/api/groups", {name, attributes}, superuser);
            expect(created.status).toBe(201);
            return created.body.group.id;
        };
        const full = await groupOf("Full", groupAttributes("full"));
        const other = await groupOf("Other", groupAttributes("full"));
        toggleGroupId = await groupOf("Toggle", groupAttributes("toggle", "group_read"));
        const addUser = async (username: string, groupId: string): Promise<Member> => {
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
        alice = await addUser("alice", full);
        eve = await addUser("eve", other);
        tom = await addUser("tomcat", toggleGroupId);
        tim = await addUser("timber", toggleGroupId);
        // tom 이 소유한 터널. 같은 그룹의 tim 은 group_read 로 보기만 한다(켜기 권한 없음).
        expect((await saveTunnel(superuser, 21070, {ownerId: tom.id, inactiveOnStartup: true}, IP_ADMIN)).status).toBe(200);

        sink = {events: [], reserve: () => true, record(event: AuditEvent) { this.events.push(event); return Promise.resolve(); }};
        AuditSinkRegistry.set(sink);
    });

    afterAll(async () => {
        IdentityStore.bcryptCost = bcryptCostBackup;
        AuditSinkRegistry.reset();
        AdminSecurityPolicyRegistry.reset();
        try { await api?.close(); } finally { await cleanupTestRoot(testRoot); }
    });

    describe("설정 (FR-1·AC-1)", () => {
        it("새 터널은 필드가 없어도 IP 제한이 켜진 채 저장되고, 바로 켜지면 만든 사람의 IP 가 들어간다 (FR-3)", async () => {
            expect((await saveTunnel(alice.auth, 21001, {}, IP_ALICE)).status).toBe(200);
            const stored = await storedTunnel(21001);
            expect(stored.activatorIpOnly).toBe(true);
            expect(stored.activatorIps).toEqual({[alice.id]: IP_ALICE});
        });

        it("본문에 false 를 주면 꺼진 채 만든다. boolean 이 아니면 422 다", async () => {
            expect((await saveTunnel(alice.auth, 21002, {activatorIpOnly: false, inactiveOnStartup: true}, IP_ALICE)).status).toBe(200);
            expect((await storedTunnel(21002)).activatorIpOnly).toBe(false);
            expect(await storedIps(21002)).toBeUndefined();
            const invalid = await saveTunnel(alice.auth, 21003, {activatorIpOnly: "yes"}, IP_ALICE);
            expect([invalid.status, invalid.body.code]).toEqual([422, "activator_ip_only_invalid"]);
            expect(await storedTunnel(21003)).toBeUndefined();
        });

        it("필드가 없는 기존 터널은 꺼짐으로 읽고, 필드 없이 고쳐 저장해도 값이 바뀌지 않는다", async () => {
            expect((await saveTunnel(alice.auth, 21004, {}, IP_ALICE)).status).toBe(200);
            const store = ServerOptionStore.instance;
            const {activatorIpOnly: _removed, activatorIps: _ips, ...legacy} = store.getTunnelingOption(21004)!;
            expect(store.updateTunnelingOption(legacy)).toBe(true);
            expect((await rowOf(alice.auth, 21004)).activatorIpOnly).toBe(false);
            expect((await saveTunnel(alice.auth, 21004, {destinationPort: 10}, IP_ALICE)).status).toBe(200);
            expect((await storedTunnel(21004)).activatorIpOnly).toBeUndefined();
            expect((await rowOf(alice.auth, 21004)).activatorIpOnly).toBe(false);
            expect(store.updateTunnelingOption({...store.getTunnelingOption(21004)!, activatorIpOnly: true})).toBe(true);
            expect((await saveTunnel(alice.auth, 21004, {destinationPort: 11}, IP_ALICE)).status).toBe(200);
            expect((await storedTunnel(21004)).activatorIpOnly).toBe(true);
        });

        it("저장 본문의 허용 IP 목록은 무시하고, 슈퍼유저가 아닌 사용자의 조회에는 목록이 없다 (AC-11·FR-6)", async () => {
            expect((await saveTunnel(alice.auth, 21005, {}, IP_ALICE)).status).toBe(200);
            const forged = await saveTunnel(alice.auth, 21005, {activatorIps: {[alice.id]: "203.0.113.66", u_fake: "203.0.113.67"}}, IP_ALICE);
            expect(forged.status).toBe(200);
            expect(await storedIps(21005)).toEqual({[alice.id]: IP_ALICE});
            const row = await rowOf(alice.auth, 21005);
            expect(row).not.toHaveProperty("activatorIps");
            expect(row.activatorIpOnly).toBe(true);
            expect((await rowOf(superuser, 21005)).activatorIps).toEqual({[alice.id]: IP_ALICE});
            // 슈퍼유저가 받은 목록 응답을 그대로 되돌려 보내도 목록은 서버 값이다.
            const echoed = await request("POST", "/api/tunnelingOption",
                {...(await rowOf(superuser, 21005)), activatorIps: {[superuserId]: "203.0.113.68"}, expectedRevision: revision()}, superuser, IP_ADMIN);
            expect(echoed.status).toBe(200);
            expect(await storedIps(21005)).toEqual({[alice.id]: IP_ALICE});
        });
    });

    describe("켜기와 허용 IP 목록 (FR-3·FR-5·AC-4·AC-5·AC-15)", () => {
        beforeAll(async () => {
            // 바로 켜지지 않는 터널. IP 제한을 켜며 만들었으므로 만든 사람의 항목만 있다.
            expect((await saveTunnel(alice.auth, 21010, {inactiveOnStartup: true, sharedUserIds: [tom.id]}, IP_ALICE)).status).toBe(200);
        });

        it("IP 제한을 켜며 만든 터널에는 만든 사람의 항목이 있다", async () => {
            expect(await storedIps(21010)).toEqual({[alice.id]: IP_ALICE});
        });

        it("공유된 사용자가 켜면 그 사람의 항목만 넣고 감사 detail 에 이전·새 IP 를 남긴다", async () => {
            sink.events.length = 0;
            runtime.enforceActivatorIps.mockClear();
            expect((await activate(tom.auth, 21010, IP_TOM)).status).toBe(200);
            expect(await storedIps(21010)).toEqual({[alice.id]: IP_ALICE, [tom.id]: IP_TOM});
            expect(lastEvent("tunnel_activated").detail).toMatchObject({allowedIpBefore: null, allowedIp: IP_TOM});
            expect(runtime.enforceActivatorIps).toHaveBeenCalledWith(21010);
            expect(allowedOf(21010)).toEqual([IP_ALICE, IP_TOM].sort());
        });

        it("이미 켜진 터널에 다시 켜기(시간 변경)를 보내면 요청자 항목만 바뀌고, 끄기는 목록을 바꾸지 않는다 (AC-15)", async () => {
            expect((await activate(tom.auth, 21010, "198.51.100.21", true, 600)).status).toBe(200);
            expect(await storedIps(21010)).toEqual({[alice.id]: IP_ALICE, [tom.id]: "198.51.100.21"});
            expect(lastEvent("tunnel_activated").detail).toMatchObject({allowedIpBefore: IP_TOM, allowedIp: "198.51.100.21"});
            sink.events.length = 0;
            expect((await activate(alice.auth, 21010, "203.0.113.99", false)).status).toBe(200);
            expect(await storedIps(21010)).toEqual({[alice.id]: IP_ALICE, [tom.id]: "198.51.100.21"});
            expect(lastEvent("tunnel_deactivated").detail).not.toHaveProperty("allowedIp");
        });

        it("꺼도 IP 제한과 목록이 그대로이고, 다시 켜면 켠 사람의 항목만 바뀐다 (AC-5)", async () => {
            expect((await activate(alice.auth, 21010, "203.0.113.7")).status).toBe(200);
            expect(await storedIps(21010)).toEqual({[alice.id]: "203.0.113.7", [tom.id]: "198.51.100.21"});
            expect((await storedTunnel(21010)).activatorIpOnly).toBe(true);
        });

        it("같은 IP 로 다시 켜면 설정을 저장하지 않는다", async () => {
            const before = revision();
            expect((await activate(alice.auth, 21010, "203.0.113.7")).status).toBe(200);
            expect(revision()).toBe(before);
            expect(lastEvent("tunnel_activated").detail).not.toHaveProperty("allowedIp");
        });

        it("요청자 IP 를 모르면 목록을 바꾸지 않고 켜기는 그대로 진행한다 (FR-3)", async () => {
            const spy = jest.spyOn(api as any, "getClientAddress").mockReturnValue("unknown");
            try {
                runtime.activeExternalPortServer.mockClear();
                expect((await activate(tom.auth, 21010, IP_TOM)).status).toBe(200);
                expect(runtime.activeExternalPortServer).toHaveBeenCalledTimes(1);
            } finally { spy.mockRestore(); }
            expect(await storedIps(21010)).toEqual({[alice.id]: "203.0.113.7", [tom.id]: "198.51.100.21"});
        });

        it("공유를 해제하면 그 사용자의 항목을 지우고 기존 연결 정리를 부른다 (FR-5·AC-12)", async () => {
            runtime.enforceActivatorIps.mockClear();
            expect((await saveTunnel(alice.auth, 21010, {sharedUserIds: [], inactiveOnStartup: true}, IP_ALICE)).status).toBe(200);
            expect(await storedIps(21010)).toEqual({[alice.id]: "203.0.113.7"});
            expect(runtime.enforceActivatorIps).toHaveBeenCalledWith(21010);
        });
    });

    describe("IP 제한 켜기·끄기 PUT /api/tunneling/:port/activatorIpOnly (FR-12·AC-13)", () => {
        beforeAll(async () => {
            expect((await saveTunnel(alice.auth, 21020, {activatorIpOnly: false, inactiveOnStartup: true, sharedUserIds: [tom.id]}, IP_ALICE)).status).toBe(200);
        });

        it("켜기 권한만 있는 사용자는 켤 수 있고, 켤 때 자기 항목이 없으면 넣는다", async () => {
            sink.events.length = 0;
            runtime.enforceActivatorIps.mockClear();
            const enabled = await setLimit(tom.auth, 21020, true, IP_TOM);
            expect(enabled.status).toBe(200);
            expect((await storedTunnel(21020)).activatorIpOnly).toBe(true);
            expect(await storedIps(21020)).toEqual({[tom.id]: IP_TOM});
            expect(lastEvent("tunnel_ip_limit_updated")).toMatchObject({outcome: "success", target: {kind: "tunnel", id: "21020"}, detail: {enabled: true}});
            expect(runtime.enforceActivatorIps).toHaveBeenCalledWith(21020);
            // 리스너를 다시 띄우지 않는다(FR-2).
            expect(runtime.applyTunnelingOption).not.toHaveBeenCalledWith(expect.objectContaining({forwardPort: 21020}), expect.anything(), expect.anything(), expect.anything(), expect.anything());
        });

        it("같은 값을 보내면 아무것도 바꾸지 않고 성공한다. 켜기 요청이면 요청자 항목이 없을 때만 넣는다", async () => {
            const before = revision();
            expect((await setLimit(tom.auth, 21020, true, "198.51.100.77")).status).toBe(200);
            expect(revision()).toBe(before);
            expect(await storedIps(21020)).toEqual({[tom.id]: IP_TOM});
            expect((await setLimit(alice.auth, 21020, true, IP_ALICE)).status).toBe(200);
            expect(await storedIps(21020)).toEqual({[tom.id]: IP_TOM, [alice.id]: IP_ALICE});
        });

        it("켜기 권한만 있는 사용자의 끄기는 403 read_only 이고, 고치기 권한이 있는 소유자는 끈다 (AC-13)", async () => {
            const denied = await setLimit(tom.auth, 21020, false, IP_TOM);
            expect([denied.status, denied.body.code]).toEqual([403, "read_only"]);
            expect((await storedTunnel(21020)).activatorIpOnly).toBe(true);
            expect((await setLimit(alice.auth, 21020, false, IP_ALICE)).status).toBe(200);
            expect((await storedTunnel(21020)).activatorIpOnly).toBe(false);
            // 끄더라도 목록은 지우지 않는다.
            expect(await storedIps(21020)).toEqual({[tom.id]: IP_TOM, [alice.id]: IP_ALICE});
        });

        it("볼 수만 있으면 403 read_only, 볼 수도 없으면 404, boolean 이 아니면 422 다", async () => {
            const readOnly = await setLimit(tim.auth, 21070, true, IP_TOM);
            expect([readOnly.status, readOnly.body.code]).toEqual([403, "read_only"]);
            expect((await setLimit(eve.auth, 21070, true, IP_TOM)).status).toBe(404);
            const invalid = await setLimit(alice.auth, 21020, "on", IP_ALICE);
            expect([invalid.status, invalid.body.code]).toEqual([422, "enabled_invalid"]);
            expect((await request("PUT", "/api/tunneling/29999/activatorIpOnly", {enabled: true}, superuser, IP_ADMIN)).status).toBe(404);
            expect((await request("PUT", "/api/tunneling/abc/activatorIpOnly", {enabled: true}, superuser, IP_ADMIN)).status).toBe(400);
            expect((await request("POST", "/api/tunneling/abc/activatorIp", {}, superuser, IP_ADMIN)).status).toBe(400);
        });

        it("편집 화면 저장으로 바꾸면 tunnel_updated 감사 detail 에 바뀐 값을 남긴다 (FR-15)", async () => {
            sink.events.length = 0;
            expect((await saveTunnel(alice.auth, 21020, {activatorIpOnly: true, inactiveOnStartup: true, sharedUserIds: [tom.id]}, IP_ALICE)).status).toBe(200);
            expect(lastEvent("tunnel_updated").detail).toMatchObject({activatorIpOnly: true});
            sink.events.length = 0;
            expect((await saveTunnel(alice.auth, 21020, {destinationPort: 12, inactiveOnStartup: true, sharedUserIds: [tom.id]}, IP_ALICE)).status).toBe(200);
            expect(lastEvent("tunnel_updated").detail).not.toHaveProperty("activatorIpOnly");
        });
    });

    describe("내 IP 갱신 POST /api/tunneling/:port/activatorIp (FR-4·FR-13·AC-9)", () => {
        beforeAll(async () => {
            expect((await saveTunnel(alice.auth, 21030, {inactiveOnStartup: true, sharedUserIds: [tom.id]}, IP_ALICE)).status).toBe(200);
        });

        it("꺼진 터널에도 갱신이 성공하고, 요청자 항목만 바꾸며 결과 IP 를 돌려준다", async () => {
            sink.events.length = 0;
            runtime.enforceActivatorIps.mockClear();
            const first = await refresh(tom.auth, 21030, IP_TOM);
            expect(first.status).toBe(200);
            expect(first.body).toMatchObject({allowedIp: IP_TOM, previousIp: null});
            const second = await refresh(tom.auth, 21030, "198.51.100.30");
            expect(second.body).toMatchObject({allowedIp: "198.51.100.30", previousIp: IP_TOM});
            expect(await storedIps(21030)).toEqual({[alice.id]: IP_ALICE, [tom.id]: "198.51.100.30"});
            expect(lastEvent("tunnel_ip_refreshed")).toMatchObject({outcome: "success", target: {kind: "tunnel", id: "21030"},
                detail: {allowedIpBefore: IP_TOM, allowedIp: "198.51.100.30"}});
            expect(runtime.enforceActivatorIps).toHaveBeenCalledWith(21030);
        });

        it("볼 수만 있으면 403 read_only, 볼 수도 없으면 404 다 (AC-9)", async () => {
            const readOnly = await refresh(tim.auth, 21070, IP_TOM);
            expect([readOnly.status, readOnly.body.code]).toEqual([403, "read_only"]);
            expect((await refresh(eve.auth, 21070, IP_TOM)).status).toBe(404);
            // 소유자는 꺼진 자기 터널의 IP 를 갱신한다.
            expect((await refresh(tom.auth, 21070, IP_TOM)).status).toBe(200);
        });

        it("요청자 IP 를 모르면 422 requester_ip_unknown 이고 목록을 바꾸지 않는다", async () => {
            const before = await storedIps(21030);
            const spy = jest.spyOn(api as any, "getClientAddress").mockReturnValue("unknown");
            try {
                const response = await refresh(tom.auth, 21030, IP_TOM);
                expect([response.status, response.body.code]).toEqual([422, "requester_ip_unknown"]);
            } finally { spy.mockRestore(); }
            expect(await storedIps(21030)).toEqual(before);
        });

        it("IPv4-mapped 주소는 IPv4 로 저장한다 (AC-8)", async () => {
            expect((await refresh(alice.auth, 21030, "::ffff:203.0.113.5")).body.allowedIp).toBe("203.0.113.5");
        });
    });

    describe("상태 API (FR-14)", () => {
        beforeAll(async () => {
            expect((await saveTunnel(alice.auth, 21040, {inactiveOnStartup: true, sharedUserIds: [tom.id]}, IP_ALICE)).status).toBe(200);
            expect((await refresh(tom.auth, 21040, IP_TOM)).status).toBe(200);
        });

        it("항목마다 IP 제한·내 항목·판정에 쓰이는 항목 수를, 최상위에 요청자 IP 를 준다", async () => {
            const {body, status} = await statusOf(tom.auth, 21040, "198.51.100.55");
            expect(body.requesterIp).toBe("198.51.100.55");
            expect(status).toMatchObject({activatorIpOnly: true, myAllowedIp: IP_TOM, allowedIpCount: 2});
            expect(status).not.toHaveProperty("allowedIps");
            const owner = await statusOf(alice.auth, 21040, IP_ALICE);
            expect(owner.status.myAllowedIp).toBe(IP_ALICE);
            expect(owner.status).not.toHaveProperty("allowedIps");
        });

        it("다른 사용자의 IP 는 슈퍼유저에게만 준다", async () => {
            const {status} = await statusOf(superuser, 21040, IP_ADMIN);
            expect(status).toMatchObject({myAllowedIp: null, allowedIps: {[alice.id]: IP_ALICE, [tom.id]: IP_TOM}});
        });
    });

    describe("판정에 쓰지 않는 항목과 지우는 항목 (FR-5·AC-12)", () => {
        it("비활성 사용자와 켜기 권한을 잃은 사용자의 항목은 남아 있어도 판정에 쓰지 않는다", async () => {
            expect((await saveTunnel(alice.auth, 21050, {inactiveOnStartup: true, sharedUserIds: [tom.id, tim.id]}, IP_ALICE)).status).toBe(200);
            expect((await refresh(tom.auth, 21050, IP_TOM)).status).toBe(200);
            expect((await refresh(tim.auth, 21050, "198.51.100.40")).status).toBe(200);
            expect(allowedOf(21050)).toEqual([IP_ALICE, IP_TOM, "198.51.100.40"].sort());

            runtime.enforceActivatorIps.mockClear();
            expect((await request("PUT", `/api/users/${tim.id}`, {status: "disabled"}, superuser)).status).toBe(200);
            expect(allowedOf(21050)).toEqual([IP_ALICE, IP_TOM].sort());
            expect(runtime.enforceActivatorIps).toHaveBeenCalled();
            expect((await statusOf(alice.auth, 21050, IP_ALICE)).status.allowedIpCount).toBe(2);
            expect((await storedIps(21050))[tim.id]).toBe("198.51.100.40");

            // 그룹 속성이 바뀌어 켜기 권한을 잃는다(toggle → none).
            runtime.enforceActivatorIps.mockClear();
            expect((await request("PUT", `/api/groups/${toggleGroupId}`, {attributes: {tunnel_crud: "none"}}, superuser)).status).toBe(200);
            expect(allowedOf(21050)).toEqual([IP_ALICE]);
            expect(runtime.enforceActivatorIps).toHaveBeenCalled();
            expect((await request("PUT", `/api/groups/${toggleGroupId}`, {attributes: {tunnel_crud: "toggle"}}, superuser)).status).toBe(200);
            expect(allowedOf(21050)).toEqual([IP_ALICE, IP_TOM].sort());
        });

        it("사용자를 지우면 모든 터널의 항목에서 사라진다", async () => {
            const leaver = await request("POST", "/api/users", {username: "leaver", role: "regular", groupId: toggleGroupId}, superuser);
            const leaverId = leaver.body.user.id;
            const store = ServerOptionStore.instance;
            expect(store.updateTunnelingOption({...store.getTunnelingOption(21050)!,
                activatorIps: {...(await storedIps(21050)), [leaverId]: "198.51.100.88"}})).toBe(true);
            runtime.enforceActivatorIps.mockClear();
            expect((await request("DELETE", `/api/users/${leaverId}`, {}, superuser)).status).toBe(200);
            expect(await storedIps(21050)).not.toHaveProperty(leaverId);
            expect(runtime.enforceActivatorIps).toHaveBeenCalled();
        });

        it("소유자를 재할당해 이전 소유자가 켜기 권한을 잃으면 그 항목을 지운다", async () => {
            expect((await saveTunnel(alice.auth, 21060, {inactiveOnStartup: true, sharedUserIds: [tom.id]}, IP_ALICE)).status).toBe(200);
            expect((await refresh(tom.auth, 21060, IP_TOM)).status).toBe(200);
            sink.events.length = 0;
            const moved = await request("PUT", "/api/tunnelingOption/21060/owner", {ownerId: eve.id, expectedRevision: revision()}, superuser);
            expect(moved.status).toBe(200);
            expect(await storedIps(21060)).toEqual({[tom.id]: IP_TOM});
            expect(lastEvent("tunnel_reassigned").detail).toMatchObject({allowedIpsRemoved: [alice.id]});
            // 공유받은 사용자를 새 소유자로 바꾸면 그 사람은 소유자로 켤 수 있으므로 항목을 지우지 않는다.
            const toTom = await request("PUT", "/api/tunnelingOption/21060/owner", {ownerId: tom.id, expectedRevision: revision()}, superuser);
            expect(toTom.status).toBe(200);
            expect(await storedIps(21060)).toEqual({[tom.id]: IP_TOM});
        });
    });
});
