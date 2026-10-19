import fs from "fs/promises";
import path from "path";
import {fork, ChildProcess} from "child_process";
import bcrypt from "bcryptjs";
import YAML from "yaml";
import {IdentityMigration} from "../../src/server/rbac/IdentityMigration";
import {createTestRoot, cleanupTestRoot, writeWebFixture} from "../helpers/runtime";
import {startAdminBrowser} from "../helpers/adminBrowser";
import {httpRequest} from "../helpers/http";

const readIdentityPasswordHash = async (root: string, username: string): Promise<string> => {
    const raw = await fs.readFile(path.join(root, "config", "identity.yaml"), "utf8");
    const parsed = YAML.parse(raw) as {users: {username: string; passwordHash: string}[]};
    return parsed.users.find((u) => u.username === username)!.passwordHash;
};

const withLogin = async (check: (fixture: any) => Promise<void>, storedKey?: string) => {
    const root = await createTestRoot("browser-login-8");
    let app: Awaited<ReturnType<typeof startAdminBrowser>> | undefined;
    let child: ChildProcess | undefined;
    let origin = "";
    let output = "";
    const closeBackend = async () => {
        if(!child || child.exitCode !== null || child.signalCode !== null) return;
        const owned = child;
        await new Promise<void>((resolve, reject) => {
            let timedOut = false;
            const timer = setTimeout(() => { timedOut = true; owned.kill("SIGKILL"); }, 10_000);
            owned.once("exit", (code) => {
                clearTimeout(timer);
                code === 0 && !timedOut ? resolve() : reject(new Error(`Backend exited ${code} (timeout=${timedOut}): ${output}`));
            });
            if(owned.connected) owned.send("close");
            else owned.kill();
        });
    };
    const startBackend = async () => {
        output = "";
        child = fork(path.join(__dirname, "admin-backend-driver.ts"), [root.rootDir, "bootstrap"], {
            execArgv: ["-r", "ts-node/register/transpile-only"], stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
        child.stdout!.on("data", (data) => { output += data; });
        child.stderr!.on("data", (data) => { output += data; });
        const port = await new Promise<number>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Backend did not start: ${output}`)), 15_000);
            child!.once("message", (message: {port: number}) => { clearTimeout(timer); resolve(message.port); });
            child!.once("error", (error) => { clearTimeout(timer); reject(error); });
            child!.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Backend exited ${code}: ${output}`)); });
        });
        origin = `http://127.0.0.1:${port}`;
        await app!.page.goto(`${origin}/login.html`);
        await app!.page.waitForFunction(() => typeof (window as any).loginFixture !== "undefined");
    };
    try {
        if(storedKey) await fs.writeFile(path.join(root.rootDir, "config", ".key"), storedKey);
        app = await startAdminBrowser();
        await writeWebFixture(root.rootDir, "login.html", `<div id="login"></div><script type="module" src="${app.url}/test/login.ts"></script>`);
        await writeWebFixture(root.rootDir, "index.html", '<main id="signed-in">Signed in</main>');
        await startBackend();
        await check({app, root: root.rootDir, origin: () => origin,
            token: async () => (await fs.readFile(path.join(root.rootDir, "config", ".bootstrap-token"), "utf8")).trim(),
            async restart() {
                const oldPid = child!.pid;
                await closeBackend();
                await app!.page.context().clearCookies();
                await startBackend();
                expect(child!.pid).not.toBe(oldPid);
            },
            async submit() {
                const pending = app!.page.waitForResponse((response) => response.url() === `${origin}/api/login` && response.request().method() === "POST");
                await app!.page.getByRole("button", {name: "OK", exact: true}).click();
                return pending;
            },
        });
    } finally {
        try { await app?.close(); }
        finally {
            try { await closeBackend(); }
            finally { await cleanupTestRoot(root); }
        }
    }
};

test("bootstrap response completes first setup without obsolete discovery requests", async () => {
    await withLogin(async ({app, submit, token, origin}) => {
        const discoveryRequests: string[] = [];
        app.page.on("request", (request: any) => {
            if(new URL(request.url()).pathname === "/api/emptyKey") discoveryRequests.push(request.url());
        });
        await app.page.reload();
        await app.page.getByLabel("Password", {exact: true}).fill("plainword");
        const required = await submit();
        expect(required.status()).toBe(403);
        expect(await required.json()).toMatchObject({bootstrapRequired: true});
        const field = app.page.getByLabel("Bootstrap token", {exact: true});
        await field.waitFor({state: "visible", timeout: 3000});
        await field.fill(await token());
        expect((await submit()).status()).toBe(200);
        await app.page.waitForURL(`${origin()}/`);
        const removed = await httpRequest({port: Number(new URL(origin()).port), path: "/api/emptyKey"});
        expect(removed.statusCode).toBe(404);
        expect(JSON.parse(removed.body).emptyKey).toBeUndefined();
        expect(discoveryRequests).toEqual([]);
    });
}, 45_000);

