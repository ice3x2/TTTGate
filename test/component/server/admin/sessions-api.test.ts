import fs from "node:fs/promises";
import path from "node:path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import SessionStore from "../../../../src/server/admin/SessionStore";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {AuditEvent, AuditSink, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {serializeIdentityFixture} from "../../../helpers/identityFixture";
import {getFreePort} from "../../../helpers/network";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

// U4-05 / #113 — 세션 목록·강제 종료·다른 기기 로그아웃 API. 실제 AdminServer.
jest.setTimeout(60_000);

const ADMIN_PASSWORD = "test-password-1234";
const USER_PASSWORD = "user-password-1234";

type ApiResponse = {status: number; headers: any; body: any; raw: string};
type Auth = {Cookie: string; "X-CSRF-Token": string};
type StubSink = AuditSink & {events: AuditEvent[]};

const authOf = (response: ApiResponse): Auth => {
    const pairs = (response.headers["set-cookie"] as string[]).map((value) => value.split(";")[0]);
    return {
        Cookie: pairs.join("; "),
        "X-CSRF-Token": pairs.find((value) => value.startsWith("csrfToken="))!.slice("csrfToken=".length)
    };
};

describe("sessions-api", () => {
    let testRoot: TestRoot;
    let api: AdminServer | undefined;
    let sink: StubSink;
    let bcryptCostBackup: number;
    let request: (method: string, target: string, body?: object, headers?: Record<string, string>) => Promise<ApiResponse>;
    let aliceId: string;

    const login = async (username: string, password: string, userAgent: string): Promise<Auth> => {
        const response = await request("POST", "/api/login", {username, password}, {"User-Agent": userAgent});
        expect({username, status: response.status}).toEqual({username, status: 200});
        return authOf(response);
    };

    /** 목록에서 userAgent 로 세션 하나를 찾는다(로그인마다 다른 User-Agent 를 보낸다). */
    const sessionOf = (sessions: any[], userAgent: string): any => sessions.find((session) => session.userAgent === userAgent);

    beforeAll(async () => {
        bcryptCostBackup = IdentityStore.bcryptCost;
        IdentityStore.bcryptCost = 4;
        testRoot = await createTestRoot("sessions-api");
        applyTestRoot(testRoot.rootDir);
        await CertificationStore.instance.load();
        const store = ServerOptionStore.instance;
        if(!store.updateServerOption({...store.serverOption, port: await getFreePort(), adminBindHost: "127.0.0.1",
            adminTls: false, tls: false, keepAlive: 0, tunnelingOptions: []})) {
            throw new Error("sessions-api fixture: invalid server option");
        }
        await fs.writeFile(path.join(testRoot.rootDir, "config", "identity.yaml"), await serializeIdentityFixture({users: [
            {username: "admin", password: ADMIN_PASSWORD, role: "superuser"},
            {username: "alice", password: USER_PASSWORD, role: "regular"},
        ]}), "utf8");
        IdentityStore.resetForTest();
        SessionStore.resetForTest();
        await IdentityMigration.runAtStartup();
        aliceId = IdentityStore.instance.userByUsername("alice")!.id;

        api = new AdminServer(undefined as any, false);
        const port = await api.listen(0, "127.0.0.1");
        request = async (method, target, body = {}, headers = {}) => {
            const bytes = JSON.stringify(body);
            const response = await httpRequest({
                port, path: target, method,
                headers: {"Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bytes)), ...headers},
                body: bytes
            });
            let parsed: any;
            try { parsed = JSON.parse(response.body); } catch { parsed = response.body; }
            return {status: response.statusCode, headers: response.headers, body: parsed, raw: response.body};
        };
        sink = {
            events: [],
            reserve(): boolean { return true; },
            record(event: AuditEvent): Promise<void> { this.events.push(event); return Promise.resolve(); }
        };
        AuditSinkRegistry.set(sink);
    });

    afterAll(async () => {
        IdentityStore.bcryptCost = bcryptCostBackup;
        AuditSinkRegistry.reset();
        try { await api?.close(); } finally { await cleanupTestRoot(testRoot); }
    });

    it("슈퍼유저 목록·강제 종료·사용자별 종료·본인 다른 기기 로그아웃·본인 세션 종료가 이어서 동작한다", async () => {
        const a = await login("admin", ADMIN_PASSWORD, "agent-A");
        const b = await login("alice", USER_PASSWORD, "agent-B");
        const c = await login("alice", USER_PASSWORD, "agent-C");
        // 만든 순서(A, B, C)와 다른 순서가 나오도록 C 를 갱신한다. A 는 목록 요청 자체로 가장 최근이 된다.
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect((await request("GET", "/api/me", {}, c)).status).toBe(200);
        await new Promise((resolve) => setTimeout(resolve, 20));

        // 목록
        const listed = await request("GET", "/api/sessions", {}, a);
        expect(listed.status).toBe(200);
        const sessions: any[] = listed.body.sessions;
        expect(sessions).toHaveLength(3);
        expect(sessionOf(sessions, "agent-A")).toMatchObject({username: "admin", current: true});
        expect(sessionOf(sessions, "agent-B")).toMatchObject({username: "alice", userId: aliceId, current: false});
        expect(sessionOf(sessions, "agent-C")).toMatchObject({username: "alice", userId: aliceId, current: false});
        for(const session of sessions) {
            expect(Object.keys(session).sort()).toEqual(["createdAt", "current", "id", "ip", "lastSeenAt", "userAgent", "userId", "username"]);
            expect(session.id).toMatch(/^[0-9a-f]{16}$/);
        }
        expect(sessions.map((session) => session.userAgent)).toEqual(["agent-A", "agent-C", "agent-B"]);
        const lastSeen = sessions.map((session) => session.lastSeenAt);
        expect(lastSeen).toEqual([...lastSeen].sort((x, y) => y - x));
        expect(listed.raw).not.toMatch(/[0-9a-f]{64}/);
        const idA = sessionOf(sessions, "agent-A").id;
        const idB = sessionOf(sessions, "agent-B").id;

        // 특정 세션 강제 종료
        const killed = await request("DELETE", `/api/sessions/${idB}`, {}, a);
        expect(killed.status).toBe(200);
        expect(killed.body).toMatchObject({removed: true, self: false});
        expect(killed.headers["set-cookie"]).toBeUndefined();
        expect((await request("GET", "/api/me", {}, b)).status).toBe(401);
        expect((await request("GET", "/api/me", {}, c)).status).toBe(200);
        const again = await request("DELETE", `/api/sessions/${idB}`, {}, a);
        expect(again.status).toBe(404);
        expect(again.body.code).toBe("session_not_found");

        // 사용자별 전부 종료
        const byUser = await request("DELETE", `/api/users/${aliceId}/sessions`, {}, a);
        expect(byUser.status).toBe(200);
        expect(byUser.body).toMatchObject({removed: 1, self: false});
        expect((await request("GET", "/api/me", {}, c)).status).toBe(401);
        const noUser = await request("DELETE", "/api/users/u_doesnotexist/sessions", {}, a);
        expect(noUser.status).toBe(404);
        expect(noUser.body.code).toBe("user_not_found");

        // 본인 세션 목록과 다른 기기 로그아웃
        const d = await login("alice", USER_PASSWORD, "agent-D");
        const e = await login("alice", USER_PASSWORD, "agent-E");
        const mine = await request("GET", "/api/me/sessions", {}, d);
        expect(mine.status).toBe(200);
        expect(mine.body.sessions).toHaveLength(2);
        expect(mine.body.sessions.every((session: any) => session.userId === aliceId)).toBe(true);
        expect(sessionOf(mine.body.sessions, "agent-D").current).toBe(true);
        expect(sessionOf(mine.body.sessions, "agent-E").current).toBe(false);
        const others = await request("POST", "/api/me/sessions/logout-others", {}, d);
        expect(others.status).toBe(200);
        expect(others.body.removed).toBe(1);
        expect((await request("GET", "/api/me", {}, e)).status).toBe(401);
        expect((await request("GET", "/api/me", {}, d)).status).toBe(200);
        expect((await request("POST", "/api/me/sessions/logout-others", {}, d)).body.removed).toBe(0);

        // 일반 유저는 세션 관리 API 를 쓸 수 없다
        expect((await request("GET", "/api/sessions", {}, d)).status).toBe(403);
        expect((await request("DELETE", `/api/sessions/${idA}`, {}, d)).status).toBe(403);
        expect((await request("DELETE", `/api/users/${aliceId}/sessions`, {}, d)).status).toBe(403);
        expect((await request("GET", "/api/me", {}, a)).status).toBe(200);

        // CSRF
        expect((await request("DELETE", `/api/sessions/${idA}`, {}, {Cookie: a.Cookie})).status).toBe(403);
        expect((await request("POST", "/api/me/sessions/logout-others", {}, {Cookie: d.Cookie})).status).toBe(403);
        expect((await request("GET", "/api/me", {}, a)).status).toBe(200);

        // 본인 세션 종료는 만료 쿠키를 붙인다
        const self = await request("DELETE", `/api/sessions/${idA}`, {}, a);
        expect(self.status).toBe(200);
        expect(self.body).toMatchObject({removed: true, self: true});
        const cookies: string[] = self.headers["set-cookie"];
        expect(cookies.some((cookie) => cookie.startsWith("sessionKey=;") && cookie.includes("Max-Age=0"))).toBe(true);
        expect(cookies.some((cookie) => cookie.startsWith("csrfToken=;") && cookie.includes("Max-Age=0"))).toBe(true);
        expect((await request("GET", "/api/me", {}, a)).status).toBe(401);

        // 감사
        const ofType = (type: string) => sink.events.filter((event) => event.type === type && event.outcome === "success");
        expect(ofType("session_killed").map((event) => [event.target, event.detail?.userId])).toEqual([
            [{kind: "session", id: idB}, aliceId],
            [{kind: "session", id: idA}, IdentityStore.instance.userByUsername("admin")!.id]
        ]);
        expect(ofType("sessions_killed_for_user").map((event) => [event.target, event.detail?.removed])).toEqual([[{kind: "user", id: aliceId}, 1]]);
        expect(ofType("sessions_killed_self_others").map((event) => [event.target, event.detail?.removed])).toEqual([
            [{kind: "user", id: aliceId}, 1], [{kind: "user", id: aliceId}, 0]
        ]);
        expect(JSON.stringify(sink.events)).not.toMatch(/[0-9a-f]{64}/);
    });

    it("슈퍼유저가 자기 계정의 세션 전부를 끊으면 만료 쿠키가 붙는다", async () => {
        const admin = await login("admin", ADMIN_PASSWORD, "agent-self-1");
        const otherDevice = await login("admin", ADMIN_PASSWORD, "agent-self-2");
        const adminId = IdentityStore.instance.userByUsername("admin")!.id;
        const response = await request("DELETE", `/api/users/${adminId}/sessions`, {}, admin);
        expect(response.status).toBe(200);
        expect(response.body.self).toBe(true);
        expect(response.body.removed).toBe(2);
        expect((await request("GET", "/api/me", {}, otherDevice)).status).toBe(401);
        const cookies: string[] = response.headers["set-cookie"];
        expect(cookies.some((cookie) => cookie.startsWith("sessionKey=;") && cookie.includes("Max-Age=0"))).toBe(true);
        expect((await request("GET", "/api/me", {}, admin)).status).toBe(401);
    });

    // #250 — 사용자당 세션 상한(20)을 넘는 로그인은 가장 오래 쓰지 않은 세션을 끝내고 감사 로그에 남긴다.
    it("로그인이 사용자당 세션 상한을 넘으면 가장 오래 쓰지 않은 세션을 끝내고 감사 로그에 남긴다", async () => {
        // 앞 테스트가 남긴 세션과 섞이지 않게 alice 의 세션을 비우고 시작한다.
        SessionStore.instance.removeSessionsOfUser(aliceId);
        const first = await login("alice", USER_PASSWORD, "limit-0");
        const firstId = sessionOf((await request("GET", "/api/me/sessions", {}, first)).body.sessions, "limit-0").id;
        for(let n = 1; n < 20; n++) await login("alice", USER_PASSWORD, `limit-${n}`);
        const before = sink.events.length;
        await login("alice", USER_PASSWORD, "limit-20");
        expect((await request("GET", "/api/me", {}, first)).status).toBe(401);
        const killed = sink.events.slice(before).filter((event) => event.type === "session_killed");
        expect(killed.length).toBe(1);
        expect(killed[0].target).toEqual({kind: "session", id: firstId});
        expect(killed[0].summary).toBe(`session_killed ${firstId}`);
        // 상한이 끝낸 세션은 사용자 요청이 아니므로 행위자는 system 이고, 원인이 된 로그인은 detail 에 남긴다.
        expect(killed[0].actor).toEqual({userId: "system"});
        expect(killed[0].detail).toEqual({userId: aliceId, reason: "per_user_limit", triggeredBy: aliceId});
    });

    it("세션이 없으면 다섯 경로 모두 401 이다", async () => {
        for(const [method, target] of [["GET", "/api/sessions"], ["DELETE", "/api/sessions/0000000000000000"],
            ["DELETE", `/api/users/${aliceId}/sessions`], ["GET", "/api/me/sessions"], ["POST", "/api/me/sessions/logout-others"]]) {
            expect({target, status: (await request(method, target)).status}).toEqual({target, status: 401});
        }
    });
});
