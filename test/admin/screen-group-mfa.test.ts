import type {Page, Request} from "playwright";
import {startAdminApp, type AdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {RBAC_GROUP_FIELD_ID, RBAC_PASSWORDS, RBAC_USER_IDS} from "../helpers/rbacFixture";
import {generate} from "../../src/server/mfa/Totp";
import {base32Decode} from "../../src/server/mfa/Base32";

// #346 — 그룹별 2단계 인증 강제의 화면: 그룹 편집의 설정과 확인, 관리자 비밀번호 초기화의 체크박스,
// 강제 등록 화면(패스키 카드·안내), 마지막 수단 보호, 세션 중에 강제가 켜졌을 때의 이동.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const UI_WAIT_MS = 10_000;
const button = (page: Page, name: string) => page.getByRole("button", {name, exact: true});
const hashIs = (page: Page, expected: string) =>
    page.waitForFunction((value) => location.hash === value, expected, {timeout: UI_WAIT_MS});

const withApp = async (options: Parameters<typeof startAdminApp>[0], check: (app: AdminApp) => Promise<void>): Promise<void> => {
    const app = await startAdminApp(options);
    try {
        await check(app);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

const openGroup = async (page: Page, url: string, id: string) => {
    await page.goto(`${url}#/groups/${id}`);
    await page.waitForFunction(() => (document.querySelector("#group-name") as HTMLInputElement | null)?.value !== "", undefined, {timeout: UI_WAIT_MS});
};

const openUser = async (page: Page, url: string, id: string) => {
    await page.goto(`${url}#/users/${id}`);
    await page.waitForFunction(() => (document.querySelector("#user-username") as HTMLInputElement | null)?.value !== "", undefined, {timeout: UI_WAIT_MS});
};

const bodyOf = (request: Request) => JSON.parse(request.postData() ?? "{}");

test("#346 그룹 편집: 2단계 인증 필수를 켜면 2단계가 없는 인원을 알리고 확인한 뒤 저장한다. 끌 때는 묻지 않는다", () =>
    withApp({fixture: "rbac"}, async ({page, url}) => {
        await openGroup(page, url, RBAC_GROUP_FIELD_ID);
        const box = page.locator("#group-attr-mfa_required");
        expect(await box.isChecked()).toBe(false);
        await box.check();
        await button(page, "Save").click();
        const modal = page.locator(".group-mfa-confirm-modal");
        await modal.waitFor({state: "visible", timeout: UI_WAIT_MS});
        // Field team 의 alice·bob·dave 셋 다 2단계 수단이 없다.
        expect((await page.locator("#group-mfa-affected").textContent())?.trim())
            .toBe("3 of 3 members don't have two-factor authentication yet. They'll be asked to set it up before they can do anything else, including members who are signed in now.");
        const saved = page.waitForRequest((request) => request.method() === "PUT" && new URL(request.url()).pathname === `/api/groups/${RBAC_GROUP_FIELD_ID}`);
        await button(page, "Require and save").click();
        expect(bodyOf(await saved).attributes).toMatchObject({mfa_required: true});
        await page.getByText("Group saved.", {exact: true}).waitFor({state: "visible", timeout: UI_WAIT_MS});
        await page.reload();
        await page.waitForFunction(() => (document.querySelector("#group-attr-mfa_required") as HTMLInputElement | null)?.checked === true,
            undefined, {timeout: UI_WAIT_MS});

        // 사용자 편집 화면은 강제 대상임을 보인다.
        await openUser(page, url, RBAC_USER_IDS.alice);
        await page.locator("#user-mfa-required").waitFor({state: "visible", timeout: UI_WAIT_MS});
        await openUser(page, url, RBAC_USER_IDS.carol);
        await page.locator("#user-mfa-status").waitFor({state: "visible", timeout: UI_WAIT_MS});
        expect(await page.locator("#user-mfa-required").count()).toBe(0);

        // 끌 때는 확인 없이 저장한다.
        await openGroup(page, url, RBAC_GROUP_FIELD_ID);
        await page.locator("#group-attr-mfa_required").uncheck();
        const off = page.waitForRequest((request) => request.method() === "PUT" && new URL(request.url()).pathname === `/api/groups/${RBAC_GROUP_FIELD_ID}`);
        await button(page, "Save").click();
        expect(bodyOf(await off).attributes).toMatchObject({mfa_required: false});
        expect(await page.locator(".group-mfa-confirm-modal").count()).toBe(0);
    }));

test("#346 Superusers 그룹은 설정 대신 서버 설정을 안내한다", () => withApp({fixture: "rbac"}, async ({page, url}) => {
    await openGroup(page, url, "system:superuser");
    await page.locator("#group-mfa-superuser-note").waitFor({state: "visible", timeout: UI_WAIT_MS});
    expect(await page.locator("#group-attr-mfa_required").count()).toBe(0);
}));

test("#346 비밀번호 초기화 확인 창의 '2단계 인증과 패스키도 초기화' 는 기본으로 켜져 있고 값이 요청에 실린다", () =>
    withApp({fixture: "rbac-mfa"}, async ({page, url}) => {
        await openUser(page, url, RBAC_USER_IDS.alice);
        await button(page, "Reset password").click();
        const box = page.locator("#user-reset-second-factors");
        await box.waitFor({state: "visible", timeout: UI_WAIT_MS});
        expect(await box.isChecked()).toBe(true);
        // 켜져 있으면 삭제가 함께 일어난다는 것을 버튼으로 알린다.
        const reset = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/password-reset"));
        await button(page, "Reset and issue password").click();
        expect(bodyOf(await reset)).toMatchObject({resetSecondFactors: true});
        await page.locator("#temp-password-second-factors").waitFor({state: "visible", timeout: UI_WAIT_MS});
        await button(page, "Done").click();
        await page.locator("#user-mfa-status").filter({hasText: "Off"}).waitFor({state: "visible", timeout: UI_WAIT_MS});

        // 2단계 수단이 없는 사용자는 체크박스가 꺼진 채 비활성이고 false 를 보낸다.
        await openUser(page, url, RBAC_USER_IDS.bob);
        await button(page, "Reset password").click();
        await page.locator("#user-reset-second-factors").waitFor({state: "visible", timeout: UI_WAIT_MS});
        expect(await page.locator("#user-reset-second-factors").isDisabled()).toBe(true);
        const plain = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/password-reset"));
        await button(page, "Issue password").click();
        expect(bodyOf(await plain)).toMatchObject({resetSecondFactors: false});
        await page.locator("#temp-password-value").waitFor({state: "visible", timeout: UI_WAIT_MS});
        expect(await page.locator("#temp-password-second-factors").count()).toBe(0);
    }));

test("#346 강제 등록 화면: 패스키를 쓸 수 없는 주소에서는 인증 앱만 권하고, 등록 뒤에는 마지막 수단을 끄는 버튼이 이유와 함께 막힌다", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await app.serverOption({mfaRequiredForSuperusers: true});
        await page.locator("#login-password").waitFor({state: "visible", timeout: UI_WAIT_MS});
        await page.locator("#login-username").fill("admin");
        await page.locator("#login-password").fill(RBAC_PASSWORDS.admin);
        await button(page, "OK").click();
        await hashIs(page, "#/me");
        const banner = page.locator("#mfa-required-banner");
        await banner.waitFor({state: "visible", timeout: UI_WAIT_MS});
        expect((await banner.textContent())?.trim())
            .toBe("Your account requires two-factor authentication. Set up a passkey or an authenticator app to continue.");
        // 127.0.0.1 은 IP 주소라 패스키를 쓸 수 없다.
        await page.locator("#mfa-enroll-passkey-unavailable").waitFor({state: "visible", timeout: UI_WAIT_MS});
        expect(await page.locator("#me-passkeys").count()).toBe(0);

        await page.locator("#mfa-setup button").click();
        const modal = page.locator(".mfa-enroll-modal");
        await modal.waitFor({state: "visible", timeout: UI_WAIT_MS});
        const secret = (await page.locator("#mfa-secret").textContent())!.trim();
        await page.locator("#mfa-next button").click();
        await page.locator("#mfa-code").fill(generate(base32Decode(secret)!, Date.now()));
        await page.locator("#mfa-confirm button").click();
        await page.locator("#mfa-saved").check();
        await page.locator("#mfa-done button").click();
        await banner.waitFor({state: "detached", timeout: UI_WAIT_MS});
        expect(await page.locator("#mfa-disable button").isDisabled()).toBe(true);
        expect((await page.locator("#mfa-disable-blocked").textContent())?.trim())
            .toBe("Your account requires two-factor authentication, so this can't be turned off.");
    }));

test("#346 강제 등록 화면: 패스키를 쓸 수 있는 주소에서는 패스키 카드를 함께 보이고, 패스키를 더하면 내 정보를 다시 읽는다", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await app.serverOption({mfaRequiredForSuperusers: true});
        await page.addInitScript(() => {
            const buffer = (text: string) => new TextEncoder().encode(text).buffer;
            Object.defineProperty(navigator, "credentials", {configurable: true, value: {
                create: () => Promise.resolve({id: "Y3JlZA", rawId: buffer("cred"), type: "public-key", authenticatorAttachment: "platform",
                    response: {clientDataJSON: buffer("{}"), attestationObject: buffer("att"), getTransports: () => ["internal"]},
                    getClientExtensionResults: () => ({})}),
                get: () => new Promise(() => undefined)
            }});
        });
        const local = app.url.replace("127.0.0.1", "localhost");
        await page.goto(local);
        await page.locator("#login-password").waitFor({state: "visible", timeout: UI_WAIT_MS});
        await page.locator("#login-username").fill("admin");
        await page.locator("#login-password").fill(RBAC_PASSWORDS.admin);
        await button(page, "OK").click();
        await hashIs(page, "#/me");
        await page.locator("#me-passkeys").waitFor({state: "visible", timeout: UI_WAIT_MS});
        expect(await page.locator("#mfa-enroll-passkey-unavailable").count()).toBe(0);
        // 리뷰(결정 7): 패스키만 등록하면 그 뒤로는 비밀번호 로그인이 막힌다는 것을 미리 알린다.
        expect(await page.locator("#passkey-hint").textContent()).toContain("After this, you'll sign in with a passkey instead of a password.");

        const json = (body: object) => ({status: 200, contentType: "application/json", body: JSON.stringify(body)});
        await page.route("**/api/me/passkeys/options", (route) => route.fulfill(json({success: true, options: {
            rp: {id: "localhost", name: "TTTGate"}, user: {id: "dQ", name: "admin", displayName: "Admin"}, challenge: "Y2hhbGxlbmdl",
            pubKeyCredParams: [{type: "public-key", alg: -7}], timeout: 300_000, attestation: "none", excludeCredentials: [],
            authenticatorSelection: {residentKey: "required", userVerification: "required"}}})));
        await page.route("**/api/me/passkeys", (route) => route.request().method() === "POST"
            ? route.fulfill(json({success: true, passkey: {id: "p1", name: "Phone", rpId: "localhost", createdAt: 1, lastUsedAt: null, backedUp: false}}))
            : route.fulfill(json({success: true, passkeys: []})));
        let meReads = 0;
        page.on("request", (request) => { if(request.method() === "GET" && new URL(request.url()).pathname === "/api/me") meReads++; });
        await page.locator("#passkey-add button").click();
        await page.locator("#passkey-name").fill("Phone");
        await page.locator("#passkey-password").fill(RBAC_PASSWORDS.admin);
        await page.locator("#passkey-continue button").click();
        // 강제 대상이 인증 앱 없이 패스키만 더했으면 인증 앱을 백업으로 권한다(결정 7).
        await page.getByText("Passkey added. To sign in from an IP address, also set up an authenticator app.", {exact: true})
            .waitFor({state: "visible", timeout: UI_WAIT_MS});
        const deadline = Date.now() + UI_WAIT_MS;
        while(meReads === 0 && Date.now() < deadline) await page.waitForTimeout(100);
        expect(meReads).toBeGreaterThan(0);
    }));

