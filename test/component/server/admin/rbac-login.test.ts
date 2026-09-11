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
