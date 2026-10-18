import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import AdminServer from "../../../../src/server/admin/AdminServer";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {BOOTSTRAP_TOKEN_FILE_NAME, IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {AuditEvent, AuditSink, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot} from "../../../helpers/runtime";

jest.setTimeout(60_000);

const ADMIN_PASSWORD = "rbac-admin-password";
const LEGACY_PASSWORD = "rbac-legacy-password";

type StubSink = AuditSink & {events: AuditEvent[]};

const createStubSink = (): StubSink => ({
    events: [],
    reserve(): boolean { return true; },
    record(event: AuditEvent): Promise<void> { this.events.push(event); return Promise.resolve(); }
});

type ApiResponse = {status: number; headers: any; body: any};
type Auth = {Cookie: string; "X-CSRF-Token": string};
type LoginResult = ApiResponse & {auth?: Auth};

type Fixture = {
    rootDir: string;
    identityPath: string;
    sink: StubSink;
    admin: {auth: Auth; userId: string};
    request: (method: string, target: string, body?: object, headers?: Record<string, string>) => Promise<ApiResponse>;
    login: (body: object) => Promise<LoginResult>;
};

const authOf = (response: ApiResponse): Auth => {
    const pairs = (response.headers["set-cookie"] as string[]).map((value) => value.split(";")[0]);
    return {
        Cookie: pairs.join("; "),
        "X-CSRF-Token": pairs.find((value) => value.startsWith("csrfToken="))!.slice("csrfToken=".length)
    };
};

/** identity.yaml 을 깨뜨려 IdentityStore 가 legacy-fallback 으로 기동하게 만든다. */
const setupLegacyFallback = async (rootDir: string): Promise<void> => {
    await fs.writeFile(path.join(rootDir, "config", "identity.yaml"), "version: 1\nusers: []\ngroups: []\n", "utf-8");
    await fs.writeFile(path.join(rootDir, "config", ".key"), await bcrypt.hash(LEGACY_PASSWORD, 4), "utf-8");
};

const withRbacServer = async (
    check: (fixture: Fixture) => Promise<void>,
    options: {setup?: (rootDir: string) => Promise<void>; legacyFallback?: boolean} = {}
): Promise<void> => {
    const root = await createTestRoot("rbac-users-groups");
    let api: AdminServer | undefined;
    try {
        applyTestRoot(root.rootDir);
        await CertificationStore.instance.load();
        await options.setup?.(root.rootDir);
        await IdentityMigration.runAtStartup();
        api = new AdminServer(undefined as any, false);
        const port = await api.listen(0, "127.0.0.1");

        const request = async (method: string, target: string, body: object = {}, headers: Record<string, string> = {}): Promise<ApiResponse> => {
            const bytes = JSON.stringify(body);
            const response = await httpRequest({
                port, path: target, method,
                headers: {"Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bytes)), ...headers},
                body: bytes
            });
            let parsed: any;
            try { parsed = JSON.parse(response.body); } catch { parsed = response.body; }
            return {status: response.statusCode, headers: response.headers, body: parsed};
        };

        const login = async (body: object): Promise<LoginResult> => {
            const response = await request("POST", "/api/login", body);
            return response.status === 200 ? {...response, auth: authOf(response)} : response;
        };

        const sink = createStubSink();
        AuditSinkRegistry.set(sink);

        let entry: LoginResult;
        if(options.legacyFallback) {
            entry = await login({username: "admin", password: LEGACY_PASSWORD});
        } else {
            const token = (await fs.readFile(path.join(root.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();
            entry = await login({username: "admin", password: ADMIN_PASSWORD, bootstrapToken: token});
        }
        if(entry.status !== 200) throw new Error(`rbac fixture login failed: ${JSON.stringify(entry.body)}`);
        sink.events.length = 0;

        await check({
            rootDir: root.rootDir,
            identityPath: path.join(root.rootDir, "config", "identity.yaml"),
            sink,
            admin: {auth: entry.auth!, userId: entry.body.user.id},
            request, login
        });
    } finally {
        try { await api?.close(); } finally { await cleanupTestRoot(root); }
    }
};

const FIELD_TEAM = {
    name: "Field team",
    attributes: {allowed_port_range: [{from: 20000, to: 20099}], allowed_protocols: ["HTTP", "HTTPS"]}
};

/** 슈퍼유저 세션으로 Field team 그룹을 만들고 그 id 를 돌려준다. */
const createFieldTeam = async (f: Fixture): Promise<string> => {
    const created = await f.request("POST", "/api/groups", FIELD_TEAM, f.admin.auth);
    expect(created.status).toBe(201);
    return created.body.group.id;
};

const createAlice = async (f: Fixture, groupId: string): Promise<{id: string; temporaryPassword: string}> => {
    const created = await f.request("POST", "/api/users",
        {username: "alice", displayName: "Alice", role: "regular", groupId}, f.admin.auth);
    expect(created.status).toBe(201);
    return {id: created.body.user.id, temporaryPassword: created.body.temporaryPassword};
};

describe("rbac-users-groups", () => {
    let bcryptCostBackup: number;
    beforeAll(() => { bcryptCostBackup = IdentityStore.bcryptCost; IdentityStore.bcryptCost = 4; });
    afterAll(() => { IdentityStore.bcryptCost = bcryptCostBackup; });

    it("그룹을 만들면 지정하지 않은 속성이 기본값으로 채워진다", async () => withRbacServer(async (f) => {
        const created = await f.request("POST", "/api/groups", FIELD_TEAM, f.admin.auth);
        expect(created.status).toBe(201);
        expect(created.body.group).toMatchObject({name: "Field team", system: false, memberCount: 0});
        expect(created.body.group.attributes.max_tunnel_count).toBe(10);
        expect(created.body.group.attributes.allowed_protocols).toEqual(["HTTP", "HTTPS"]);
        expect(created.body.group.attributes.allowed_port_range).toEqual([{from: 20000, to: 20099}]);
    }));

    it("그룹 속성 정합성과 이름 검증이 422 로 돌아온다", async () => withRbacServer(async (f) => {
        const rewrite = await f.request("POST", "/api/groups",
            {name: "x", attributes: {allowed_protocols: ["HTTP_REWRITE"]}}, f.admin.auth);
        expect(rewrite.status).toBe(422);
        expect(rewrite.body.code).toBe("http_rewrite_requires_http");

        const emptyName = await f.request("POST", "/api/groups", {name: ""}, f.admin.auth);
        expect(emptyName.status).toBe(422);
        expect(emptyName.body.code).toBe("group_name_invalid");
    }));

    it("사용자를 만들면 임시 비밀번호가 응답에만 실리고 저장 파일에는 남지 않는다", async () => withRbacServer(async (f) => {
        const groupId = await createFieldTeam(f);
        const created = await f.request("POST", "/api/users",
            {username: "alice", displayName: "Alice", role: "regular", groupId}, f.admin.auth);

        expect(created.status).toBe(201);
        expect(created.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{16}$/);
        expect(created.body.user).toMatchObject({
            username: "alice", displayName: "Alice", role: "regular", status: "active",
            groupId, groupName: "Field team", mustChangePassword: true, migratedFromLegacyAdmin: false
        });

        const stored = await fs.readFile(f.identityPath, "utf8");
        expect(stored).not.toContain(created.body.temporaryPassword);
    }));

    it("사용자 생성의 검증·충돌 실패가 규약대로 돌아온다", async () => withRbacServer(async (f) => {
        const groupId = await createFieldTeam(f);
        await createAlice(f, groupId);

        const duplicated = await f.request("POST", "/api/users",
            {username: "alice", displayName: "Alice", role: "regular", groupId}, f.admin.auth);
        expect(duplicated.status).toBe(409);
        expect(duplicated.body.code).toBe("username_taken");

        const badRole = await f.request("POST", "/api/users", {username: "bob", role: "admin"}, f.admin.auth);
        expect(badRole.status).toBe(422);
        expect(badRole.body.code).toBe("role_invalid");

        const shortPassword = await f.request("POST", "/api/users",
            {username: "bob", role: "regular", temporaryPassword: "short"}, f.admin.auth);
        expect(shortPassword.status).toBe(422);
        expect(shortPassword.body.code).toBe("password_too_short");

        const missingGroup = await f.request("POST", "/api/users",
            {username: "bob", role: "regular", groupId: "g_none"}, f.admin.auth);
        expect(missingGroup.status).toBe(422);
        expect(missingGroup.body.code).toBe("group_not_found");
    }));

    it("일반 유저는 사용자·그룹 관리 API 전부에서 403 이다", async () => withRbacServer(async (f) => {
        const groupId = await createFieldTeam(f);
        const alice = await createAlice(f, groupId);

        const first = await f.login({username: "alice", password: alice.temporaryPassword});
        expect(first.status).toBe(200);
        expect(first.body.mustChangePassword).toBe(true);

        const changed = await f.request("PUT", "/api/me/password",
            {currentPassword: alice.temporaryPassword, newPassword: "alice-next-password"}, first.auth);
        expect(changed.status).toBe(200);
        const regular = first.auth!;

        for(const call of [
            {method: "GET", target: "/api/users"},
            {method: "POST", target: "/api/users"},
            {method: "GET", target: "/api/groups"},
            {method: "DELETE", target: "/api/groups/default"}
        ]) {
            const response = await f.request(call.method, call.target, {}, regular);
            expect({target: call.target, status: response.status, code: response.body.code})
                .toEqual({target: call.target, status: 403, code: "forbidden"});
        }
    }));

    it("사용자 목록은 createdAt 오름차순이고 어떤 항목에도 passwordHash 가 없다", async () => withRbacServer(async (f) => {
        const groupId = await createFieldTeam(f);
        await createAlice(f, groupId);

        const listed = await f.request("GET", "/api/users", {}, f.admin.auth);
        expect(listed.status).toBe(200);
        expect(listed.body.users.map((user: any) => user.username)).toEqual(["admin", "alice"]);
        for(const user of listed.body.users) {
            expect(Object.keys(user)).not.toContain("passwordHash");
        }
        const timestamps = listed.body.users.map((user: any) => user.createdAt);
        expect(timestamps).toEqual([...timestamps].sort((a: number, b: number) => a - b));
    }));

    it("사용자 수정은 허용된 네 키만 반영하고 그룹 규칙을 지킨다", async () => withRbacServer(async (f) => {
        const groupId = await createFieldTeam(f);
        const alice = await createAlice(f, groupId);

        const promoted = await f.request("PUT", `/api/users/${alice.id}`, {role: "superuser"}, f.admin.auth);
        expect(promoted.status).toBe(200);
        expect(promoted.body.user.groupId).toBe("system:superuser");

        const demoted = await f.request("PUT", `/api/users/${alice.id}`, {role: "regular"}, f.admin.auth);
        expect(demoted.status).toBe(200);
        expect(demoted.body.user.groupId).toBe("default");

        const reserved = await f.request("PUT", `/api/users/${alice.id}`, {groupId: "system:superuser"}, f.admin.auth);
        expect(reserved.status).toBe(422);
        expect(reserved.body.code).toBe("superuser_group_reserved");

        const blankName = await f.request("PUT", `/api/users/${alice.id}`, {displayName: ""}, f.admin.auth);
        expect(blankName.status).toBe(422);
        expect(blankName.body.code).toBe("display_name_invalid");

        const ignored = await f.request("PUT", `/api/users/${alice.id}`, {mustChangePassword: false}, f.admin.auth);
        expect(ignored.status).toBe(200);
        expect(ignored.body.user.mustChangePassword).toBe(true);
    }));

    it("마지막 활성 슈퍼유저는 강등·비활성화·삭제가 모두 409 다", async () => withRbacServer(async (f) => {
        const groupId = await createFieldTeam(f);
        await createAlice(f, groupId);

        const demote = await f.request("PUT", `/api/users/${f.admin.userId}`, {role: "regular"}, f.admin.auth);
        expect({status: demote.status, code: demote.body.code}).toEqual({status: 409, code: "last_superuser"});

        const disable = await f.request("PUT", `/api/users/${f.admin.userId}`, {status: "disabled"}, f.admin.auth);
        expect({status: disable.status, code: disable.body.code}).toEqual({status: 409, code: "last_superuser"});

        const removed = await f.request("DELETE", `/api/users/${f.admin.userId}`, {}, f.admin.auth);
        expect({status: removed.status, code: removed.body.code}).toEqual({status: 409, code: "last_superuser"});
    }));

    it("비활성화하면 기존 세션과 로그인이 모두 막히고 다시 활성화하면 풀린다", async () => withRbacServer(async (f) => {
        const groupId = await createFieldTeam(f);
        const alice = await createAlice(f, groupId);
        const session = await f.login({username: "alice", password: alice.temporaryPassword});
        expect(session.status).toBe(200);

        const disabled = await f.request("PUT", `/api/users/${alice.id}`, {status: "disabled"}, f.admin.auth);
        expect(disabled.status).toBe(200);
        expect((await f.request("GET", "/api/me", {}, session.auth)).status).toBe(401);
        expect((await f.login({username: "alice", password: alice.temporaryPassword})).status).toBe(401);

        const enabled = await f.request("PUT", `/api/users/${alice.id}`, {status: "active"}, f.admin.auth);
        expect(enabled.status).toBe(200);
        expect((await f.login({username: "alice", password: alice.temporaryPassword})).status).toBe(200);
    }));

    it("비밀번호 초기화는 지정한 값을 그대로 쓰고 기존 세션을 끊는다", async () => withRbacServer(async (f) => {
        const groupId = await createFieldTeam(f);
        const alice = await createAlice(f, groupId);
        const session = await f.login({username: "alice", password: alice.temporaryPassword});
        expect(session.status).toBe(200);

        const reset = await f.request("POST", `/api/users/${alice.id}/password-reset`,
            {temporaryPassword: "reset-pass-1234"}, f.admin.auth);
        expect(reset.status).toBe(200);
        expect(reset.body.temporaryPassword).toBe("reset-pass-1234");
        expect(reset.body.user.mustChangePassword).toBe(true);

        expect((await f.request("GET", "/api/me", {}, session.auth)).status).toBe(401);
        const again = await f.login({username: "alice", password: "reset-pass-1234"});
        expect(again.status).toBe(200);
        expect(again.body.mustChangePassword).toBe(true);
    }));

    it("#145 비밀번호 초기화는 해시와 mustChangePassword 를 한 번에 저장해, 저장이 실패하면 옛 비밀번호가 그대로다", async () => withRbacServer(async (f) => {
        const groupId = await createFieldTeam(f);
        const alice = await createAlice(f, groupId);
        const first = await f.login({username: "alice", password: alice.temporaryPassword});
        expect(first.status).toBe(200);
        const own = "alice-own-pass-1";
        expect((await f.request("PUT", "/api/me/password", {currentPassword: alice.temporaryPassword, newPassword: own}, first.auth)).status).toBe(200);

        // 첫 저장만 성공하고 그 뒤 저장은 실패하는 디스크를 흉내 낸다. 두 번 나눠 저장하면 해시만 바뀐 채 실패한다.
        const store = IdentityStore.instance as any;
        const original = store.replaceData.bind(store);
        let saves = 0;
        const spy = jest.spyOn(store, "replaceData").mockImplementation((next: any) =>
            (++saves === 1 ? original(next) : {success: false, message: "simulated disk failure"}));
        let reset: ApiResponse;
        try {
            reset = await f.request("POST", `/api/users/${alice.id}/password-reset`, {temporaryPassword: "reset-pass-5678"}, f.admin.auth);
        } finally {
            spy.mockRestore();
        }
        if(reset.status === 200) {
            expect(reset.body.user.mustChangePassword).toBe(true);
            const again = await f.login({username: "alice", password: "reset-pass-5678"});
            expect({status: again.status, mustChange: again.body.mustChangePassword}).toEqual({status: 200, mustChange: true});
        } else {
            expect((await f.login({username: "alice", password: own})).status).toBe(200);
        }
        expect(saves).toBe(1);
    }));

    it("#145 비밀번호 초기화 저장이 실패하면 422 이고 옛 비밀번호와 기존 세션이 그대로다", async () => withRbacServer(async (f) => {
        const groupId = await createFieldTeam(f);
        const alice = await createAlice(f, groupId);
        const first = await f.login({username: "alice", password: alice.temporaryPassword});
        const own = "alice-own-pass-2";
        expect((await f.request("PUT", "/api/me/password", {currentPassword: alice.temporaryPassword, newPassword: own}, first.auth)).status).toBe(200);
        const session = await f.login({username: "alice", password: own});
        expect(session.status).toBe(200);

        const store = IdentityStore.instance as any;
        const spy = jest.spyOn(store, "replaceData").mockImplementation(() => ({success: false, message: "simulated disk failure"}));
        let reset: ApiResponse;
        try {
            reset = await f.request("POST", `/api/users/${alice.id}/password-reset`, {temporaryPassword: "reset-pass-9999"}, f.admin.auth);
        } finally {
            spy.mockRestore();
        }
        expect(reset.status).toBe(422);
        expect(reset.body.temporaryPassword).toBeUndefined();
        expect((await f.request("GET", "/api/me", {}, session.auth)).status).toBe(200);
        expect((await f.login({username: "alice", password: own})).status).toBe(200);
        expect((await f.login({username: "alice", password: "reset-pass-9999"})).status).toBe(401);
    }));

    it("그룹 상세·삭제 규칙이 시스템 그룹과 소속 인원을 지킨다", async () => withRbacServer(async (f) => {
        const groupId = await createFieldTeam(f);
        const alice = await createAlice(f, groupId);

        const detail = await f.request("GET", `/api/groups/${groupId}`, {}, f.admin.auth);
        expect(detail.status).toBe(200);
        expect(detail.body.group.memberCount).toBe(1);
        expect(detail.body.members.map((member: any) => member.username)).toEqual(["alice"]);

        const notEmpty = await f.request("DELETE", `/api/groups/${groupId}`, {}, f.admin.auth);
        expect({status: notEmpty.status, code: notEmpty.body.code}).toEqual({status: 409, code: "group_not_empty"});

        expect((await f.request("PUT", `/api/users/${alice.id}`, {groupId: "default"}, f.admin.auth)).status).toBe(200);
        expect((await f.request("DELETE", `/api/groups/${groupId}`, {}, f.admin.auth)).status).toBe(200);

        const systemDefault = await f.request("DELETE", "/api/groups/default", {}, f.admin.auth);
        expect({status: systemDefault.status, code: systemDefault.body.code}).toEqual({status: 422, code: "system_group_readonly"});

        const superuserGroup = await f.request("PUT", "/api/groups/system:superuser", {name: "x"}, f.admin.auth);
        expect({status: superuserGroup.status, code: superuserGroup.body.code}).toEqual({status: 422, code: "system_group_readonly"});

        const absent = await f.request("GET", "/api/groups/g_none", {}, f.admin.auth);
        expect({status: absent.status, code: absent.body.code}).toEqual({status: 404, code: "group_not_found"});
    }));

    it("그룹 목록은 시스템 그룹을 먼저, 그 뒤 이름 오름차순으로 낸다", async () => withRbacServer(async (f) => {
        expect((await f.request("POST", "/api/groups", {name: "Zulu"}, f.admin.auth)).status).toBe(201);
        expect((await f.request("POST", "/api/groups", {name: "Alpha"}, f.admin.auth)).status).toBe(201);

        const listed = await f.request("GET", "/api/groups", {}, f.admin.auth);
        expect(listed.status).toBe(200);
        expect(listed.body.groups.map((group: any) => group.id).slice(0, 2)).toEqual(["system:superuser", "default"]);
        expect(listed.body.groups.map((group: any) => group.name).slice(2)).toEqual(["Alpha", "Zulu"]);
    }));

    it("그룹 속성 변경 감사에는 값이 실제로 바뀐 키만 담긴다", async () => withRbacServer(async (f) => {
        f.sink.events.length = 0;
        const updated = await f.request("PUT", "/api/groups/default",
            {attributes: {tunnel_visibility: "group_read", max_tunnel_count: 10}}, f.admin.auth);
        expect(updated.status).toBe(200);

        const event = f.sink.events.find((candidate) => candidate.type === "group_attributes_changed");
        expect(event).toBeDefined();
        expect(event!.detail!.changedKeys).toEqual(["tunnel_visibility"]);
    }));

    it("사용자를 지우면 조회가 404 가 된다", async () => withRbacServer(async (f) => {
        const groupId = await createFieldTeam(f);
        const alice = await createAlice(f, groupId);

        expect((await f.request("DELETE", `/api/users/${alice.id}`, {}, f.admin.auth)).status).toBe(200);
        const absent = await f.request("GET", `/api/users/${alice.id}`, {}, f.admin.auth);
        expect({status: absent.status, code: absent.body.code}).toEqual({status: 404, code: "user_not_found"});
    }));

    it("생성·변경·삭제가 각각의 감사 이벤트를 남기고 임시 비밀번호는 어디에도 담기지 않는다", async () => withRbacServer(async (f) => {
        const groupId = await createFieldTeam(f);
        const alice = await createAlice(f, groupId);
        await f.request("PUT", `/api/users/${alice.id}`, {role: "superuser"}, f.admin.auth);
        await f.request("PUT", `/api/users/${alice.id}`, {role: "regular"}, f.admin.auth);
        await f.request("PUT", `/api/users/${alice.id}`, {status: "disabled"}, f.admin.auth);
        await f.request("POST", `/api/users/${alice.id}/password-reset`, {}, f.admin.auth);
        await f.request("DELETE", `/api/users/${alice.id}`, {}, f.admin.auth);
        expect((await f.request("DELETE", `/api/groups/${groupId}`, {}, f.admin.auth)).status).toBe(200);

        const counted = (type: string) => f.sink.events.filter((event) => event.type === type).length;
        expect(counted("group_created")).toBeGreaterThanOrEqual(1);
        expect(counted("user_created")).toBeGreaterThanOrEqual(1);
        expect(counted("temp_password_issued")).toBe(2);
        expect(counted("role_changed")).toBeGreaterThanOrEqual(1);
        expect(counted("user_status_changed")).toBeGreaterThanOrEqual(1);
        expect(counted("user_deleted")).toBeGreaterThanOrEqual(1);
        expect(counted("group_deleted")).toBeGreaterThanOrEqual(1);

        const userCreated = f.sink.events.find((event) => event.type === "user_created")!;
        expect(userCreated.detail!.userId).toBe(alice.id);

        for(const event of f.sink.events) {
            expect(Object.keys(event.detail ?? {})).not.toContain("temporaryPassword");
        }
    }));

    // 키 이름 검사만으로는 평문을 다른 키(tempPw 등)에 담는 누출을 잡지 못한다.
    // 응답으로 받은 실제 평문 값이 싱크가 받은 이벤트 전체 어디에도 없는지를 본다.
    it("임시 비밀번호 발급 감사는 발급 방식만 담고 평문 값은 어떤 키로도 남기지 않는다", async () => withRbacServer(async (f) => {
        const issue = async (method: string, target: string, body: object): Promise<unknown[]> => {
            f.sink.events.length = 0;
            const response = await f.request(method, target, body, f.admin.auth);
            expect(response.status).toBeLessThan(300);
            const plaintext: string = response.body.temporaryPassword;
            expect(plaintext.length).toBeGreaterThanOrEqual(16);
            expect(JSON.stringify(f.sink.events)).not.toContain(plaintext);
            return f.sink.events.filter((event) => event.type === "temp_password_issued").map((event) => event.detail);
        };

        const generatedOnCreate = await issue("POST", "/api/users", {username: "alice", role: "regular"});
        expect(generatedOnCreate).toEqual([{generated: true}]);

        const specifiedOnCreate = await issue("POST", "/api/users",
            {username: "bob", role: "regular", temporaryPassword: "admin-specified-create-password"});
        expect(specifiedOnCreate).toEqual([{generated: false}]);

        const users = (await f.request("GET", "/api/users", {}, f.admin.auth)).body.users;
        const idOf = (username: string) => users.find((user: any) => user.username === username).id;

        const generatedOnReset = await issue("POST", `/api/users/${idOf("alice")}/password-reset`, {});
        expect(generatedOnReset).toEqual([{generated: true}]);

        const specifiedOnReset = await issue("POST", `/api/users/${idOf("bob")}/password-reset`,
            {temporaryPassword: "admin-specified-reset-password"});
        expect(specifiedOnReset).toEqual([{generated: false}]);
    }));

    it("CSRF 헤더 없이 보낸 사용자 생성은 403 이다", async () => withRbacServer(async (f) => {
        const response = await f.request("POST", "/api/users",
            {username: "bob", role: "regular"}, {Cookie: f.admin.auth.Cookie});
        expect(response.status).toBe(403);
    }));

    it("legacy-fallback 으로 기동하면 사용자·그룹 API 가 503 이다", async () => withRbacServer(async (f) => {
        const users = await f.request("GET", "/api/users", {}, f.admin.auth);
        expect({status: users.status, code: users.body.code}).toEqual({status: 503, code: "identity_store_unavailable"});

        const groups = await f.request("POST", "/api/groups", {name: "Field team"}, f.admin.auth);
        expect({status: groups.status, code: groups.body.code}).toEqual({status: 503, code: "identity_store_unavailable"});
    }, {setup: setupLegacyFallback, legacyFallback: true}));
});
