import type {Page} from "playwright";
import {startAdminApp, type AdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {RBAC_PASSWORDS} from "../helpers/rbacFixture";
import {generate} from "../../src/server/mfa/Totp";
import {base32Decode} from "../../src/server/mfa/Base32";

// U4-07 / #115 — 로그인 2단계(코드·복구 코드). 'rbac-mfa' 의 alice 만 MFA 가 켜져 있다. 로그인 화면에서 직접 입력한다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const button = (page: Page, name: string) => page.getByRole("button", {name, exact: true});

const hashIs = (page: Page, expected: string) =>
    page.waitForFunction((value) => location.hash === value, expected, {timeout: 10_000});

const withMfa = async (check: (app: AdminApp) => Promise<void>): Promise<void> => {
    const app = await startAdminApp({fixture: "rbac-mfa", login: false});
    try {
        await check(app);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

/** 비밀번호 단계를 마치고 코드 단계에 도착한다. */
const passwordStep = async (page: Page, username = "alice", password: string = RBAC_PASSWORDS.alice) => {
    await page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await button(page, "OK").click();
};

const toCodeStep = async (page: Page) => {
    await passwordStep(page);
    await page.locator("#login-mfa-code").waitFor({state: "visible", timeout: 10_000});
};

const currentCode = async (app: AdminApp, offset = 0): Promise<string> =>
    generate(base32Decode((await app.mfaSecret("alice"))!)!, Date.now() + offset);

const message = (page: Page) => page.locator("#login-message");

test("비밀번호 뒤 코드 단계가 나타나고, 틀린 코드는 거절되며, 맞는 코드로 새로고침 없이 들어간다", () => withMfa(async (app) => {
    const {page} = app;
    let loads = 0;
    page.on("load", () => { loads++; });
    await toCodeStep(page);
    expect(await page.locator("#login-password").count()).toBe(0);
    expect(await page.locator("#login-mfa-hint").textContent()).toBe("Enter the 6-digit code from your authenticator app.");

    const right = await currentCode(app);
    await page.locator("#login-mfa-code").fill(right === "000000" ? "111111" : "000000");
    await page.locator("#login-mfa-submit button").click();
    await message(page).filter({hasText: "The code is incorrect."}).waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#login-mfa-code").isVisible()).toBe(true);

    await page.locator("#login-mfa-code").fill(await currentCode(app));
    await page.locator("#login-mfa-submit button").click();
    await hashIs(page, "#/tunnels");
    expect(loads).toBe(0);
}));

test("복구 코드로 들어갈 수 있고, 같은 복구 코드는 두 번 쓸 수 없다", () => withMfa(async (app) => {
    const {page} = app;
    const [first] = await app.mfaRecoveryCodes("alice");
    await toCodeStep(page);
    await page.locator("#login-use-recovery").click();
    await page.locator("#login-recovery-code").waitFor({state: "visible"});
    expect(await page.locator("#login-mfa-code").count()).toBe(0);
    expect(await page.locator("#login-mfa-hint").textContent()).toBe("Enter one of your recovery codes.");
    await page.locator("#login-recovery-code").fill(first);
    await page.locator("#login-mfa-submit button").click();
    await hashIs(page, "#/tunnels");

    await page.locator('[aria-label="Open menu"]').click();
    await page.locator("#nav-sign-out").click();
    await toCodeStep(page);
    await page.locator("#login-use-recovery").click();
    await page.locator("#login-recovery-code").fill(first);
    await page.locator("#login-mfa-submit button").click();
    await message(page).filter({hasText: "The code is incorrect."}).waitFor({state: "visible", timeout: 10_000});
}));

test("복구 코드 입력에서 인증 앱 코드 입력으로 되돌아갈 수 있다", () => withMfa(async ({page}) => {
    await toCodeStep(page);
    await page.locator("#login-use-recovery").click();
    await page.locator("#login-use-code").click();
    await page.locator("#login-mfa-code").waitFor({state: "visible"});
    expect(await page.locator("#login-recovery-code").count()).toBe(0);
}));

test("티켓이 만료되면 비밀번호 단계로 돌아가고 비밀번호 칸은 비어 있다", () => withMfa(async (app) => {
    const {page} = app;
    await toCodeStep(page);
    const offset = await app.advanceClock(121_000);
    await page.locator("#login-mfa-code").fill(await currentCode(app, offset));
    await page.locator("#login-mfa-submit button").click();
    await message(page).filter({hasText: "The sign-in expired. Start again."}).waitFor({state: "visible", timeout: 10_000});
    await page.locator("#login-password").waitFor({state: "visible"});
    expect(await page.locator("#login-password").inputValue()).toBe("");
}));

test("Start over 는 비밀번호 단계로 돌아간다", () => withMfa(async ({page}) => {
    await toCodeStep(page);
    await page.locator("#login-mfa-back").click();
    await page.locator("#login-password").waitFor({state: "visible"});
    expect(await page.locator("#login-mfa-code").count()).toBe(0);
}));

test("빈 코드는 서버에 묻지 않고 Enter the code. 를 보인다", () => withMfa(async ({page}) => {
    await toCodeStep(page);
    let mfaRequests = 0;
    page.on("request", (request) => { if(new URL(request.url()).pathname === "/api/login/mfa") mfaRequests++; });
    await page.locator("#login-mfa-submit button").click();
    await message(page).filter({hasText: "Enter the code."}).waitFor({state: "visible"});
    expect(mfaRequests).toBe(0);
}));

test("코드 입력은 숫자만 남기고 6자리에서 자른다", () => withMfa(async ({page}) => {
    await toCodeStep(page);
    await page.locator("#login-mfa-code").pressSequentially("12a34b567");
    expect(await page.locator("#login-mfa-code").inputValue()).toBe("123456");
}));

test("MFA 가 없는 admin 은 2단계 없이 바로 들어간다", () => withMfa(async ({page}) => {
    const login = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/login", {timeout: 10_000});
    await passwordStep(page, "admin", RBAC_PASSWORDS.admin);
    expect((await (await login).json()).mfaRequired).toBeUndefined();
    await hashIs(page, "#/status");
    expect(await page.locator("#login-mfa-code").count()).toBe(0);
}));

test("429·422 응답은 각각 정해진 문구를 보인다", () => withMfa(async ({page}) => {
    await toCodeStep(page);
    let status = 429;
    await page.route("**/api/login/mfa", (route) => route.fulfill({status, contentType: "application/json",
        body: JSON.stringify({success: false, status, message: "server text"})}));
    await page.locator("#login-mfa-code").fill("123456");
    await page.locator("#login-mfa-submit button").click();
    await message(page).filter({hasText: "Too many attempts. Try again later."}).waitFor({state: "visible", timeout: 10_000});
    status = 422;
    await page.locator("#login-mfa-submit button").click();
    await message(page).filter({hasText: "Enter the code."}).waitFor({state: "visible", timeout: 10_000});
}));

test("MFA 로 들어간 사용자 이름은 다음 로그인 화면에 채워진다", () => withMfa(async (app) => {
    const {page} = app;
    await toCodeStep(page);
    await page.locator("#login-mfa-code").fill(await currentCode(app));
    await page.locator("#login-mfa-submit button").click();
    await hashIs(page, "#/tunnels");
    await page.locator('[aria-label="Open menu"]').click();
    await page.locator("#nav-sign-out").click();
    await page.locator("#login-username").waitFor({state: "visible", timeout: 10_000});
    // 로그아웃은 화면 상태만 바꾸므로, 새로 읽어 localStorage 에서 채워지는지 본다.
    await page.reload();
    await page.locator("#login-username").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#login-username").inputValue()).toBe("alice");
}));

test("요청 중에는 Start over 를 누를 수 없다", () => withMfa(async (app) => {
    const {page} = app;
    await toCodeStep(page);
    await page.route("**/api/login/mfa", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        await route.continue();
    });
    await page.locator("#login-mfa-code").fill(await currentCode(app));
    await page.locator("#login-mfa-submit button").click();
    expect(await page.locator("#login-mfa-back").isDisabled()).toBe(true);
    await hashIs(page, "#/tunnels");
}));