test("controller sends the actual raw key and bootstrap token accepted by the server", async () => {
    await withLogin(async ({app, token, root}) => {
        const password = "  암호🙂abcd  ";
        const bootstrapToken = await token();
        const pending = app.page.waitForRequest((request: any) => request.url().endsWith("/api/login") && request.method() === "POST");
        const result = await app.page.evaluate((data: any) => (window as any).loginFixture.login("admin", data.password, data.bootstrapToken), {password, bootstrapToken});
        expect((await pending).postDataJSON()).toEqual({username: "admin", password, bootstrapToken});
        expect(result).toMatchObject({success: true, status: 200});
        // 부트스트랩 경로에는 .key가 만들어지지 않는다 — 진실 원천은 identity.yaml의 passwordHash.
        const passwordHash = await readIdentityPasswordHash(root, "admin");
        expect(await bcrypt.compare(password.trim(), passwordHash)).toBe(true);
    });
}, 45_000);

test("first-login UI requests the bootstrap token and accepts the existing server password policy", async () => {
    await withLogin(async ({app, token, submit, origin}) => {
        await app.page.getByLabel("Password", {exact: true}).fill("plainword");
        const missing = await submit();
        expect(missing.status()).toBe(403);
        await app.page.getByLabel("Bootstrap token", {exact: true}).waitFor({state: "visible", timeout: 3000});
        expect(await app.page.locator("#login-message").textContent()).toMatch(/bootstrap/i);
        await app.page.getByLabel("Bootstrap token", {exact: true}).fill(await token());
        expect((await submit()).status()).toBe(200);
        await app.page.waitForURL(`${origin()}/`);
        const session = await app.page.evaluate(async () => (await fetch("/api/validateSession")).json());
        expect(session.valid).toBe(true);
    });
}, 45_000);

test("invalid bootstrap token has a distinct actionable UI message", async () => {
    await withLogin(async ({app, submit}) => {
        await app.page.getByLabel("Password", {exact: true}).fill("plainword");
        await submit();
        const input = app.page.getByLabel("Bootstrap token", {exact: true});
        await input.waitFor({state: "visible", timeout: 3000});
        await input.fill("invalid-bootstrap-token");
        const response = await submit();
        expect(response.status()).toBe(403);
        expect(await response.json()).toMatchObject({bootstrapRequired: true, invalidBootstrapToken: true});
        await app.page.waitForFunction(() => /invalid.*bootstrap|bootstrap.*invalid/i.test(document.querySelector("#login-message")?.textContent ?? ""));
    });
}, 45_000);

test("weak-password response is preserved instead of hashing short input into a long value", async () => {
    await withLogin(async ({app, submit}) => {
        await app.page.getByLabel("Password", {exact: true}).fill("short");
        const response = await submit();
        expect(response.status()).toBe(400);
        expect(await response.json()).toMatchObject({bootstrapRequired: true, weakPassword: true});
        await app.page.waitForFunction(() => /minimum|weak/i.test(document.querySelector("#login-message")?.textContent ?? ""));
    });
}, 45_000);

test.each(["bcrypt", "legacy"])("existing %s account works after a real backend process restart", async (kind) => {
    const password = "  기존-암호🙂-password  ";
    const storedKey = kind === "bcrypt" ? await bcrypt.hash(password.trim(), 12)
        : IdentityMigration.hashLegacyPassword(password);
    await withLogin(async ({app, submit, restart, root, origin}) => {
        await app.page.getByLabel("Password", {exact: true}).fill(password);
        expect((await submit()).status()).toBe(200);
        await app.page.waitForURL(`${origin()}/`);
        // bcrypt·legacy 두 경로 모두 로그인 성공 뒤 identity.yaml의 해시는 bcrypt다(레거시는 재해시된다).
        const persisted = await readIdentityPasswordHash(root, "admin");
        expect(persisted).toMatch(/^\$2/);
        expect(await bcrypt.compare(password.trim(), persisted)).toBe(true);
        await restart();
        await app.page.getByLabel("Password", {exact: true}).fill(password);
        expect((await submit()).status()).toBe(200);
        await app.page.waitForURL(`${origin()}/`);
        expect(await readIdentityPasswordHash(root, "admin")).toBe(persisted);
        // 승격은 .key를 고치지 않는다 — 기동 전 storedKey 그대로 남아 있어야 한다.
        expect(await fs.readFile(path.join(root, "config", ".key"), "utf8")).toBe(storedKey);
    }, storedKey);
}, 60_000);

test("429 is shown without automatic login retries on an isolated server", async () => {
    await withLogin(async ({app, submit}) => {
        await app.page.evaluate(async () => {
            for(let attempt = 0; attempt < 5; attempt++) await (window as any).loginFixture.login("admin", "wrong-password");
        });
        let attempts = 0;
        app.page.on("request", (request: any) => { if(request.url().endsWith("/api/login") && request.method() === "POST") attempts++; });
        await app.page.getByLabel("Password", {exact: true}).fill("wrong-password");
        expect((await submit()).status()).toBe(429);
        await app.page.waitForFunction(() => /too many|later/i.test(document.querySelector("#login-message")?.textContent ?? ""), undefined, {timeout: 3000});
        await new Promise((resolve) => setTimeout(resolve, 1200));
        expect(attempts).toBe(1);
    }, await bcrypt.hash("correct-password", 12));
}, 60_000);
