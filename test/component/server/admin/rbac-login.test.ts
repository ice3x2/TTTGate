import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import bcrypt from "bcryptjs";
import AdminServer from "../../../../src/server/admin/AdminServer";
import {IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {createTestRoot, applyTestRoot, cleanupTestRoot} from "../../../helpers/runtime";
import {httpRequest} from "../../../helpers/http";
import {AuditEvent, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";

jest.setTimeout(60_000);

type ApiResponse = {status: number; headers: any; body: any};
type Auth = {Cookie: string; "X-CSRF-Token": string};

type Fixture = {
    port: number;
    rootDir: string;
    request: (method: string, target: string, body?: object, headers?: Record<string, string>) => Promise<ApiResponse>;
    loginAs: (body: object) => Promise<ApiResponse & {auth?: Auth}>;
    api: AdminServer;
};

/** 조건이 참이 될 때까지 기다린다. 시간 안에 참이 되지 않으면 실패한다. */
const waitUntil = async (condition: () => boolean, timeoutMs: number, label: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while(!condition()) {
        if(Date.now() > deadline) throw new Error(`waitUntil timed out: ${label}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

/**
 * setup으로 config/ 디렉터리를 준비한 뒤 IdentityMigration.runAtStartup()을 돌리고,
 * 실제 AdminServer를 붙여 원시 HTTP 요청으로 로그인/로그아웃/세션 검증을 검증한다.
 * admin-routes.test.ts의 withRoutes 패턴을 따른다.
 */
const withServer = async (
    setup: (rootDir: string) => Promise<void>,
    check: (fixture: Fixture) => Promise<void>
): Promise<void> => {
    const root = await createTestRoot("rbac-login");
    let api: AdminServer | undefined;
    try {
        applyTestRoot(root.rootDir);
        await setup(root.rootDir);
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
            let parsedBody: any;
            try {
                parsedBody = JSON.parse(response.body);
            } catch {
                parsedBody = response.body;
            }
            return {status: response.statusCode, headers: response.headers, body: parsedBody};
        };

        const loginAs = async (body: object): Promise<ApiResponse & {auth?: Auth}> => {
            const response = await request("POST", "/api/login", body);
            if(response.status !== 200) {
                return response;
            }
            const cookies: string[] = response.headers["set-cookie"];
            const auth: Auth = {
                Cookie: cookies.map((value) => value.split(";")[0]).join("; "),
                "X-CSRF-Token": cookies.find((value) => value.startsWith("csrfToken="))!.split(";")[0].slice("csrfToken=".length)
            };
            return {...response, auth};
        };

        await check({port, rootDir: root.rootDir, request, loginAs, api});
    } finally {
        try { await api?.close(); } finally { await cleanupTestRoot(root); }
    }
};

/**
 * #265: 본문을 일부만 보내는 원시 로그인 요청. Content-Length 는 declared 로 알리고 sent 바이트만 쓴다.
 * socket 은 바로 돌려주고, response 는 응답이 다 오면 상태와 본문으로, 응답 없이 끝나거나 기한이 지나면 status 0 으로 풀린다.
 */
const partialLogin = (port: number, target: string, declared: number, sent: number, waitMs = 5000) => {
    const socket = net.connect({host: "127.0.0.1", port});
    const response = new Promise<{status: number; head: string; body: string}>((resolve) => {
        let raw = "";
        let settled = false;
        // 응답은 Content-Length 나 chunked 로 온다. 끝까지 받은 응답만 완료로 본다.
        const parsed = () => {
            const split = raw.indexOf("\r\n\r\n");
            const headers = split >= 0 ? raw.slice(0, split) : "";
            const head = /^HTTP\/1\.1 (\d{3})/.exec(headers), length = /content-length: (\d+)/i.exec(headers);
            const payload = split >= 0 ? raw.slice(split + 4) : "";
            if(!head) return {status: 0, head: headers, body: "", complete: false};
            if(length) return {status: Number(head[1]), head: headers, body: payload, complete: Buffer.byteLength(payload) >= Number(length[1])};
            if(!/transfer-encoding: chunked/i.test(headers) || !payload.endsWith("0\r\n\r\n")) return {status: 0, head: headers, body: "", complete: false};
            let body = "", rest = payload;
            for(let size = parseInt(rest, 16); size > 0; size = parseInt(rest, 16)) {
                const start = rest.indexOf("\r\n") + 2;
                body += rest.slice(start, start + size);
                rest = rest.slice(start + size + 2);
            }
            return {status: Number(head[1]), head: headers, body, complete: true};
        };
        const finish = () => {
            if(settled) return;
            settled = true; clearTimeout(timer);
            const {status, head, body, complete} = parsed();
            resolve({status: complete ? status : 0, head, body});
        };
        const timer = setTimeout(finish, waitMs);
        socket.on("error", () => undefined);
        socket.on("data", (chunk) => { raw += chunk.toString("utf8"); if(parsed().complete) finish(); });
        socket.on("close", finish);
    });
    socket.once("connect", () => {
        socket.write(`POST ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${declared}\r\n\r\n`);
        socket.write(Buffer.alloc(sent, 0x20));
    });
    return {socket, response};
};

const setupBcryptAccount = (password: string) => async (rootDir: string): Promise<void> => {
    await fs.writeFile(path.join(rootDir, "config", ".key"), await bcrypt.hash(password, 4), "utf-8");
};

const setupBootstrapRoot = async (): Promise<void> => {
    // .key도 identity.yaml도 없는 상태 그대로 둔다 — bootstrap-required 경로.
};

const setupLegacyFallback = (password: string) => async (rootDir: string): Promise<void> => {
    // 필수 시스템 그룹이 빠진 identity.yaml -> IdentityStore.load()가 validation 실패 -> legacy-fallback.
    await fs.writeFile(path.join(rootDir, "config", "identity.yaml"), "version: 1\nusers: []\ngroups: []\n", "utf-8");
    await fs.writeFile(path.join(rootDir, "config", ".key"), await bcrypt.hash(password, 4), "utf-8");
};

describe("rbac-login: session-based /api/login, /api/logout, /api/validateSession", () => {
    let bcryptCostBackup: number;

    beforeAll(() => {
        bcryptCostBackup = IdentityStore.bcryptCost;
        IdentityStore.bcryptCost = 4;
    });

    afterAll(() => {
        IdentityStore.bcryptCost = bcryptCostBackup;
    });

    it("logs in with username+password against a migrated legacy account", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs}) => {
            const response = await loginAs({username: "admin", password: "routes-password"});
            expect(response.status).toBe(200);
            const setCookie: string[] = response.headers["set-cookie"];
            expect(setCookie.some((c) => c.startsWith("sessionKey="))).toBe(true);
            expect(setCookie.some((c) => c.startsWith("csrfToken="))).toBe(true);
            expect(response.body).toMatchObject({
                success: true,
                user: {username: "admin", role: "superuser"},
                mustChangePassword: false
            });
        });
    });

    // #102 (U2-10) 이 별칭(key → password, username 기본 'admin')을 제거했다.
    it("rejects the removed {key} alias and a body without username", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs}) => {
            expect((await loginAs({key: "routes-password"})).status).toBe(401);
            expect((await loginAs({password: "routes-password"})).status).toBe(401);
            expect((await loginAs({username: "admin", key: "routes-password"})).status).toBe(401);
            const ok = await loginAs({username: "admin", password: "routes-password"});
            expect(ok.status).toBe(200);
            expect(ok.body).toMatchObject({success: true, user: {username: "admin"}});
        });
    });

    it("normalizes username case and rejects malformed usernames", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs}) => {
            const upper = await loginAs({username: "ADMIN", password: "routes-password"});
            expect(upper.status).toBe(200);

            const malformed = await loginAs({username: "no spaces", password: "routes-password"});
            expect(malformed.status).toBe(401);
        });
    });

    it("returns 401 with an identical body for a wrong password and for an unknown username", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs}) => {
            const wrongPassword = await loginAs({username: "admin", password: "totally-wrong"});
            const unknownUser = await loginAs({username: "nobody", password: "routes-password"});
            expect(wrongPassword.status).toBe(401);
            expect(unknownUser.status).toBe(401);
            expect(wrongPassword.body).toEqual(unknownUser.body);
        });
    });

    it("validates and invalidates the session via GET /api/validateSession and POST /api/logout", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs, request}) => {
            const login = await loginAs({username: "admin", password: "routes-password"});
            expect(login.status).toBe(200);
            const auth = login.auth!;

            const validSession = await request("GET", "/api/validateSession", {}, {Cookie: auth.Cookie});
            expect(validSession.status).toBe(200);
            expect(validSession.body).toMatchObject({valid: true, user: {username: "admin"}, mustChangePassword: false});

            const noCookie = await request("GET", "/api/validateSession");
            expect(noCookie.status).toBe(401);

            const logoutNoCsrf = await request("POST", "/api/logout", {}, {Cookie: auth.Cookie});
            expect(logoutNoCsrf.status).toBe(403);

            const logout = await request("POST", "/api/logout", {}, {Cookie: auth.Cookie, "x-csrf-token": auth["X-CSRF-Token"]});
            expect(logout.status).toBe(200);
            const logoutCookies: string[] = logout.headers["set-cookie"];
            expect(logoutCookies.filter((c) => /Max-Age=0/.test(c)).length).toBe(2);

            const afterLogout = await request("GET", "/api/validateSession", {}, {Cookie: auth.Cookie});
            expect(afterLogout.status).toBe(401);
        });
    });

    it("completes bootstrap with username/password/bootstrapToken and rejects invalid attempts", async () => {
        await withServer(setupBootstrapRoot, async ({loginAs, rootDir}) => {
            const bootstrapToken = (await fs.readFile(path.join(rootDir, "config", ".bootstrap-token"), "utf-8")).trim();

            const success = await loginAs({username: "root", password: "root-password-1", bootstrapToken});
            expect(success.status).toBe(200);
            expect(success.body).toMatchObject({user: {username: "root", role: "superuser"}});
        });
    });

    it("rejects a wrong bootstrap token with 403 invalidBootstrapToken", async () => {
        await withServer(setupBootstrapRoot, async ({loginAs}) => {
            const response = await loginAs({username: "root", password: "root-password-1", bootstrapToken: "wrong-token"});
            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({bootstrapRequired: true, invalidBootstrapToken: true});
        });
    });

    it("rejects a weak bootstrap password with 400 weakPassword", async () => {
        await withServer(setupBootstrapRoot, async ({loginAs, rootDir}) => {
            const bootstrapToken = (await fs.readFile(path.join(rootDir, "config", ".bootstrap-token"), "utf-8")).trim();
            const response = await loginAs({username: "root", password: "short", bootstrapToken});
            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({weakPassword: true});
        });
    });

    it("rejects a malformed bootstrap username with 403 invalidUsername", async () => {
        await withServer(setupBootstrapRoot, async ({loginAs, rootDir}) => {
            const bootstrapToken = (await fs.readFile(path.join(rootDir, "config", ".bootstrap-token"), "utf-8")).trim();
            const response = await loginAs({username: "no spaces allowed", password: "root-password-1", bootstrapToken});
            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({invalidUsername: true});
        });
    });

    it("rejects bootstrap without username with 403 invalidUsername", async () => {
        await withServer(setupBootstrapRoot, async ({loginAs, rootDir}) => {
            const bootstrapToken = (await fs.readFile(path.join(rootDir, "config", ".bootstrap-token"), "utf-8")).trim();
            const response = await loginAs({password: "root-password-1", bootstrapToken});
            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({bootstrapRequired: true, invalidUsername: true});
            const ok = await loginAs({username: "admin", password: "root-password-1", bootstrapToken});
            expect(ok.status).toBe(200);
            expect(ok.body).toMatchObject({user: {username: "admin"}});
        });
    });

    it("falls back to the legacy .key verification when identity.yaml is unreadable", async () => {
        await withServer(setupLegacyFallback("legacy-fallback-pw-1"), async ({loginAs}) => {
            const ok = await loginAs({username: "admin", password: "legacy-fallback-pw-1"});
            expect(ok.status).toBe(200);
            expect(ok.body).toMatchObject({user: {id: "legacy-admin"}});

            const wrong = await loginAs({username: "admin", password: "wrong-password"});
            expect(wrong.status).toBe(401);
        });
    });

    it("blocks the sixth failed attempt with 429, including malformed-username failures", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs}) => {
            for(let i = 0; i < 5; i++) {
                const response = await loginAs({username: "admin", password: "wrong-password"});
                expect(response.status).toBe(401);
            }
            const blocked = await loginAs({username: "no spaces", password: "x"});
            expect(blocked.status).toBe(429);
        });
    });

    it("counts malformed-username failures toward the same backoff bucket", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs}) => {
            for(let i = 0; i < 5; i++) {
                const response = await loginAs({username: "no spaces", password: "x"});
                expect(response.status).toBe(401);
            }
            const blocked = await loginAs({username: "admin", password: "routes-password"});
            expect(blocked.status).toBe(429);
        });
    });

    it("logs a disabled user out of future logins", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs}) => {
            const createResult = await IdentityStore.instance.createUser({
                username: "bob",
                password: "bob-password-1",
                role: "regular",
                mustChangePassword: false
            });
            expect(createResult.success).toBe(true);
            const bob = (createResult as {success: true; value: {id: string}}).value;

            const beforeDisable = await loginAs({username: "bob", password: "bob-password-1"});
            expect(beforeDisable.status).toBe(200);

            const updateResult = IdentityStore.instance.updateUser(bob.id, {status: "disabled"});
            expect(updateResult.success).toBe(true);

            const afterDisable = await loginAs({username: "bob", password: "bob-password-1"});
            expect(afterDisable.status).toBe(401);
        });
    });
});

describe("rbac-login: #96 권한 결정기 · 비밀번호 변경 게이트 · /api/me", () => {
    let bcryptCostBackup: number;

    beforeAll(() => {
        bcryptCostBackup = IdentityStore.bcryptCost;
        IdentityStore.bcryptCost = 4;
    });

    afterAll(() => {
        IdentityStore.bcryptCost = bcryptCostBackup;
    });

    const createRegularUser = async (username: string, password: string, mustChangePassword: boolean): Promise<{id: string}> => {
        const result = await IdentityStore.instance.createUser({username, password, role: "regular", mustChangePassword});
        expect(result.success).toBe(true);
        return (result as {success: true; value: {id: string}}).value;
    };

    it("mustChangePassword 사용자는 /api/me 와 세션 엔드포인트 외에 403 password_change_required 를 받는다", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs, request}) => {
            await createRegularUser("carol", "carol-temp-pw-1", true);

            const login = await loginAs({username: "carol", password: "carol-temp-pw-1"});
            expect(login.status).toBe(200);
            expect(login.body).toMatchObject({mustChangePassword: true});
            const auth = login.auth!;

            const tunnels = await request("GET", "/api/tunnelingOption", {}, {Cookie: auth.Cookie});
            expect(tunnels.status).toBe(403);
            expect(tunnels.body).toMatchObject({success: false, code: "password_change_required"});

            const me = await request("GET", "/api/me", {}, {Cookie: auth.Cookie});
            expect(me.status).toBe(200);

            const validateSession = await request("GET", "/api/validateSession", {}, {Cookie: auth.Cookie});
            expect(validateSession.status).toBe(200);

            const logout = await request("POST", "/api/logout", {}, {Cookie: auth.Cookie, "x-csrf-token": auth["X-CSRF-Token"]});
            expect(logout.status).toBe(200);
        });
    });

    // 이슈 본문의 목적 절은 "/api/me 와 /api/me/password 외에 아무것도 못 한다" 고 썼지만,
    // 같은 본문의 권한 표는 이 엔드포인트에 me:read 를 지정했고 게이트는 me:read 를 통과시킨다.
    // 더 구체적인 권한 표를 따른다: 임시 비밀번호 상태에서도 마이그레이션 배너는 닫을 수 있어야 한다.
    it("mustChangePassword 사용자도 마이그레이션 확인은 할 수 있다", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs, request}) => {
            await createRegularUser("ivan", "ivan-temp-pw-1", true);
            const login = await loginAs({username: "ivan", password: "ivan-temp-pw-1"});
            expect(login.status).toBe(200);
            expect(login.body).toMatchObject({mustChangePassword: true});
            const auth = login.auth!;

            const acknowledged = await request("POST", "/api/me/acknowledge-migration", {},
                {Cookie: auth.Cookie, "x-csrf-token": auth["X-CSRF-Token"]});
            expect(acknowledged.status).toBe(200);
            expect(acknowledged.body).toMatchObject({success: true});
        });
    });

    it("PUT /api/me/password 가 현재 비밀번호와 새 비밀번호를 검증하고 게이트를 해제한다", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs, request}) => {
            await createRegularUser("dave", "dave-temp-pw-1", true);
            const login = await loginAs({username: "dave", password: "dave-temp-pw-1"});
            expect(login.status).toBe(200);
            const auth = login.auth!;
            const headers = {Cookie: auth.Cookie, "x-csrf-token": auth["X-CSRF-Token"]};

            const wrongCurrent = await request("PUT", "/api/me/password",
                {currentPassword: "not-the-temp-pw", newPassword: "dave-new-password-1"}, headers);
            expect(wrongCurrent.status).toBe(422);
            expect(wrongCurrent.body).toMatchObject({success: false, code: "current_password_mismatch"});

            const shortNew = await request("PUT", "/api/me/password",
                {currentPassword: "dave-temp-pw-1", newPassword: "short"}, headers);
            expect(shortNew.status).toBe(422);
            expect(shortNew.body).toMatchObject({success: false, code: "password_too_short"});

            const changed = await request("PUT", "/api/me/password",
                {currentPassword: "dave-temp-pw-1", newPassword: "dave-new-password-1"}, headers);
            expect(changed.status).toBe(200);
            expect(changed.body).toMatchObject({success: true, mustChangePassword: false});

            const me = await request("GET", "/api/me", {}, {Cookie: auth.Cookie});
            expect(me.status).toBe(200);
            expect(me.body.user.mustChangePassword).toBe(false);

            const tunnels = await request("GET", "/api/tunnelingOption", {}, {Cookie: auth.Cookie});
            expect(tunnels.status).toBe(200);
        });
    });

    it("비밀번호 변경은 요청한 세션만 남기고 같은 사용자의 다른 세션을 끊는다", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs, request}) => {
            await createRegularUser("erin", "erin-password-1", false);

            const first = await loginAs({username: "erin", password: "erin-password-1"});
            const second = await loginAs({username: "erin", password: "erin-password-1"});
            expect(first.status).toBe(200);
            expect(second.status).toBe(200);
            const keeping = first.auth!;
            const dropped = second.auth!;

            const changed = await request("PUT", "/api/me/password",
                {currentPassword: "erin-password-1", newPassword: "erin-password-2"},
                {Cookie: keeping.Cookie, "x-csrf-token": keeping["X-CSRF-Token"]});
            expect(changed.status).toBe(200);

            const alive = await request("GET", "/api/me", {}, {Cookie: keeping.Cookie});
            expect(alive.status).toBe(200);

            const killed = await request("GET", "/api/me", {}, {Cookie: dropped.Cookie});
            expect(killed.status).toBe(401);
        });
    });

    it("승격된 admin 의 /api/me 는 마이그레이션 배너와 9개 섹션을 돌려주고 확인 후 배너가 꺼진다", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs, request}) => {
            const login = await loginAs({username: "admin", password: "routes-password"});
            expect(login.status).toBe(200);
            const auth = login.auth!;

            const me = await request("GET", "/api/me", {}, {Cookie: auth.Cookie});
            expect(me.status).toBe(200);
            expect(me.body.migrationBanner).toBe(true);
            expect(me.body.user).toMatchObject({username: "admin", role: "superuser", groupName: "Superusers"});
            expect(me.body.user.passwordHash).toBeUndefined();
            expect(me.body.group).toMatchObject({id: "system:superuser", name: "Superusers"});
            expect(me.body.sections).toEqual(["status", "tunnels", "server", "users", "groups", "security", "audit", "sessions", "me"]);

            const acknowledged = await request("POST", "/api/me/acknowledge-migration", {},
                {Cookie: auth.Cookie, "x-csrf-token": auth["X-CSRF-Token"]});
            expect(acknowledged.status).toBe(200);
            expect(acknowledged.body).toMatchObject({success: true});

            const afterAck = await request("GET", "/api/me", {}, {Cookie: auth.Cookie});
            expect(afterAck.body.migrationBanner).toBe(false);
        });
    });

    it("일반 유저는 슈퍼유저 전용 엔드포인트에서 403 forbidden 을 받고 없는 라우트는 404 다", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs, request}) => {
            await createRegularUser("frank", "frank-password-1", false);
            const login = await loginAs({username: "frank", password: "frank-password-1"});
            expect(login.status).toBe(200);
            const cookie = {Cookie: login.auth!.Cookie};

            const serverOption = await request("GET", "/api/serverOption", {}, cookie);
            expect(serverOption.status).toBe(403);
            expect(serverOption.body).toMatchObject({success: false, code: "forbidden"});

            const sysInfo = await request("GET", "/api/sysInfo", {}, cookie);
            expect(sysInfo.status).toBe(403);
            expect(sysInfo.body).toMatchObject({code: "forbidden"});

            const externalCert = await request("GET", "/api/externalCert/1", {}, cookie);
            expect(externalCert.status).toBe(403);
            expect(externalCert.body).toMatchObject({code: "forbidden"});

            // #98 이 /api/users 를 표에 더했으므로 이제 존재하는 슈퍼유저 전용 라우트다.
            const users = await request("GET", "/api/users", {}, cookie);
            expect(users.status).toBe(403);
            expect(users.body).toMatchObject({code: "forbidden"});

            // 표에 없는 경로는 권한 판정 이전에 404 다.
            const absent = await request("GET", "/api/absent", {}, cookie);
            expect(absent.status).toBe(404);
        });
    });

    it("사용자를 disabled 로 바꾸면 기존 세션의 /api/me 가 401 이다", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs, request}) => {
            const grace = await createRegularUser("grace", "grace-password-1", false);
            const login = await loginAs({username: "grace", password: "grace-password-1"});
            expect(login.status).toBe(200);
            const cookie = {Cookie: login.auth!.Cookie};

            expect((await request("GET", "/api/me", {}, cookie)).status).toBe(200);

            const disabled = IdentityStore.instance.updateUser(grace.id, {status: "disabled"});
            expect(disabled.success).toBe(true);

            expect((await request("GET", "/api/me", {}, cookie)).status).toBe(401);
        });
    });

    it("세션 없는 /api/me 는 401 이고 CSRF 헤더 없는 acknowledge-migration 은 403 이다", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs, request}) => {
            const noCookie = await request("GET", "/api/me");
            expect(noCookie.status).toBe(401);

            const login = await loginAs({username: "admin", password: "routes-password"});
            const noCsrf = await request("POST", "/api/me/acknowledge-migration", {}, {Cookie: login.auth!.Cookie});
            expect(noCsrf.status).toBe(403);
        });
    });

    it("legacy-fallback 서버의 /api/me 는 legacy-admin 이고 비밀번호 변경은 503 이다", async () => {
        await withServer(setupLegacyFallback("legacy-fallback-pw-1"), async ({loginAs, request}) => {
            const login = await loginAs({username: "admin", password: "legacy-fallback-pw-1"});
            expect(login.status).toBe(200);
            const auth = login.auth!;

            const me = await request("GET", "/api/me", {}, {Cookie: auth.Cookie});
            expect(me.status).toBe(200);
            expect(me.body.user.id).toBe("legacy-admin");
            expect(me.body.migrationBanner).toBe(false);

            const changed = await request("PUT", "/api/me/password",
                {currentPassword: "legacy-fallback-pw-1", newPassword: "legacy-new-password-1"},
                {Cookie: auth.Cookie, "x-csrf-token": auth["X-CSRF-Token"]});
            expect(changed.status).toBe(503);
            expect(changed.body).toMatchObject({success: false, code: "identity_store_unavailable"});
        });
    });

    // #251 REQ-1 / AC-1 — 한 IP 에서 동시에 몰린 로그인은 상한(5)만 bcrypt 까지 간다. 나머지는 바로 429 다.
    // verifyPassword 를 게이트에 묶어 다섯 건이 끝나지 않은 채로 둔다. 그래야 기존 차단(실패 5회)이 대신 429 를 주는 일이 없다.
    it("concurrent logins from one IP run verifyPassword at most five times and the rest get 429", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs}) => {
            const store = IdentityStore.instance;
            const original = store.verifyPassword.bind(store);
            let release!: () => void;
            const gate = new Promise<void>((resolve) => { release = resolve; });
            const verify = jest.spyOn(store, "verifyPassword").mockImplementation(async (username, password) => {
                await gate;
                return original(username, password);
            });
            const events: AuditEvent[] = [];
            AuditSinkRegistry.set({reserve: () => true, record: async (event) => { events.push(event); }});
            try {
                const limited: ApiResponse[] = [];
                const pending = Array.from({length: 50}, () => loginAs({username: "admin", password: "wrong-password"})
                    .then((response) => { if(response.status === 429) limited.push(response); return response; }));
                await waitUntil(() => limited.length === 45, 20_000, "45 requests limited");
                expect(verify).toHaveBeenCalledTimes(5);
                expect(limited.every((response) => response.body?.code === "login_concurrency_limit")).toBe(true);
                // 상한 429 는 차단이 아니라 reason 으로 감사한다(버킷당 1분 1건).
                await waitUntil(() => events.some((event) => event.type === "login_failure"), 5_000, "login_failure audit");
                const failures = events.filter((event) => event.type === "login_failure");
                expect(failures).toHaveLength(1);
                // #265: 상한 429 는 본문을 읽기 전에 보내므로 username 을 알 수 없다.
                expect(failures[0].detail).toEqual({username: "(unread)", reason: "concurrency_limit"});
                release();
                const responses = await Promise.all(pending);
                expect(responses.filter((response) => response.status === 401)).toHaveLength(5);
                expect(verify).toHaveBeenCalledTimes(5);
            } finally {
                release();
                verify.mockRestore();
                AuditSinkRegistry.reset();
            }
        });
    });

    // #251 REQ-1 — 2단계 로그인(/api/login/mfa)도 같은 버킷의 동시 처리 칸을 쓴다.
    // 실패 지연을 게이트에 묶어 다섯 건을 붙잡아 둔다. 실패 기록은 막아 버킷이 차단되지 않게 한다.
    // 그래야 여섯째 요청의 429 가 차단이 아니라 동시 처리 상한에서 온 것임을 code 로 가릴 수 있다.
    it("/api/login/mfa shares the per-bucket concurrency limit", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({request, api}) => {
            let release!: () => void;
            const gate = new Promise<void>((resolve) => { release = resolve; });
            const delay = jest.spyOn(api as any, "delayFailedLogin").mockImplementation(() => gate);
            const record = jest.spyOn(api as any, "recordLoginFailure").mockImplementation(() => undefined);
            try {
                const held = Array.from({length: 5}, () => request("POST", "/api/login/mfa", {mfaTicket: "nope", code: "123456"}));
                await waitUntil(() => delay.mock.calls.length === 5, 20_000, "five MFA failures held");
                const sixth = await request("POST", "/api/login/mfa", {mfaTicket: "nope", code: "123456"});
                expect(sixth.status).toBe(429);
                expect(sixth.body?.code).toBe("login_concurrency_limit");
                // 비밀번호 로그인도 같은 칸을 센다.
                const password = await request("POST", "/api/login", {username: "admin", password: "routes-password"});
                expect(password.status).toBe(429);
                expect(password.body?.code).toBe("login_concurrency_limit");
                release();
                expect((await Promise.all(held)).map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
            } finally {
                release();
                delay.mockRestore();
                record.mockRestore();
            }
        });
    });

    // #251 REQ-3 — 차단된 버킷은 칸이 차 있어도 두 경로 모두 차단 429(code 없음)를 받는다. 확인 순서가 같아야 한다.
    it("a blocked bucket gets the plain blocked 429 on both login routes even when the slots are full", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({request, api}) => {
            let release!: () => void;
            const gate = new Promise<void>((resolve) => { release = resolve; });
            const delay = jest.spyOn(api as any, "delayFailedLogin").mockImplementation(() => gate);
            try {
                // 실패 다섯 건이 기록되어 버킷이 차단되고, 지연에 묶여 칸 다섯 개를 붙잡는다.
                const held = Array.from({length: 5}, () => request("POST", "/api/login/mfa", {mfaTicket: "nope", code: "123456"}));
                await waitUntil(() => delay.mock.calls.length === 5, 20_000, "five MFA failures held");
                const events: AuditEvent[] = [];
                AuditSinkRegistry.set({reserve: () => true, record: async (event) => { events.push(event); }});
                for(const [target, body] of [["/api/login/mfa", {mfaTicket: "nope", code: "123456"}], ["/api/login", {username: "admin", password: "routes-password"}]] as const) {
                    const response = await request("POST", target, body);
                    expect({target, status: response.status, code: response.body?.code}).toEqual({target, status: 429, code: undefined});
                }
                // #265: 차단 429 는 본문을 읽기 전에 보내므로 username 을 알 수 없다. 차단 감사로 남긴다.
                await waitUntil(() => events.some((event) => event.type === "login_failure"), 5_000, "blocked login_failure audit");
                expect(events.filter((event) => event.type === "login_failure").map((event) => event.detail))
                    .toEqual([{username: "(unread)", blocked: true}]);
                release();
                await Promise.all(held);
            } finally {
                release();
                delay.mockRestore();
                AuditSinkRegistry.reset();
            }
        });
    });

    // #251 REQ-3 — 동시 처리 칸은 요청이 끝나면 돌아온다. 앞선 요청이 끝난 뒤의 로그인은 정상으로 처리한다.
    it("frees the concurrency slots after the requests finish", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs}) => {
            const first = await Promise.all(Array.from({length: 4}, () => loginAs({username: "admin", password: "wrong-password"})));
            expect(first.map((response) => response.status)).toEqual([401, 401, 401, 401]);
            const ok = await loginAs({username: "admin", password: "routes-password"});
            expect(ok.status).toBe(200);
            // 성공으로 실패 횟수가 지워졌으므로 다시 다섯 번 동시 처리가 가능하다.
            const again = await Promise.all(Array.from({length: 5}, () => loginAs({username: "admin", password: "wrong-password"})));
            expect(again.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
        });
    });

    // #265 AC-1 — 칸이 모두 차 있으면 1 MiB 본문을 다 보내기 전에 429 를 받는다. 본문을 읽지 않는다.
    it.each(["/api/login", "/api/login/mfa"])("%s answers 429 before reading the body when the slots are full (#265)", async (target) => {
        await withServer(setupBcryptAccount("routes-password"), async ({port, request, api}) => {
            let release!: () => void;
            const gate = new Promise<void>((resolve) => { release = resolve; });
            const delay = jest.spyOn(api as any, "delayFailedLogin").mockImplementation(() => gate);
            const record = jest.spyOn(api as any, "recordLoginFailure").mockImplementation(() => undefined);
            try {
                const held = Array.from({length: 5}, () => request("POST", "/api/login", {username: "admin", password: "wrong-password"}));
                await waitUntil(() => delay.mock.calls.length === 5, 20_000, "five failures held");
                const partial = partialLogin(port, target, 1024 * 1024, 1024);
                const limited = await partial.response;
                partial.socket.destroy();
                expect(limited.status).toBe(429);
                expect(JSON.parse(limited.body).code).toBe("login_concurrency_limit");
                // 읽지 않은 본문이 남은 연결은 다시 쓰지 않는다(#173 의 권한 거절과 같다).
                expect(limited.head).toMatch(/\r\nConnection: close/i);
                release();
                expect((await Promise.all(held)).map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
            } finally {
                release();
                delay.mockRestore();
                record.mockRestore();
            }
        });
    });

    // #265 AC-2 — 칸은 본문을 읽기 전에 잡고, 본문을 보내다 끊거나 크기를 넘기거나 정상으로 답해도 한 번만 돌려준다.
    // 다른 요청이 붙잡은 칸 넷은 그대로 남아야 한다(두 번 돌려주면 셋이 된다). 정상 응답은 finish 와 close 가 둘 다 온다.
    it.each([
        ["cut off mid-body", "abort"],
        ["over the body limit", "oversize"],
        ["answered with a successful login", "success"]
    ] as const)("returns the slot exactly once when the request is %s (#265)", async (_label, kind) => {
        await withServer(setupBcryptAccount("routes-password"), async ({port, request, api}) => {
            let release!: () => void;
            const gate = new Promise<void>((resolve) => { release = resolve; });
            const delay = jest.spyOn(api as any, "delayFailedLogin").mockImplementation(() => gate);
            const record = jest.spyOn(api as any, "recordLoginFailure").mockImplementation(() => undefined);
            const inFlight = () => [...((api as any)._loginInFlight as Map<string, number>).values()].reduce((a, b) => a + b, 0);
            try {
                const held = Array.from({length: 4}, () => request("POST", "/api/login", {username: "admin", password: "wrong-password"}));
                await waitUntil(() => delay.mock.calls.length === 4, 20_000, "four failures held");
                if(kind === "abort") {
                    const partial = partialLogin(port, "/api/login", 1024 * 1024, 1024, 20_000);
                    // 본문을 보내는 동안 이미 칸을 잡고 있다.
                    await waitUntil(() => inFlight() === 5, 20_000, "slot taken before the body is read");
                    partial.socket.destroy();
                    await partial.response;
                } else if(kind === "oversize") {
                    const partial = partialLogin(port, "/api/login", 16 * 1024 + 1, 16 * 1024 + 1, 20_000);
                    // 서버는 413 을 보낸 뒤 요청을 끊으므로 응답 대신 연결 종료(0)를 볼 수도 있다(audit-sink 테스트와 같다).
                    expect([413, 0]).toContain((await partial.response).status);
                    partial.socket.destroy();
                } else {
                    // 성공은 실패 지연을 거치지 않으므로 붙잡힌 넷과 상관없이 바로 끝난다.
                    expect((await request("POST", "/api/login", {username: "admin", password: "routes-password"})).status).toBe(200);
                }
                await waitUntil(() => inFlight() === 4, 20_000, "only the four held slots remain");
                await new Promise((resolve) => setTimeout(resolve, 200));
                expect(inFlight()).toBe(4);
                release();
                expect((await Promise.all(held)).map((response) => response.status)).toEqual([401, 401, 401, 401]);
                await waitUntil(() => inFlight() === 0, 20_000, "all slots returned");
            } finally {
                release();
                delay.mockRestore();
                record.mockRestore();
            }
        });
    });

    // #265 — 로그인 본문은 16 KiB 까지만 읽는다. 칸을 잡은 채 큰 본문을 들고 있지 않게 한다. 최대 비밀번호(1024자)는 들어간다.
    it.each(["/api/login", "/api/login/mfa"])("%s reads at most 16 KiB of body (#265)", async (target) => {
        await withServer(setupBcryptAccount("routes-password"), async ({port, request}) => {
            const partial = partialLogin(port, target, 16 * 1024 + 1, 16 * 1024 + 1, 20_000);
            // 서버는 413 을 보낸 뒤 요청을 끊으므로 응답 대신 연결 종료(0)를 볼 수도 있다.
            expect([413, 0]).toContain((await partial.response).status);
            partial.socket.destroy();
            const padded = {username: "admin", password: "routes-password", pad: "x".repeat(16 * 1024 - 200)};
            expect(Buffer.byteLength(JSON.stringify(padded))).toBeLessThanOrEqual(16 * 1024);
            if(target === "/api/login") expect((await request("POST", target, padded)).status).toBe(200);
            else expect((await request("POST", target, {mfaTicket: "nope", code: "123456", pad: "x".repeat(16 * 1024 - 200)})).status).toBe(401);
        });
    });

    // #265 — 차단 판정과 비밀번호 검증 사이에 본문 업로드가 끼므로, 그 사이 버킷이 차단되면 검증하지 않고 차단 429 를 보낸다.
    it("re-checks the block after reading the body and skips verifyPassword when the bucket was blocked meanwhile (#265)", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({request, api}) => {
            const verify = jest.spyOn(IdentityStore.instance, "verifyPassword");
            const blocked = jest.spyOn(api as any, "isLoginBlocked").mockReturnValueOnce(false).mockReturnValue(true);
            try {
                const response = await request("POST", "/api/login", {username: "admin", password: "routes-password"});
                expect({status: response.status, code: response.body?.code}).toEqual({status: 429, code: undefined});
                expect(verify).not.toHaveBeenCalled();
            } finally {
                verify.mockRestore();
                blocked.mockRestore();
            }
        });
    });

    // #251 REQ-2 / AC-2 — 너무 긴 비밀번호는 bcrypt 없이 실패로 처리하고 실패 횟수에 넣는다.
    it("rejects an over-long password with 401 without running verifyPassword and counts it as a failure", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs}) => {
            const verify = jest.spyOn(IdentityStore.instance, "verifyPassword");
            try {
                for(let i = 0; i < 5; i++) {
                    expect((await loginAs({username: "admin", password: "a".repeat(2000)})).status).toBe(401);
                }
                expect(verify).not.toHaveBeenCalled();
                expect((await loginAs({username: "admin", password: "routes-password"})).status).toBe(429);
            } finally {
                verify.mockRestore();
            }
        });
    });

    // #251 REQ-2 — 경계: 최대 길이(1024자) 비밀번호는 평소대로 검증한다.
    it("verifies a password of exactly the maximum length as usual", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs}) => {
            const verify = jest.spyOn(IdentityStore.instance, "verifyPassword");
            try {
                expect((await loginAs({username: "admin", password: "a".repeat(1024)})).status).toBe(401);
                expect(verify).toHaveBeenCalledTimes(1);
            } finally {
                verify.mockRestore();
            }
        });
    });
});