test("#346 로그인 중에 강제가 켜지면 다음 요청이 막히는 순간 2단계 인증 등록 화면으로 옮긴다", () =>
    withApp({fixture: "rbac"}, async (app) => {
        const {page, url} = app;
        await page.goto(`${url}#/users`);
        await page.locator("li[data-user-id]").first().waitFor({state: "visible", timeout: UI_WAIT_MS});
        await app.serverOption({mfaRequiredForSuperusers: true});
        await page.evaluate(() => { location.hash = "#/groups"; });
        await hashIs(page, "#/me");
        await page.locator("#mfa-required-banner").waitFor({state: "visible", timeout: UI_WAIT_MS});
    }));

test("#346 인증 앱 교체: 비밀번호를 확인한 뒤 새 키로 등록하고, 확인을 마치면 바뀐다(결정 1)", () =>
    withApp({fixture: "rbac", login: {username: "alice", password: RBAC_PASSWORDS.alice}}, async ({page, url}) => {
        await page.goto(`${url}#/me`);
        await page.locator("#mfa-setup button").waitFor({state: "visible", timeout: UI_WAIT_MS});
        const enrollWith = async () => {
            const modal = page.locator(".mfa-enroll-modal");
            await modal.waitFor({state: "visible", timeout: UI_WAIT_MS});
            const value = (await page.locator("#mfa-secret").textContent())!.trim();
            await page.locator("#mfa-next button").click();
            await page.locator("#mfa-code").fill(generate(base32Decode(value)!, Date.now()));
            await page.locator("#mfa-confirm button").click();
            await page.locator("#mfa-saved").check();
            await page.locator("#mfa-done button").click();
            await modal.waitFor({state: "detached", timeout: UI_WAIT_MS});
            return value;
        };
        await page.locator("#mfa-setup button").click();
        const first = await enrollWith();
        await page.locator("#mfa-status").filter({hasText: "Enabled"}).waitFor({state: "visible", timeout: UI_WAIT_MS});

        await page.locator("#mfa-replace button").click();
        const ask = page.locator(".mfa-replace-modal");
        await ask.waitFor({state: "visible", timeout: UI_WAIT_MS});
        await page.locator("#mfa-replace-password").fill("wrong-password-1");
        await page.locator("#mfa-replace-continue button").click();
        await ask.getByText("The password is incorrect.", {exact: true}).waitFor({state: "visible", timeout: UI_WAIT_MS});
        await page.locator("#mfa-replace-password").fill(RBAC_PASSWORDS.alice);
        await page.locator("#mfa-replace-continue button").click();
        await ask.waitFor({state: "detached", timeout: UI_WAIT_MS});
        const second = await enrollWith();
        expect(second).not.toBe(first);
        await page.getByText("Authenticator app replaced.", {exact: true}).waitFor({state: "visible", timeout: UI_WAIT_MS});
        expect((await page.locator("#mfa-status").textContent())?.trim()).toBe("Enabled");
    }));
