import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import AdminServer from "../../../../src/server/admin/AdminServer";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {BOOTSTRAP_TOKEN_FILE_NAME, IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {AuditEvent, AuditSink, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {getFreePort} from "../../../helpers/network";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

// 이슈 347 — 켜기·끄기만 하는 그룹(toggle)과 터널 사용자 공유, 사용자 검색 API.
jest.setTimeout(60_000);

const ADMIN_PASSWORD = "share-admin-password";
const TRUSTED_CLIENT = "tc1";

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
    allowed_port_range: [{from: 20000, to: 20099}],
    allowed_protocols: ["TCP"],
    max_tunnel_count: 50,
    tunnel_visibility: visibility,
    allowed_trusted_clients: [TRUSTED_CLIENT]
});

describe("rbac-tunnel-share (이슈 347)", () => {
    let testRoot: TestRoot;
    let api: AdminServer | undefined;
    let sink: AuditSink & {events: AuditEvent[]};
    let bcryptCostBackup: number;
    let port: number;
    let superuser: Auth;
    let superuserId: string;
    let alice: Member;   // full
    let eve: Member;     // full, 같은 그룹
    let tom: Member;     // toggle, group_read
    let tim: Member;     // toggle, 같은 그룹
    let rita: Member;    // read_only
    let zedId: string;   // 비활성
    let runtime: any;

    const request = async (method: string, target: string, body: object = {}, auth?: Auth): Promise<ApiResponse> => {
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

    const revision = () => ServerOptionStore.instance.revisionState.currentRevision;

    const tunnelBody = (forwardPort: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
        forwardPort, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0,
        allowedClientIds: [TRUSTED_CLIENT], expectedRevision: revision(), ...extra
    });

    const saveTunnel = (auth: Auth, forwardPort: number, extra: Record<string, unknown> = {}) =>
        request("POST", "/api/tunnelingOption", tunnelBody(forwardPort, extra), auth);

    const storedTunnel = async (forwardPort: number): Promise<any> => {
        const raw = await fs.readFile(path.join(testRoot.rootDir, "config", "server.yaml"), "utf8");
        return (YAML.parse(raw).tunnelingOptions ?? []).find((option: any) => option.forwardPort === forwardPort);
    };

    const listTunnels = async (auth: Auth): Promise<any[]> => {
        const response = await request("GET", "/api/tunnelingOption", {}, auth);
        expect(response.status).toBe(200);
        return response.body.tunnelingOptions;
    };

    const rowOf = async (auth: Auth, forwardPort: number) => (await listTunnels(auth)).find((row) => row.forwardPort === forwardPort);

    const activate = (auth: Auth, forwardPort: number, active = true) =>
        request("POST", `/api/tunneling/active/${forwardPort}`, {active, timeout: 0}, auth);

    beforeAll(async () => {
        bcryptCostBackup = IdentityStore.bcryptCost;
        IdentityStore.bcryptCost = 4;
        testRoot = await createTestRoot("rbac-tunnel-share");
        applyTestRoot(testRoot.rootDir);
        await CertificationStore.instance.load();
        const store = ServerOptionStore.instance;
        if(!store.updateServerOption({...store.serverOption, port: await getFreePort(),
            adminBindHost: "127.0.0.1", adminTls: false, tls: false, keepAlive: 0,
            trustedClients: [{clientId: TRUSTED_CLIENT, clientSecret: "tc1-secret-value"}], tunnelingOptions: []})) {
            throw new Error("share fixture: invalid server option");
        }
        const ok = () => ({success: true, partial: false, warnings: [], failedScopes: [], restartRequiredScopes: []});
        runtime = {
            applyServerOption: jest.fn(async () => ok()),
            applyTunnelingOption: jest.fn(async () => ok()),
            externalServerStatus: jest.fn(() => ({online: true, sessions: 0})),
            // 이슈 369: 상태 응답의 허용 클라이언트 연결 여부.
            isClientConnected: jest.fn(() => false),
            externalServerStatuses: jest.fn(() => ServerOptionStore.instance.serverOption.tunnelingOptions
                .map((option) => ({port: option.forwardPort, online: true, sessions: 0}))),
            stopExternalPortServer: jest.fn(async () => true),
            activeExternalPortServer: jest.fn(async () => true),
            inactiveExternalPortServer: jest.fn(async () => true),
            applyExternalServerCert: jest.fn(async () => true),
            applyConnectionSecurity: jest.fn(),
            captureRuntimeState: jest.fn(() => ({external: {}})),
            reapplyActiveCaps: jest.fn()
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
        const toggle = await groupOf("Toggle", groupAttributes("toggle", "group_read"));
        const readOnly = await groupOf("ReadOnly", groupAttributes("read_only"));

        const addUser = async (username: string, groupId: string, displayName?: string): Promise<Member> => {
            const created = await request("POST", "/api/users", {username, role: "regular", groupId, ...(displayName ? {displayName} : {})}, superuser);
            expect(created.status).toBe(201);
            const first = await request("POST", "/api/login", {username, password: created.body.temporaryPassword});
            expect(first.status).toBe(200);
            const auth = authOf(first);
            const changed = await request("PUT", "/api/me/password",
                {currentPassword: created.body.temporaryPassword, newPassword: `${username}-next-password`}, auth);
            expect(changed.status).toBe(200);
            return {auth, id: created.body.user.id};
        };
        alice = await addUser("alice", full, "Alice Kim");
        eve = await addUser("eve", full);
        tom = await addUser("tomcat", toggle, "Tom Operator");
        tim = await addUser("timber", toggle);
        rita = await addUser("rita", readOnly);
        const zed = await request("POST", "/api/users", {username: "tomzed", role: "regular", groupId: toggle}, superuser);
        zedId = zed.body.user.id;
        expect((await request("PUT", `/api/users/${zedId}`, {status: "disabled"}, superuser)).status).toBe(200);

        sink = {events: [], reserve: () => true, record(event: AuditEvent) { this.events.push(event); return Promise.resolve(); }};
        AuditSinkRegistry.set(sink);
    });

    afterAll(async () => {
        IdentityStore.bcryptCost = bcryptCostBackup;
        AuditSinkRegistry.reset();
        try { await api?.close(); } finally { await cleanupTestRoot(testRoot); }
    });

    it("toggle 사용자는 소유한 터널을 켜고 끄지만, 고치기와 새로 만들기는 403 이다 (AC-1)", async () => {
        expect((await saveTunnel(superuser, 20001, {ownerId: tom.id})).status).toBe(200);
        expect((await activate(tom.auth, 20001)).status).toBe(200);
        expect((await activate(tom.auth, 20001, false)).status).toBe(200);
        const update = await saveTunnel(tom.auth, 20001, {destinationPort: 10});
        expect(update.status).toBe(403);
        expect(update.body.code).toBe("read_only");
        const create = await saveTunnel(tom.auth, 20002);
        expect(create.status).toBe(403);
        expect(create.body.code).toBe("tunnel_create_forbidden");
    });

    it("full 사용자가 공유하면 그 사용자의 목록에 보이고 toggleable=true, editable=false 다 (AC-3)", async () => {
        expect((await saveTunnel(alice.auth, 20010, {sharedUserIds: [tom.id]})).status).toBe(200);
        expect((await storedTunnel(20010)).sharedUserIds).toEqual([tom.id]);
        const row = await rowOf(tom.auth, 20010);
        expect(row).toMatchObject({forwardPort: 20010, toggleable: true, editable: false});
        expect(await rowOf(alice.auth, 20010)).toMatchObject({toggleable: true, editable: true});
        // 상태 API 의 가시성도 같다(FR-3).
        const statuses = await request("GET", "/api/externalServerStatuses", {}, tom.auth);
        expect(statuses.body.statuses.map((entry: any) => entry.port)).toContain(20010);
    });

    it("toggle 사용자는 공유된 터널을 켜고, private 남의 터널은 404, group_read 로만 보이는 터널은 403 read_only 다 (AC-2)", async () => {
        expect((await activate(tom.auth, 20010)).status).toBe(200);
        expect((await saveTunnel(alice.auth, 20011)).status).toBe(200);
        expect((await activate(tom.auth, 20011)).status).toBe(404);
        expect((await saveTunnel(superuser, 20012, {ownerId: tim.id})).status).toBe(200);
        expect((await rowOf(tom.auth, 20012))).toMatchObject({toggleable: false, editable: false});
        const sameGroup = await activate(tom.auth, 20012);
        expect(sameGroup.status).toBe(403);
        expect(sameGroup.body.code).toBe("read_only");
    });

    it("read_only 사용자는 소유 터널은 켤 수 없지만 공유된 터널은 켤 수 있다 (AC-4)", async () => {
        expect((await saveTunnel(superuser, 20020, {ownerId: rita.id})).status).toBe(200);
        const own = await activate(rita.auth, 20020);
        expect(own.status).toBe(403);
        expect(own.body.code).toBe("read_only");
        expect((await saveTunnel(alice.auth, 20021, {sharedUserIds: [rita.id]})).status).toBe(200);
        expect((await activate(rita.auth, 20021)).status).toBe(200);
    });

    it("켜기 요청은 요청자를 켠 사람으로 넘기고, 감사 detail 에 소유자 id 를 남긴다 (FR-15·FR-16)", async () => {
        runtime.activeExternalPortServer.mockClear();
        runtime.inactiveExternalPortServer.mockClear();
        sink.events.length = 0;
        expect((await activate(tom.auth, 20010)).status).toBe(200);
        expect((await activate(tom.auth, 20010, false)).status).toBe(200);
        expect(runtime.activeExternalPortServer.mock.calls).toEqual([[20010, 0, tom.id]]);
        const types = sink.events.map((event) => [event.type, event.actor.userId, event.detail?.ownerId]);
        expect(types).toEqual([["tunnel_activated", tom.id, alice.id], ["tunnel_deactivated", tom.id, alice.id]]);
    });

    it("새 터널을 만들면 만든 사람을 런타임에 넘긴다 (FR-15)", async () => {
        runtime.applyTunnelingOption.mockClear();
        expect((await saveTunnel(alice.auth, 20030)).status).toBe(200);
        expect(runtime.applyTunnelingOption.mock.calls[0][4]).toBe(alice.id);
    });

    it("공유 목록은 중복과 소유자를 빼고 저장하고, 본문에 없으면 그대로 둔다 (FR-5·FR-6)", async () => {
        expect((await saveTunnel(alice.auth, 20040, {sharedUserIds: [tom.id, tom.id, alice.id, rita.id]})).status).toBe(200);
        expect((await storedTunnel(20040)).sharedUserIds).toEqual([tom.id, rita.id]);
        expect((await saveTunnel(alice.auth, 20040, {destinationPort: 11})).status).toBe(200);
        expect((await storedTunnel(20040)).sharedUserIds).toEqual([tom.id, rita.id]);
        // 비우면 설정 파일에 남기지 않는다.
        expect((await saveTunnel(alice.auth, 20040, {sharedUserIds: []})).status).toBe(200);
        expect((await storedTunnel(20040)).sharedUserIds).toBeUndefined();
    });

    it("없는 사용자 id, 50명 초과, 잘못된 모양은 422 다 (FR-5·FR-7)", async () => {
        const unknown = await saveTunnel(alice.auth, 20041, {sharedUserIds: ["u_ffffffffffffffff"]});
        expect([unknown.status, unknown.body.code]).toEqual([422, "shared_user_not_found"]);
        const many = await saveTunnel(alice.auth, 20041, {sharedUserIds: Array.from({length: 51}, (_, index) => `u_${String(index).padStart(16, "0")}`)});
        expect([many.status, many.body.code]).toEqual([422, "shared_users_too_many"]);
        const shape = await saveTunnel(alice.auth, 20041, {sharedUserIds: tom.id});
        expect([shape.status, shape.body.code]).toEqual([422, "shared_users_invalid"]);
        expect(await storedTunnel(20041)).toBeUndefined();
    });

    it("공유 목록 변경은 tunnel_updated 감사에 더해진 id 와 빠진 id 를 남긴다 (FR-16)", async () => {
        expect((await saveTunnel(alice.auth, 20050, {sharedUserIds: [tom.id]})).status).toBe(200);
        sink.events.length = 0;
        expect((await saveTunnel(alice.auth, 20050, {sharedUserIds: [rita.id]})).status).toBe(200);
        const updated = sink.events.find((event) => event.type === "tunnel_updated")!;
        expect(updated.detail).toMatchObject({sharedUsersAdded: [rita.id], sharedUsersRemoved: [tom.id]});
        sink.events.length = 0;
        expect((await saveTunnel(alice.auth, 20050, {destinationPort: 12})).status).toBe(200);
        const unchanged = sink.events.find((event) => event.type === "tunnel_updated")!;
        expect(unchanged.detail).not.toHaveProperty("sharedUsersAdded");
        expect(unchanged.detail).not.toHaveProperty("sharedUsersRemoved");
    });

    it("목록 응답을 그대로 저장해도 toggleable·sharedUsers 가 설정 파일에 남지 않는다 (AC-10)", async () => {
        expect((await saveTunnel(alice.auth, 20060, {sharedUserIds: [tom.id]})).status).toBe(200);
        const row = await rowOf(alice.auth, 20060);
        expect(row.sharedUsers).toBeDefined();
        expect((await request("POST", "/api/tunnelingOption", {...row, expectedRevision: revision()}, alice.auth)).status).toBe(200);
        const stored = await storedTunnel(20060);
        for(const key of ["toggleable", "sharedUsers", "editable", "owner"]) expect({key, value: stored[key]}).toEqual({key, value: undefined});
        expect(stored.sharedUserIds).toEqual([tom.id]);
    });

    it("공유받은 사용자의 조회에는 공유 목록이 없고, 고칠 수 있는 사용자에게는 이름까지 있다 (AC-11)", async () => {
        expect((await saveTunnel(alice.auth, 20070, {sharedUserIds: [tom.id, rita.id]})).status).toBe(200);
        const shared = await rowOf(tom.auth, 20070);
        expect(shared).not.toHaveProperty("sharedUserIds");
        expect(shared).not.toHaveProperty("sharedUsers");
        const owner = await rowOf(alice.auth, 20070);
        expect(owner.sharedUserIds).toEqual([tom.id, rita.id]);
        expect(owner.sharedUsers).toEqual([
            {id: tom.id, username: "tomcat", displayName: "Tom Operator"},
            {id: rita.id, username: "rita", displayName: "rita"}
        ]);
        expect((await rowOf(superuser, 20070)).sharedUsers).toHaveLength(2);
    });

    it("소유자를 재할당할 때 새 소유자가 공유 목록에 있으면 뺀다 (FR-5)", async () => {
        expect((await saveTunnel(superuser, 20080, {ownerId: alice.id, sharedUserIds: [tom.id, rita.id]})).status).toBe(200);
        const moved = await request("PUT", "/api/tunnelingOption/20080/owner", {ownerId: tom.id, expectedRevision: revision()}, superuser);
        expect(moved.status).toBe(200);
        expect((await storedTunnel(20080)).sharedUserIds).toEqual([rita.id]);
    });

    it("사용자를 지우면 모든 터널의 공유 목록에서 사라진다 (AC-8)", async () => {
        const temp = await request("POST", "/api/users", {username: "leaver", role: "regular"}, superuser);
        const leaverId = temp.body.user.id;
        expect((await saveTunnel(alice.auth, 20090, {sharedUserIds: [leaverId, tom.id]})).status).toBe(200);
        expect((await saveTunnel(eve.auth, 20091, {sharedUserIds: [leaverId]})).status).toBe(200);
        expect((await request("DELETE", `/api/users/${leaverId}`, {}, superuser)).status).toBe(200);
        expect((await storedTunnel(20090)).sharedUserIds).toEqual([tom.id]);
        expect((await storedTunnel(20091)).sharedUserIds).toBeUndefined();
    });

    it("슈퍼유저와 비활성 사용자는 새로 공유할 수 없고, 이미 저장된 id 는 저장을 막지 않는다 (리뷰 후속)", async () => {
        for(const id of [superuserId, zedId]) {
            const response = await saveTunnel(alice.auth, 20095, {sharedUserIds: [id]});
            expect({id, status: response.status, code: response.body.code}).toEqual({id, status: 422, code: "shared_user_not_found"});
        }
        // 슈퍼유저가 저장해도 같다(모든 호출자에 적용).
        const bySuperuser = await saveTunnel(superuser, 20095, {ownerId: alice.id, sharedUserIds: [zedId]});
        expect([bySuperuser.status, bySuperuser.body.code]).toEqual([422, "shared_user_not_found"]);
        expect((await saveTunnel(alice.auth, 20095, {sharedUserIds: [tom.id]})).status).toBe(200);
        const stored = ServerOptionStore.instance.getTunnelingOption(20095)!;
        expect(ServerOptionStore.instance.updateTunnelingOption({...stored, sharedUserIds: [tom.id, zedId]})).toBe(true);
        expect((await saveTunnel(alice.auth, 20095, {sharedUserIds: [tom.id, zedId], destinationPort: 13})).status).toBe(200);
        expect((await storedTunnel(20095)).sharedUserIds).toEqual([tom.id, zedId]);
    });

    it("사라진 사용자 id 는 조회에서 빼고, 저장할 때 거절하지 않고 조용히 뺀다 (리뷰 후속)", async () => {
        const stale = "u_00000000deadbeef";
        expect((await saveTunnel(alice.auth, 20096, {sharedUserIds: [tom.id]})).status).toBe(200);
        const stored = ServerOptionStore.instance.getTunnelingOption(20096)!;
        expect(ServerOptionStore.instance.updateTunnelingOption({...stored, sharedUserIds: [stale, tom.id]})).toBe(true);
        const row = await rowOf(alice.auth, 20096);
        expect(row.sharedUserIds).toEqual([tom.id]);
        expect(row.sharedUsers.map((user: any) => user.id)).toEqual([tom.id]);
        // 본문에 사라진 id 가 남아 있어도(낡은 화면) 422 가 아니라 빼고 저장한다.
        expect((await saveTunnel(alice.auth, 20096, {sharedUserIds: [stale, tom.id]})).status).toBe(200);
        expect((await storedTunnel(20096)).sharedUserIds).toEqual([tom.id]);
        // 본문에 공유 목록이 없어도 뺀다.
        expect(ServerOptionStore.instance.updateTunnelingOption({...ServerOptionStore.instance.getTunnelingOption(20096)!, sharedUserIds: [stale, tom.id]})).toBe(true);
        expect((await saveTunnel(alice.auth, 20096, {destinationPort: 14})).status).toBe(200);
        expect((await storedTunnel(20096)).sharedUserIds).toEqual([tom.id]);
    });

    it("재할당으로 새 소유자가 공유에서 빠지면 tunnel_reassigned 감사에 sharedUsersRemoved 를 남긴다 (리뷰 후속)", async () => {
        expect((await saveTunnel(superuser, 20097, {ownerId: alice.id, sharedUserIds: [tom.id, rita.id]})).status).toBe(200);
        sink.events.length = 0;
        expect((await request("PUT", "/api/tunnelingOption/20097/owner", {ownerId: tom.id, expectedRevision: revision()}, superuser)).status).toBe(200);
        const reassigned = sink.events.find((event) => event.type === "tunnel_reassigned")!;
        expect(reassigned.detail).toMatchObject({from: alice.id, to: tom.id, sharedUsersRemoved: [tom.id]});
        sink.events.length = 0;
        expect((await request("PUT", "/api/tunnelingOption/20097/owner", {ownerId: eve.id, expectedRevision: revision()}, superuser)).status).toBe(200);
        expect(sink.events.find((event) => event.type === "tunnel_reassigned")!.detail).not.toHaveProperty("sharedUsersRemoved");
    });

    it("공유 정리 중 설정을 읽지 못해도 사용자 삭제는 성공으로 끝난다 (리뷰 후속)", async () => {
        const temp = await request("POST", "/api/users", {username: "leaver2", role: "regular"}, superuser);
        const leaverId = temp.body.user.id;
        expect((await saveTunnel(alice.auth, 20098, {sharedUserIds: [leaverId]})).status).toBe(200);
        const store = ServerOptionStore.instance;
        const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(store), "serverOption")!.get!;
        // 사용자가 지워진 뒤의 설정 읽기만 실패시킨다(권한 판정 등 앞선 읽기는 그대로 둔다).
        const spy = jest.spyOn(store, "serverOption", "get").mockImplementation(function(this: ServerOptionStore) {
            if(IdentityStore.instance.user(leaverId) === undefined) throw new Error("read failure");
            return original.call(this);
        });
        try {
            const deleted = await request("DELETE", `/api/users/${leaverId}`, {}, superuser);
            expect(deleted.status).toBe(200);
        } finally {
            spy.mockRestore();
        }
        expect(IdentityStore.instance.user(leaverId)).toBeUndefined();
    });

    describe("사용자 검색 GET /api/users/lookup (FR-9)", () => {
        const lookup = (auth: Auth, q: string) => request("GET", `/api/users/lookup?q=${encodeURIComponent(q)}`, {}, auth);

        it("toggle 사용자는 403 forbidden 이다 (AC-5)", async () => {
            const response = await lookup(tom.auth, "al");
            expect([response.status, response.body.code]).toEqual([403, "forbidden"]);
        });

        it("full 사용자는 /api/users/:id 의 403 이 아니라 검색 결과를 받는다 (AC-5a)", async () => {
            const response = await lookup(alice.auth, "tom");
            expect(response.status).toBe(200);
            expect(response.body.users).toEqual([{id: tom.id, username: "tomcat", displayName: "Tom Operator"}]);
        });

        it("다른 그룹의 활성 사용자를 찾고 비활성 사용자·자신·슈퍼유저는 빼며 민감한 값을 싣지 않는다 (AC-5·AC-12)", async () => {
            const response = await lookup(alice.auth, "m");
            expect(response.status).toBe(422);
            const wide = await lookup(alice.auth, "to");
            expect(wide.status).toBe(200);
            const ids = wide.body.users.map((user: any) => user.id);
            expect(ids).toContain(tom.id);
            expect(ids).not.toContain(zedId);
            const everyone = await lookup(alice.auth, "ad");
            expect(everyone.body.users.map((user: any) => user.id)).not.toContain(superuserId);
            const self = await lookup(alice.auth, "alice");
            expect(self.body.users).toEqual([]);
            for(const user of wide.body.users) {
                expect(Object.keys(user).sort()).toEqual(["displayName", "id", "username"]);
            }
            expect(JSON.stringify(wide.body)).not.toMatch(/passwordHash|mfa|passkeys/);
        });

        it("결과는 최대 10개이고 슈퍼유저 호출자는 슈퍼유저도 찾는다", async () => {
            for(let index = 0; index < 11; index++) {
                expect((await request("POST", "/api/users", {username: `bulk${String(index).padStart(2, "0")}`, role: "regular"}, superuser)).status).toBe(201);
            }
            expect((await lookup(alice.auth, "bulk")).body.users).toHaveLength(10);
            const other = await request("POST", "/api/users", {username: "rootling", role: "superuser"}, superuser);
            expect(other.status).toBe(201);
            expect((await lookup(superuser, "rootling")).body.users.map((user: any) => user.id)).toEqual([other.body.user.id]);
            expect((await lookup(alice.auth, "rootling")).body.users).toEqual([]);
        });

        it("1자 검색과 65자 검색은 422 query_invalid 다 (AC-5)", async () => {
            for(const q of ["a", "a".repeat(65), ""]) {
                const response = await lookup(alice.auth, q);
                expect({q, status: response.status, code: response.body.code}).toEqual({q, status: 422, code: "query_invalid"});
            }
        });
    });
});
