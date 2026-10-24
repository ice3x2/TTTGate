import fs from "node:fs/promises";
import path from "node:path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import SessionStore from "../../../../src/server/admin/SessionStore";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import TTTServer from "../../../../src/server/TTTServer";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {BOOTSTRAP_TOKEN_FILE_NAME, IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {ADMIN_ROUTES, RouteContext} from "../../../../src/server/admin/routes";
import {AUDIT_EVENT_TYPE_LIST} from "../../../../src/server/audit/AuditEventTypes";
import {AuditEvent, AuditSink, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {getFreePort, startEchoServer} from "../../../helpers/network";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot} from "../../../helpers/runtime";

jest.setTimeout(60_000);

const ADMIN_PASSWORD = "audit-sink-password";
const REGULAR_PASSWORD = "audit-regular-password";

type StubSink = AuditSink & {events: AuditEvent[]; allEvents: AuditEvent[]; reserveResult: boolean};

/** 이슈 #97 수용 기준이 정한 스텁 싱크. reserveResult 로 배압을 흉내 낸다. */
// allEvents 는 테스트가 비우지 않는 사본이다 — #109 의 "기록된 type 전수가 상수 목록에 있다" 판정에 쓴다.
const createStubSink = (): StubSink => ({
    events: [],
    allEvents: [],
    reserveResult: true,
    reserve(): boolean {
        return this.reserveResult;
    },
    record(event: AuditEvent): Promise<void> {
        this.events.push(event);
        this.allEvents.push(event);
        return Promise.resolve();
    }
});

type ApiResponse = {status: number; headers: any; body: any};
type Auth = {Cookie: string; "X-CSRF-Token": string};
type LoginResult = ApiResponse & {auth?: Auth; sessionKey?: string};

type Fixture = {
    rootDir: string;
    api: AdminServer;
    tunnel: TTTServer;
    sink: StubSink;
    store: ServerOptionStore;
    admin: {auth: Auth; sessionKey: string; userId: string; mustChangePassword: boolean};
    request: (method: string, target: string, body?: object, headers?: Record<string, string>) => Promise<ApiResponse>;
    login: (body: object) => Promise<LoginResult>;
    freePort: () => Promise<number>;
    /** #135: JSON 으로 직렬화하지 않은 본문을 그대로 보낸다. */
    raw: (method: string, target: string, body: string, headers?: Record<string, string>) => Promise<ApiResponse>;
};

const authOf = (response: ApiResponse): {auth: Auth; sessionKey: string} => {
    const cookies: string[] = response.headers["set-cookie"];
    const pairs = cookies.map((value: string) => value.split(";")[0]);
    return {
        auth: {
            Cookie: pairs.join("; "),
            "X-CSRF-Token": pairs.find((value: string) => value.startsWith("csrfToken="))!.slice("csrfToken=".length)
        },
        sessionKey: pairs.find((value: string) => value.startsWith("sessionKey="))!.slice("sessionKey=".length)
    };
};

