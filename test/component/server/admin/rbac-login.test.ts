import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import AdminServer from "../../../../src/server/admin/AdminServer";
import {IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {createTestRoot, applyTestRoot, cleanupTestRoot} from "../../../helpers/runtime";
import {httpRequest} from "../../../helpers/http";

jest.setTimeout(60_000);

type ApiResponse = {status: number; headers: any; body: any};
type Auth = {Cookie: string; "X-CSRF-Token": string};

type Fixture = {
    port: number;
    rootDir: string;
    request: (method: string, target: string, body?: object, headers?: Record<string, string>) => Promise<ApiResponse>;
    loginAs: (body: object) => Promise<ApiResponse & {auth?: Auth}>;
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

        await check({port, rootDir: root.rootDir, request, loginAs});
    } finally {
        try { await api?.close(); } finally { await cleanupTestRoot(root); }
    }
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

    it("accepts the legacy {key} alias with no username (defaults to admin)", async () => {
        await withServer(setupBcryptAccount("routes-password"), async ({loginAs}) => {
            const response = await loginAs({key: "routes-password"});
            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({success: true, user: {username: "admin"}});
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

    it("completes bootstrap via the legacy {key} alias (username defaults to admin)", async () => {
        await withServer(setupBootstrapRoot, async ({loginAs, rootDir}) => {
            const bootstrapToken = (await fs.readFile(path.join(rootDir, "config", ".bootstrap-token"), "utf-8")).trim();
            const response = await loginAs({key: "root-password-1", bootstrapToken});
            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({user: {username: "admin"}});
        });
    });

    it("falls back to the legacy .key verification when identity.yaml is unreadable", async () => {
        await withServer(setupLegacyFallback("legacy-fallback-pw-1"), async ({loginAs}) => {
            const ok = await loginAs({password: "legacy-fallback-pw-1"});
            expect(ok.status).toBe(200);
            expect(ok.body).toMatchObject({user: {id: "legacy-admin"}});

            const wrong = await loginAs({password: "wrong-password"});
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
            const login = await loginAs({password: "legacy-fallback-pw-1"});
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
});
