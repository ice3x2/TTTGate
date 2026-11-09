import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {spawnSync} from "child_process";
import {chromium, type Browser, type CDPSession, type Page} from "playwright";
import Environment from "../../src/Environment";
import {IdentityStore} from "../../src/server/rbac/IdentityStore";
import {ADMIN_PASSWORD, USER_PASSWORD, withMfaServer} from "../component/server/admin/mfaHarness";

// #336 — 패스키 끝에서 끝까지. 실제 AdminServer 가 빌드한 관리 화면을 http://localhost:<port> 로 서빙하고,
// Chromium 가상 인증기(CDP WebAuthn)로 등록 → 로그아웃 → 패스키 로그인 → 삭제, 관리자 초기화를 화면에서 한다.
// 개발 서버 프록시는 Origin 을 백엔드 주소(IP)로 바꾸므로 이 흐름은 백엔드가 직접 서빙해야만 성립한다.
jest.setTimeout(300_000);

const root = path.resolve(__dirname, "../..");
const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-passkey-e2e-"));

let browser: Browser | undefined;

beforeAll(() => {
    const build = spawnSync(process.execPath, [path.join(root, "admin/node_modules/vite/bin/vite.js"), "build", "--outDir", distDir, "--emptyOutDir"], {
        cwd: path.join(root, "admin"), encoding: "utf8", timeout: 120_000, env: {...process.env, NODE_ENV: "production"},
    });
    if(build.status !== 0) throw new Error(`admin build failed: ${build.stderr}`);
}, 150_000);

afterAll(async () => {
    await browser?.close();
    fs.rmSync(distDir, {recursive: true, force: true});
});

const button = (page: Page, name: string) => page.getByRole("button", {name, exact: true});

const openWithAuthenticator = async (url: string): Promise<{page: Page; cdp: CDPSession; errors: string[]}> => {
    browser ??= await chromium.launch();
    const page = await browser.newPage();
    // 다른 관리 화면 테스트와 같은 좁은 화면. 로그아웃 메뉴가 서랍 안에 있다.
    await page.setViewportSize({width: 400, height: 800});
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {
        protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true,
        isUserVerified: true, automaticPresenceSimulation: true
    }});
    await page.goto(url);
    return {page, cdp, errors};
};

const passwordLogin = async (page: Page, username: string, password: string) => {
    // #338: 이 기기에서 패스키를 쓴 뒤에는 비밀번호 칸이 접혀 있다.
    await page.locator("#login-password, #login-use-password").first().waitFor({state: "visible", timeout: 30_000});
    if(await page.locator("#login-use-password").count() > 0) await page.locator("#login-use-password").click();
    await page.locator("#login-password").waitFor({state: "visible", timeout: 30_000});
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await button(page, "OK").click();
    await page.waitForFunction(() => !document.querySelector("#login-password") && document.querySelector("header h1"), undefined, {timeout: 30_000});
};

const signOut = async (page: Page) => {
    await page.locator('[aria-label="Open menu"]').click();
    await page.locator("#nav-sign-out").click();
    await page.locator("#login-passkey").waitFor({state: "visible", timeout: 10_000});
};

test("가상 인증기로 등록하고, 패스키로 로그인하고, 지우고, 관리자가 초기화한다", () => withMfaServer(async (f) => {
    fs.cpSync(distDir, Environment.path.webDir, {recursive: true});
    const url = f.origin.replace("127.0.0.1", "localhost") + "/";
    const {page, errors} = await openWithAuthenticator(url);

    // 1. 비밀번호로 들어가 내 계정에서 패스키를 등록한다.
    await passwordLogin(page, "alice", USER_PASSWORD);
    await page.goto(url + "#/me");
    await page.locator("#me-passkeys").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#passkey-empty").textContent()).toBe("No passkeys yet.");
    await page.locator("#passkey-add button").click();
    await page.locator("#passkey-name").fill("Test laptop");
    await page.locator("#passkey-password").fill(USER_PASSWORD);
    await page.locator("#passkey-continue button").click();
    await page.locator(".passkey-row").filter({hasText: "Test laptop"}).waitFor({state: "visible", timeout: 15_000});
    expect(IdentityStore.instance.user(f.idOf("alice"))!.passkeys).toHaveLength(1);
    // #338: 이 기기에서 패스키를 등록했으므로 다음 로그인 화면은 패스키를 먼저 보인다.
    expect(await page.evaluate(() => localStorage.getItem("tttgate.passkeyPreferred"))).toBe("1");

    // 2. 로그아웃하고 패스키로 로그인한다. TOTP·비밀번호를 묻지 않는다.
    await signOut(page);
    expect(await page.locator("#login-password").count()).toBe(0);
    await page.locator("#login-passkey button").click();
    // #338: 로그아웃하면 해시가 이미 #/tunnels 다. 로그인 화면이 사라질 때까지 기다린다.
    await page.waitForFunction(() => !document.querySelector("#login-passkey") && document.querySelector("header h1")?.textContent === "Tunnels",
        undefined, {timeout: 15_000});
    expect(f.sink.events.filter((event) => event.type === "login_success").at(-1)?.detail).toMatchObject({method: "passkey"});

    // 3. 내 계정에서 지운다.
    await page.goto(url + "#/me");
    const row = page.locator(".passkey-row").filter({hasText: "Test laptop"});
    await row.waitFor({state: "visible", timeout: 10_000});
    await row.locator(".passkey-remove button").click();
    await page.locator("#passkey-remove-confirm button").click();
    await page.locator("#passkey-empty").waitFor({state: "visible", timeout: 10_000});
    expect(IdentityStore.instance.user(f.idOf("alice"))!.passkeys ?? []).toEqual([]);

    // 4. 다시 등록한 뒤, 관리자가 사용자 편집 화면에서 모두 지운다.
    await page.locator("#passkey-add button").click();
    await page.locator("#passkey-name").fill("Second");
    await page.locator("#passkey-password").fill(USER_PASSWORD);
    await page.locator("#passkey-continue button").click();
    await page.locator(".passkey-row").filter({hasText: "Second"}).waitFor({state: "visible", timeout: 15_000});
    await signOut(page);
    await passwordLogin(page, "admin", ADMIN_PASSWORD);
    await page.goto(url + `#/users/${f.idOf("alice")}`);
    await page.locator("#user-passkey-count").filter({hasText: "1 passkey"}).waitFor({state: "visible", timeout: 10_000});
    await page.locator("#user-reset-passkeys button").click();
    await page.locator("#confirm-reset-passkeys button").click();
    await page.locator("#user-passkey-count").filter({hasText: "0 passkeys"}).waitFor({state: "visible", timeout: 10_000});
    expect(IdentityStore.instance.user(f.idOf("alice"))!.passkeys).toBeUndefined();
    expect(errors).toEqual([]);
}));