/** 실제 AdminServer + TTTServer 를 띄우고 부트스트랩으로 슈퍼유저 admin 세션을 만든다. */
const withAuditServer = async (check: (fixture: Fixture) => Promise<void>): Promise<void> => {
    const root = await createTestRoot("audit-sink");
    let api: AdminServer | undefined;
    let tunnel: TTTServer | undefined;
    try {
        applyTestRoot(root.rootDir);
        await CertificationStore.instance.load();
        const store = ServerOptionStore.instance;
        if(!store.updateServerOption({...store.serverOption, port: await getFreePort(),
            adminBindHost: "127.0.0.1", adminTls: false, tls: false, keepAlive: 0, tunnelingOptions: []})) {
            throw new Error("audit-sink fixture: invalid server option");
        }
        tunnel = TTTServer.create(store.serverOption);
        await tunnel.start();
        api = new AdminServer(tunnel, false);
        const port = await api.listen(0, "127.0.0.1");
        await IdentityMigration.runAtStartup();
        const bootstrapToken = (await fs.readFile(path.join(root.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();

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

        const raw = async (method: string, target: string, body: string, headers: Record<string, string> = {}): Promise<ApiResponse> => {
            const response = await httpRequest({
                port, path: target, method,
                headers: {"Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)), ...headers},
                body
            });
            let parsed: any;
            try { parsed = JSON.parse(response.body); } catch { parsed = response.body; }
            return {status: response.statusCode, headers: response.headers, body: parsed};
        };

        const login = async (body: object): Promise<LoginResult> => {
            const response = await request("POST", "/api/login", body);
            if(response.status !== 200) return response;
            return {...response, ...authOf(response)};
        };

        const sink = createStubSink();
        AuditSinkRegistry.set(sink);

        const bootstrap = await login({username: "admin", password: ADMIN_PASSWORD, bootstrapToken});
        if(bootstrap.status !== 200) throw new Error(`audit-sink fixture bootstrap failed: ${JSON.stringify(bootstrap.body)}`);
        sink.events.length = 0;

        await check({
            rootDir: root.rootDir, api, tunnel, sink, store,
            admin: {
                auth: bootstrap.auth!, sessionKey: bootstrap.sessionKey!,
                userId: bootstrap.body.user.id, mustChangePassword: bootstrap.body.mustChangePassword
            },
            request, login, freePort: getFreePort, raw
        });
        // #109 K3 확장 — 이 시나리오가 실제로 기록한 type 전수가 상수 목록 안에 있어야 한다.
        expect(sink.allEvents.map((event) => event.type).filter((type) => !AUDIT_EVENT_TYPE_LIST.includes(type))).toEqual([]);
    } finally {
        try { await api?.close(); }
        finally {
            try { await tunnel?.close(); }
            finally { await cleanupTestRoot(root); }
        }
    }
};

const tunnelBody = (forwardPort: number, destinationPort: number, store: ServerOptionStore) => ({
    forwardPort, protocol: "tcp", tls: false, destinationAddress: "127.0.0.1", destinationPort, keepAlive: 0,
    expectedRevision: store.revisionState.currentRevision
});

describe("audit-sink: 라우트 표의 CUD 전수 감사 커버리지", () => {
    // K3 — 4 단위·5 단위가 항목을 더해도 이 판정이 그대로 강제된다.
    it("GET 이 아니고 public·session 도 아닌 라우트 전부와 POST /api/logout 에 audit 이 정의되어 있다", () => {
        const requiring = ADMIN_ROUTES.filter((route) =>
            route.method !== "GET" && route.action !== "public" && route.action !== "session");
        expect(requiring.length).toBeGreaterThan(0);
        const missing = requiring.filter((route) => route.audit === undefined)
            .map((route) => `${route.method} ${route.pattern.source}`);
        expect(missing).toEqual([]);

        // #112 (U4-04): 감사 면제는 audit: false 로 표에 적힌 예외뿐이다. 조용히 빠뜨린 라우트가 없게 목록을 고정한다.
        const exempt = requiring.filter((route) => route.audit === false)
            .map((route) => `${route.method} ${route.pattern.source}`);
        expect(exempt).toEqual([`POST ${new RegExp("^/api/me/mfa/enroll$").source}`]);
        const mfaAudited = requiring.filter((route) => route.pattern.source.includes("mfa") && typeof route.audit === "function")
            .map((route) => `${route.method} ${route.pattern.source}`).sort();
        // #113 (U4-05): 세션 강제 종료 세 경로는 감사 대상이다.
        const sessionAudited = requiring.filter((route) => route.pattern.source.includes("sessions") && typeof route.audit === "function")
            .map((route) => `${route.method} ${route.pattern.source}`).sort();
        expect(sessionAudited).toEqual([
            `DELETE ${new RegExp("^/api/sessions/(?<id>[^/]+)$").source}`,
            `DELETE ${new RegExp("^/api/users/(?<id>[^/]+)/sessions$").source}`,
            `POST ${new RegExp("^/api/me/sessions/logout-others$").source}`,
        ].sort());
        expect(mfaAudited).toEqual([
            `DELETE ${new RegExp("^/api/me/mfa$").source}`,
            `POST ${new RegExp("^/api/me/mfa/confirm$").source}`,
            `POST ${new RegExp("^/api/me/mfa/recovery-codes$").source}`,
            // #127 (U4-08): 슈퍼유저의 남의 MFA 초기화.
            `POST ${new RegExp("^/api/users/(?<id>[^/]+)/mfa/reset$").source}`,
        ].sort());

        const logout = ADMIN_ROUTES.find((route) =>
            route.method === "POST" && route.pattern.source === new RegExp("^/api/logout$").source)!;
        expect(typeof logout.audit).toBe("function");
    });

    // K3 확장(#109) — 표가 내는 감사 타입이 상수 파일 밖의 문자열이면 조회 API·단위 5 가 어긋난다.
    it("라우트 표의 audit 메타가 내는 type 이 전부 AUDIT_EVENT_TYPE_LIST 에 있다", async () => {
        const root = await createTestRoot("audit-sink-types");
        try {
            applyTestRoot(root.rootDir);
            // 본문에 따라 타입이 갈리는 라우트(users PUT, groups PUT, tunneling/active)를 모두 지나가게 한다.
            const bodies: object[] = [
                {username: "alice", name: "team", forwardPort: 19000, active: true, role: "regular"},
                {username: "alice", name: "team", forwardPort: 19000, active: false, status: "disabled"},
                {username: "alice", name: "team", forwardPort: 19000, displayName: "Alice", attributes: {}}
            ];
            const types = bodies.flatMap((body) => {
                const ctx = {
                    req: {} as any, res: {statusCode: 200} as any,
                    params: {id: "g_1", port: "19000", ip: "127.0.0.1"},
                    body,
                    session: {key: "audit-sink-session-key"} as any,
                    principal: {userId: "u_1", username: "admin", role: "superuser", mustChangePassword: false} as any,
                    ip: "127.0.0.1",
                    ok: () => {}, fail: () => {}, auditDetail: () => {}
                } as unknown as RouteContext;
                return ADMIN_ROUTES.flatMap((route) => typeof route.audit === "function" ? [route.audit(ctx).type] : []);
            });

            expect(types.length).toBeGreaterThan(0);
            expect(types.filter((type) => !AUDIT_EVENT_TYPE_LIST.includes(type))).toEqual([]);
            // 분기 라우트가 실제로 갈렸는지 확인해, 한 가지 타입만 훑고 통과하는 일을 막는다.
            expect(types).toContain("role_changed");
            expect(types).toContain("user_status_changed");
            expect(types).toContain("user_updated");
            expect(types).toContain("group_attributes_changed");
            expect(types).toContain("tunnel_activated");
            expect(types).toContain("tunnel_deactivated");
        } finally {
            await cleanupTestRoot(root);
        }
    });

    it("GET 라우트에는 audit 을 달지 않는다", () => {
        const audited = ADMIN_ROUTES.filter((route) => route.method === "GET" && route.audit !== undefined)
            .map((route) => route.pattern.source);
        expect(audited).toEqual([]);
    });
});

describe("audit-sink: audited() 가 감싼 CUD 라우트", () => {
    let bcryptCostBackup: number;
    beforeAll(() => { bcryptCostBackup = IdentityStore.bcryptCost; IdentityStore.bcryptCost = 4; });
    afterAll(() => { IdentityStore.bcryptCost = bcryptCostBackup; });

    it("터널 생성 성공이 주체·세션·IP 까지 갖춘 tunnel_created 를 남긴다", async () => withAuditServer(async (f) => {
        const service = await startEchoServer();
        try {
            const forwardPort = await f.freePort();
            const response = await f.request("POST", "/api/tunnelingOption", tunnelBody(forwardPort, service.port, f.store), f.admin.auth);
            expect(response.status).toBe(200);

            expect(f.sink.events).toHaveLength(1);
            expect(f.sink.events[0]).toMatchObject({
                type: "tunnel_created",
                outcome: "success",
                actor: {username: "admin", role: "superuser"},
                target: {kind: "tunnel", id: String(forwardPort)},
                sessionIdHash: SessionStore.sessionIdOf(f.admin.sessionKey),
                ip: "127.0.0.1"
            });
        } finally { await service.close(); }
    }));

    it("잘못된 본문으로 400 이 나면 응답 상태는 그대로이고 이벤트는 failure 다", async () => withAuditServer(async (f) => {
        const response = await f.request("POST", "/api/tunnelingOption",
            {protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 8080, expectedRevision: f.store.revisionState.currentRevision},
            f.admin.auth);
        expect(response.status).toBe(400);
        expect(f.sink.events).toHaveLength(1);
        expect(f.sink.events[0]).toMatchObject({type: "tunnel_created", outcome: "failure"});
    }));

    // #146 — 예상하지 못한 예외의 문자열(파일 경로 등)이 응답 본문과 감사 detail 로 나가지 않는다.
    const LEAKY_PATH = "/srv/tttgate-internal/config/identity.yaml";
    const leakyError = () => Object.assign(new Error(`EACCES: permission denied, open '${LEAKY_PATH}'`), {code: "EACCES"});

    it("#146 GET 핸들러의 예외는 고정 메시지의 500 이고 내부 경로를 싣지 않는다", async () => withAuditServer(async (f) => {
        const spy = jest.spyOn(IdentityStore.instance, "users").mockImplementation(() => { throw leakyError(); });
        try {
            const response = await f.request("GET", "/api/users", {}, f.admin.auth);
            expect(response.status).toBe(500);
            expect(JSON.stringify(response.body)).not.toContain("tttgate-internal");
            expect(response.body.message).toBe("Internal Server Error");
        } finally { spy.mockRestore(); }
    }));

    it("#146 감사 대상 라우트의 예외는 detail.error 에 오류 코드만 남긴다", async () => withAuditServer(async (f) => {
        const spy = jest.spyOn(IdentityStore.instance, "createGroup").mockImplementation(() => { throw leakyError(); });
        try {
            const response = await f.request("POST", "/api/groups", {name: "Leaky"}, f.admin.auth);
            expect(response.status).toBe(500);
            expect(JSON.stringify(response.body)).not.toContain("tttgate-internal");
        } finally { spy.mockRestore(); }
        const event = f.sink.events.find((candidate) => candidate.outcome === "failure");
        expect(event).toBeDefined();
        expect(event!.detail).toMatchObject({error: "EACCES"});
        expect(JSON.stringify(event)).not.toContain("tttgate-internal");
    }));

    it("없는 포트를 지우면 404 응답과 tunnel_deleted failure 가 함께 남는다", async () => withAuditServer(async (f) => {
        const absent = await f.freePort();
        const response = await f.request("DELETE", "/api/tunnelingOption",
            {forwardPort: absent, expectedRevision: f.store.revisionState.currentRevision}, f.admin.auth);
        expect(response.status).toBe(404);
        expect(f.sink.events).toHaveLength(1);
        expect(f.sink.events[0]).toMatchObject({type: "tunnel_deleted", outcome: "failure", target: {kind: "tunnel", id: String(absent)}});
    }));

    it("reserve() 가 false 면 핸들러를 실행하지 않고 503 audit_unavailable 을 내며 GET 은 그대로 동작한다", async () => withAuditServer(async (f) => {
        const service = await startEchoServer();
        try {
            const before = f.store.serverOption.tunnelingOptions.length;
            f.sink.reserveResult = false;

            const response = await f.request("POST", "/api/tunnelingOption",
                tunnelBody(await f.freePort(), service.port, f.store), f.admin.auth);
            expect(response.status).toBe(503);
            expect(response.body.code).toBe("audit_unavailable");
            expect(f.sink.events).toHaveLength(0);
            expect(f.store.serverOption.tunnelingOptions.length).toBe(before);

            const read = await f.request("GET", "/api/tunnelingOption", {}, f.admin.auth);
            expect(read.status).toBe(200);
        } finally { await service.close(); }
    }));

    // 핸들러의 active == true 와 감사 메타의 판정이 갈리면 감사가 실제와 반대를 말한다.
    // "true" 는 truthy 이면서 == true 가 아니므로 두 술어가 갈리는 값이다.
    it("truthy 이지만 true 가 아닌 active 값에서도 감사가 실제 동작과 같은 답을 낸다", async () => withAuditServer(async (f) => {
        const service = await startEchoServer();
        try {
            const forwardPort = await f.freePort();
            const created = await f.request("POST", "/api/tunnelingOption", tunnelBody(forwardPort, service.port, f.store), f.admin.auth);
            expect(created.status).toBe(200);

            // 두 술어가 같은 답을 내는 값으로 먼저 활성화해 둔다.
            f.sink.events.length = 0;
            const activated = await f.request("POST", `/api/tunneling/active/${forwardPort}`, {active: true}, f.admin.auth);
            expect(activated.status).toBe(200);
            expect(f.tunnel.externalServerStatus(forwardPort).active).toBe(true);
            expect(f.sink.events).toHaveLength(1);
            expect(f.sink.events[0]).toMatchObject({type: "tunnel_activated", outcome: "success"});

            f.sink.events.length = 0;
            const deactivated = await f.request("POST", `/api/tunneling/active/${forwardPort}`, {active: "true"}, f.admin.auth);
            expect(deactivated.status).toBe(200);
            expect(f.tunnel.externalServerStatus(forwardPort).active).toBe(false);

            expect(f.sink.events).toHaveLength(1);
            expect(f.sink.events[0]).toMatchObject({
                type: "tunnel_deactivated", outcome: "success", target: {kind: "tunnel", id: String(forwardPort)}
            });
        } finally { await service.close(); }
    }));

    it("비밀번호 변경과 로그아웃이 각각 password_changed·logout 을 남기고 detail 에 비밀값이 없다", async () => withAuditServer(async (f) => {
        const changed = await f.request("PUT", "/api/me/password",
            {currentPassword: ADMIN_PASSWORD, newPassword: "audit-next-password"}, f.admin.auth);
        expect(changed.status).toBe(200);
        expect(f.sink.events).toHaveLength(1);
        expect(f.sink.events[0]).toMatchObject({
            type: "password_changed", outcome: "success", target: {kind: "user", id: f.admin.userId}
        });
        expect(f.sink.events[0].detail).toEqual({firstLogin: f.admin.mustChangePassword});

        f.sink.events.length = 0;
        const loggedOut = await f.request("POST", "/api/logout", {}, f.admin.auth);
        expect(loggedOut.status).toBe(200);
        expect(f.sink.events).toHaveLength(1);
        expect(f.sink.events[0]).toMatchObject({
            type: "logout", outcome: "success",
            target: {kind: "session", id: SessionStore.sessionIdOf(f.admin.sessionKey)}
        });
    }));
});

describe("audit-sink: audited() 밖의 이벤트", () => {
    let bcryptCostBackup: number;
    beforeAll(() => { bcryptCostBackup = IdentityStore.bcryptCost; IdentityStore.bcryptCost = 4; });
    afterAll(() => { IdentityStore.bcryptCost = bcryptCostBackup; });

    it("로그인 성공·실패가 별도 타입으로 남고 배압과 무관하게 응답한다", async () => withAuditServer(async (f) => {
        const success = await f.login({username: "admin", password: ADMIN_PASSWORD});
        expect(success.status).toBe(200);
        expect(f.sink.events).toHaveLength(1);
        expect(f.sink.events[0]).toMatchObject({
            type: "login_success", outcome: "success",
            actor: {username: "admin", role: "superuser"},
            target: {kind: "user", id: f.admin.userId}
        });
        expect(f.sink.events[0].sessionIdHash).toHaveLength(16);
        expect(f.sink.events[0].detail ?? {}).not.toHaveProperty("password");

        f.sink.events.length = 0;
        const failure = await f.login({username: "admin", password: "wrong-password"});
        expect(failure.status).toBe(401);
        expect(f.sink.events).toHaveLength(1);
        expect(f.sink.events[0]).toMatchObject({type: "login_failure", outcome: "failure", actor: {userId: "system"}});
        expect(f.sink.events[0].detail).toMatchObject({username: "admin"});
        expect(f.sink.events[0].detail).not.toHaveProperty("password");
        expect(f.sink.events[0].target).toBeUndefined();

        f.sink.events.length = 0;
        f.sink.reserveResult = false;
        const backpressured = await f.login({username: "admin", password: ADMIN_PASSWORD});
        expect(backpressured.status).toBe(200);
    }));

    it("로그인 실패 감사는 형식이 틀린 username 원문을 남기지 않는다", async () => withAuditServer(async (f) => {
        // 로그인 본문 상한(16 KiB, #265) 안에서 가장 긴 축에 드는 값이다. 그보다 크면 본문 단계에서 413 으로 끝난다.
        const huge = "x".repeat(8 * 1024);
        expect((await f.login({username: huge, password: "wrong-password"})).status).toBe(401);
        expect((await f.login({username: "hunter2!!secret", password: "wrong-password"})).status).toBe(401);
        const failures = f.sink.events.filter((event) => event.type === "login_failure");
        expect(failures).toHaveLength(2);
        expect(failures[0].detail).toEqual({username: "(invalid)", usernameLength: huge.length});
        expect(failures[0].summary).toBe("login_failure (invalid)");
        expect(failures[1].detail).toEqual({username: "(invalid)", usernameLength: "hunter2!!secret".length});
        const serialized = JSON.stringify(failures);
        expect(serialized).not.toContain("x".repeat(64));
        expect(serialized).not.toContain("hunter2");
    }));

    it("차단(429) 중의 반복 로그인 실패는 IP 별로 묶여 감사가 요청 수만큼 늘지 않는다", async () => withAuditServer(async (f) => {
        let status = 0;
        for(let i = 0; i < 10 && status !== 429; i += 1) {
            status = (await f.login({username: "admin", password: "wrong-password"})).status;
        }
        expect(status).toBe(429);
        for(let i = 0; i < 5; i += 1) {
            expect((await f.login({username: "admin", password: "wrong-password"})).status).toBe(429);
        }
        const blocked = f.sink.events.filter((event) => event.type === "login_failure" && (event.detail as any)?.blocked === true);
        expect(blocked).toHaveLength(1);
        // 차단 전 실패는 지금처럼 하나씩 남는다.
        const plain = f.sink.events.filter((event) => event.type === "login_failure" && (event.detail as any)?.blocked !== true);
        expect(plain.length).toBeGreaterThanOrEqual(1);
        expect(plain.every((event) => (event.detail as any).username === "admin")).toBe(true);
    }), 60_000);

    it("권한 거부가 access_denied 로 남는다", async () => withAuditServer(async (f) => {
        const created = await IdentityStore.instance.createUser({
            username: "bob", displayName: "Bob", role: "regular", mustChangePassword: false, password: REGULAR_PASSWORD
        });
        expect(created.success).toBe(true);

        const regular = await f.login({username: "bob", password: REGULAR_PASSWORD});
        expect(regular.status).toBe(200);
        f.sink.events.length = 0;

        const denied = await f.request("GET", "/api/serverOption", {}, regular.auth);
        expect(denied.status).toBe(403);
        expect(f.sink.events).toHaveLength(1);
        expect(f.sink.events[0]).toMatchObject({
            type: "access_denied", outcome: "failure", actor: {username: "bob"},
            detail: {action: "server:manage", path: "/api/serverOption", status: 403}
        });

        // #186 대상을 숨기는 거부(404)도 응답과 같은 상태 코드로 남아 403 과 구별된다.
        f.sink.events.length = 0;
        const hidden = await f.request("POST", "/api/tunneling/active/65000", {}, regular.auth);
        expect(hidden.status).toBe(404);
        expect(f.sink.events).toHaveLength(1);
        expect(f.sink.events[0]).toMatchObject({
            type: "access_denied", detail: {action: "tunnel:activate", path: "/api/tunneling/active/65000", status: 404}
        });
        expect(f.sink.events[0].detail).not.toHaveProperty("code");
    }));

    it("마지막 슈퍼유저 가드가 409 를 낼 때 last_superuser_guard_hit 를 남긴다", async () => withAuditServer(async (f) => {
        const store = IdentityStore.instance;
        f.sink.events.length = 0;

        const demoted = store.updateUser(f.admin.userId, {role: "regular"});
        expect(demoted.success).toBe(false);
        expect(f.sink.events).toHaveLength(1);
        expect(f.sink.events[0]).toMatchObject({
            type: "last_superuser_guard_hit", outcome: "failure",
            actor: {userId: "system"}, target: {kind: "user", id: f.admin.userId}, detail: {operation: "demote"}
        });

        f.sink.events.length = 0;
        const deleted = store.deleteUser(f.admin.userId);
        expect(deleted.success).toBe(false);
        expect(f.sink.events).toHaveLength(1);
        expect(f.sink.events[0]).toMatchObject({type: "last_superuser_guard_hit", detail: {operation: "delete"}});
    }));
});

describe("audit-sink: detail 마스킹은 기록 진입점 한 곳에서만 한다", () => {
    // 현재 라우트의 detail 에는 비밀 키가 없어 요청만으로는 마스킹을 유발할 수 없다.
    // 두 기록 경로를 직접 불러, 마스킹이 사라지면 반드시 실패하도록 고정한다.
    // 스텁 싱크는 LoggerAuditSink 를 거치지 않으므로 진입점의 마스킹만 검증된다.
    const TEMPORARY_PASSWORD_PLAINTEXT = "audited-temporary-password-plaintext";
    const SESSION_TOKEN_PLAINTEXT = "emitted-session-token-plaintext";

    it("audited() 가 싱크에 넘기는 detail 은 이미 마스킹되어 있다", async () => withAuditServer(async (f) => {
        const ctx = {req: {} as any, res: {statusCode: 200} as any, params: {}, ip: "127.0.0.1"};
        await (f.api as any).audited(ctx,
            {type: "temp_password_issued", target: {kind: "user", id: "u_1"}, summary: "temp_password_issued u_1",
                detail: {temporaryPassword: TEMPORARY_PASSWORD_PLAINTEXT}},
            async () => {});

        expect(f.sink.events).toHaveLength(1);
        expect(f.sink.events[0].detail).toEqual({temporaryPassword: "[REDACTED]"});
        expect(JSON.stringify(f.sink.events[0])).not.toContain(TEMPORARY_PASSWORD_PLAINTEXT);
    }));

    it("emitAudit() 가 싱크에 넘기는 detail 도 같은 마스킹을 거친다", async () => withAuditServer(async (f) => {
        (f.api as any).emitAudit({
            at: 1_757_548_800_000, actor: {userId: "system"}, ip: "127.0.0.1",
            type: "login_failure", outcome: "failure", summary: "login_failure",
            detail: {sessionToken: SESSION_TOKEN_PLAINTEXT}
        });

        expect(f.sink.events).toHaveLength(1);
        expect(f.sink.events[0].detail).toEqual({sessionToken: "[REDACTED]"});
        expect(JSON.stringify(f.sink.events[0])).not.toContain(SESSION_TOKEN_PLAINTEXT);
    }));
});

describe("audit-sink: 본문 파싱 단계에서 실패한 CUD 요청(#135)", () => {
    let bcryptCostBackup: number;
    beforeAll(() => { bcryptCostBackup = IdentityStore.bcryptCost; IdentityStore.bcryptCost = 4; });
    afterAll(() => { IdentityStore.bcryptCost = bcryptCostBackup; });

    const rejected = (f: Fixture) => f.sink.events.filter((event) => event.type === "request_body_rejected");

    it("1MiB 를 넘는 본문은 413 이고 실패 이벤트가 경로와 함께 남는다", async () => withAuditServer(async (f) => {
        const huge = JSON.stringify({username: "x".repeat(1024 * 1024 + 16)});
        // 서버는 413 을 보낸 뒤 요청을 끊으므로, 클라이언트는 응답 대신 연결 종료를 볼 수도 있다.
        let status: number | undefined;
        try { status = (await f.raw("POST", "/api/users", huge, f.admin.auth)).status; } catch { status = undefined; }
        expect([413, undefined]).toContain(status);
        for(let i = 0; i < 50 && rejected(f).length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
        expect(rejected(f)).toHaveLength(1);
        expect(rejected(f)[0]).toMatchObject({
            outcome: "failure", actor: {userId: f.admin.userId},
            summary: "request_body_rejected POST /api/users",
            detail: {method: "POST", path: "/api/users", reason: "too_large"}
        });
        expect(rejected(f)[0].target).toBeUndefined();
    }));

    it("깨진 JSON 은 400 이고 실패 이벤트가 남되 본문 조각은 담지 않는다", async () => withAuditServer(async (f) => {
        const response = await f.raw("PUT", `/api/users/${f.admin.userId}`, '{"displayName": "secret-fragment', f.admin.auth);
        expect(response.status).toBe(400);
        expect(rejected(f)).toHaveLength(1);
        expect(rejected(f)[0]).toMatchObject({outcome: "failure", detail: {method: "PUT", path: `/api/users/${f.admin.userId}`, reason: "invalid_json"}});
        expect(JSON.stringify(rejected(f)[0])).not.toContain("secret-fragment");
    }));

    it("권한이 없는 사용자의 본문 실패는 그 사용자의 CUD 시도로 남기지 않는다", async () => withAuditServer(async (f) => {
        const created = await f.request("POST", "/api/users", {username: "mallory", role: "regular"}, f.admin.auth);
        expect(created.status).toBe(201);
        const first = await f.login({username: "mallory", password: created.body.temporaryPassword});
        expect((await f.request("PUT", "/api/me/password",
            {currentPassword: created.body.temporaryPassword, newPassword: "mallory-next-pass"}, first.auth!)).status).toBe(200);
        const mallory = await f.login({username: "mallory", password: "mallory-next-pass"});
        f.sink.events.length = 0;
        const response = await f.raw("POST", "/api/users", '{"username": "broken', mallory.auth!);
        // #173: 정적 action 라우트는 본문을 읽기 전에 권한을 판정한다. 깨진 본문이어도 400 이 아니라 403 이다.
        expect(response.status).toBe(403);
        expect(rejected(f)).toEqual([]);
        expect(f.sink.events.filter((event) => event.type === "access_denied")).toHaveLength(1);
    }));

    it("#173 권한이 없는 사용자의 큰 본문은 읽지 않고 403 으로 거절한다", async () => withAuditServer(async (f) => {
        const created = await IdentityStore.instance.createUser({
            username: "bob", displayName: "Bob", role: "regular", mustChangePassword: false, password: REGULAR_PASSWORD
        });
        expect(created.success).toBe(true);
        const bob = await f.login({username: "bob", password: REGULAR_PASSWORD});
        f.sink.events.length = 0;
        const huge = JSON.stringify({username: "x".repeat(1024 * 1024 + 16)});
        let status: number | undefined;
        try { status = (await f.raw("POST", "/api/users", huge, bob.auth!)).status; } catch { status = undefined; }
        expect(status).toBe(403);
        expect(rejected(f)).toEqual([]);
    }));

    it("#173 access_denied 감사의 경로와 경로 id 대상은 길이를 자른다", async () => withAuditServer(async (f) => {
        const created = await IdentityStore.instance.createUser({
            username: "bob", displayName: "Bob", role: "regular", mustChangePassword: false, password: REGULAR_PASSWORD
        });
        expect(created.success).toBe(true);
        const bob = await f.login({username: "bob", password: REGULAR_PASSWORD});
        f.sink.events.length = 0;
        const longId = "a".repeat(10_000);
        expect((await f.request("PUT", `/api/users/${longId}`, {displayName: "x"}, bob.auth)).status).toBe(403);
        const denied = f.sink.events.find((event) => event.type === "access_denied")!;
        expect(String(denied.detail?.path).length).toBeLessThanOrEqual(257);
        expect(JSON.stringify(denied).length).toBeLessThan(2_000);

        f.sink.events.length = 0;
        expect((await f.request("DELETE", `/api/users/${longId}`, {}, f.admin.auth)).status).toBe(404);
        const failed = f.sink.events.find((event) => event.type === "user_deleted")!;
        expect(String(failed.target?.id).length).toBeLessThanOrEqual(257);
    }));

    it("public 라우트와 GET 라우트에서는 남기지 않는다", async () => withAuditServer(async (f) => {
        const login = await f.raw("POST", "/api/login", '{"username": "admin", "password": ', {});
        expect(login.status).toBe(400);
        const listed = await f.raw("GET", "/api/users", '{"broken', f.admin.auth);
        expect(listed.status).toBe(200);
        expect(rejected(f)).toEqual([]);
    }));
});
