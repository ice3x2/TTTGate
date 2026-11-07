import type {Page, Route} from "playwright";
import {startAdminApp, type AdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {RBAC_PASSWORDS} from "../helpers/rbacFixture";

// #336 REQ-13~15 — 패스키 카드와 로그인 버튼의 화면 논리(쓸 수 있는 환경 판정, 오류 문구).
// 개발 서버 프록시는 Origin 을 백엔드 주소로 바꾸므로 실제 등록·로그인은 passkey-e2e.test.ts 가 맡는다.
// 여기서는 패스키 API 와 브라우저의 navigator.credentials 를 바꿔 화면이 응답마다 무엇을 보이는지만 본다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const CONDITION = "Passkeys need a domain name with a trusted HTTPS certificate, or localhost.";
const UNSUPPORTED = `${CONDITION} This address can't use them.`;
const CHROMIUM_CERT_ERROR = "WebAuthn is not supported on sites with TLS certificate errors.";

const hashIs = (page: Page, expected: string) =>
    page.waitForFunction((value) => location.hash === value, expected, {timeout: 10_000});

/** 다음 navigator.credentials 호출의 결과를 정한다. 오류면 그 이름·메시지의 DOMException 을 던진다. */
type CredentialOutcome = {error: {name: string; message: string}} | {ok: true};

/** 페이지가 열리기 전에 navigator.credentials 를 바꾼다. 결과는 window.__passkeyOutcomes 에서 차례로 꺼낸다. */
const stubCredentials = async (page: Page): Promise<void> => {
    await page.addInitScript(() => {
        const w = window as any;
        w.__passkeyOutcomes = [];
        const buffer = (text: string) => new TextEncoder().encode(text).buffer;
        const fake = (kind: "create" | "get") => {
            const outcome = w.__passkeyOutcomes.shift() ?? {ok: true};
            if(outcome.error) return Promise.reject(new DOMException(outcome.error.message, outcome.error.name));
            const response: any = {clientDataJSON: buffer("{}")};
            if(kind === "create") {
                response.attestationObject = buffer("att");
                response.getTransports = () => ["internal"];
            } else {
                response.authenticatorData = buffer("auth");
                response.signature = buffer("sig");
                response.userHandle = buffer("u");
            }
            return Promise.resolve({id: "Y3JlZA", rawId: buffer("cred"), type: "public-key", response, authenticatorAttachment: "platform",
                getClientExtensionResults: () => ({})});
        };
        Object.defineProperty(navigator, "credentials", {configurable: true, value: {
            create: () => fake("create"), get: () => fake("get")
        }});
    });
};

const queueCredential = (page: Page, outcomes: CredentialOutcome[]) =>
    page.evaluate((value) => { (window as any).__passkeyOutcomes.push(...value); }, outcomes);

const json = (route: Route, status: number, body: object) =>
    route.fulfill({status, contentType: "application/json", body: JSON.stringify(body)});

const REGISTRATION_OPTIONS = {
    rp: {id: "localhost", name: "TTTGate"}, user: {id: "dQ", name: "alice", displayName: "Alice"}, challenge: "Y2hhbGxlbmdl",
    pubKeyCredParams: [{type: "public-key", alg: -7}], timeout: 300_000, attestation: "none", excludeCredentials: [],
    authenticatorSelection: {residentKey: "required", userVerification: "required"}
};
const LOGIN_OPTIONS = {rpId: "localhost", challenge: "Y2hhbGxlbmdl", timeout: 120_000, userVerification: "required", allowCredentials: []};

const withApp = async (options: Parameters<typeof startAdminApp>[0], check: (app: AdminApp) => Promise<void>): Promise<void> => {
    const app = await startAdminApp(options);
    try {
        await check(app);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

const localUrl = (app: AdminApp) => app.url.replace("127.0.0.1", "localhost");

const loginAs = async (page: Page, username: string, password: string) => {
    await page.locator("#login-password").waitFor({state: "visible", timeout: 30_000});
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await page.getByRole("button", {name: "OK", exact: true}).click();
    await page.waitForFunction(() => !document.querySelector("#login-password") && document.querySelector("header h1"), undefined, {timeout: 30_000});
};

test("IP 주소로 연 화면은 패스키를 쓸 수 없다고 안내하고, 등록 버튼을 끄며, 로그인 버튼을 보이지 않는다", () =>
    withApp({fixture: "rbac", login: {username: "alice", password: RBAC_PASSWORDS.alice}}, async (app) => {
        const {page} = app;
        await page.goto(`${app.url}#/me`);
        await hashIs(page, "#/me");
        await page.locator("#me-passkeys").waitFor({state: "visible", timeout: 10_000});
        expect(await page.locator("#passkey-hint").textContent()).toBe(UNSUPPORTED);
        expect(await page.locator("#passkey-add button").isDisabled()).toBe(true);
        await page.locator("#passkey-empty").filter({hasText: "No passkeys yet."}).waitFor({state: "visible", timeout: 10_000});

        await page.locator('[aria-label="Open menu"]').click();
        await page.locator("#nav-sign-out").click();
        await page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
        expect(await page.locator("#login-passkey").count()).toBe(0);
        expect(await page.locator("#login-passkey-hint").count()).toBe(0);
    }));

test("등록 창은 응답마다 정한 문구를 보이고, 성공하면 닫히며 목록을 다시 읽는다", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await stubCredentials(page);
        const registrations: Array<{status: number; body: object}> = [];
        let listed: object[] = [];
        await page.route("**/api/me/passkeys/options", (route) => json(route, 200, {success: true, options: REGISTRATION_OPTIONS}));
        await page.route("**/api/me/passkeys", (route) => route.request().method() === "GET"
            ? json(route, 200, {success: true, passkeys: listed})
            : json(route, registrations[0]?.status ?? 500, registrations.shift()?.body ?? {}));

        await page.goto(localUrl(app));
        await loginAs(page, "alice", RBAC_PASSWORDS.alice);
        await page.goto(`${localUrl(app)}#/me`);
        await page.locator("#me-passkeys").waitFor({state: "visible", timeout: 10_000});
        expect(await page.locator("#passkey-hint").textContent()).toBe(CONDITION);
        // 첫 목록을 읽는 동안에는 버튼이 잠시 꺼져 있다. 다 읽으면 켜진다.
        await page.waitForFunction(() => (document.querySelector("#passkey-add button") as HTMLButtonElement | null)?.disabled === false,
            undefined, {timeout: 10_000});

        await page.locator("#passkey-add button").click();
        // 기기 종류로 이름을 미리 채운다(헤드리스 Chromium 은 Linux).
        expect(await page.locator("#passkey-name").inputValue()).toBe("Linux");
        await page.locator("#passkey-password").fill(RBAC_PASSWORDS.alice);
        const error = page.locator("#passkey-error");
        const attempt = async (expected: string) => {
            await page.locator("#passkey-continue button").click();
            await error.filter({hasText: expected}).waitFor({state: "visible", timeout: 10_000});
        };

        await queueCredential(page, [{error: {name: "NotAllowedError", message: "The operation either timed out or was not allowed."}}]);
        await attempt("The passkey was not created.");
        await queueCredential(page, [{error: {name: "NotAllowedError", message: CHROMIUM_CERT_ERROR}}]);
        await attempt(UNSUPPORTED);
        await queueCredential(page, [{error: {name: "SecurityError", message: "The operation is insecure."}}]);
        await attempt(UNSUPPORTED);
        await queueCredential(page, [{error: {name: "InvalidStateError", message: "The authenticator was previously registered."}}]);
        await attempt("This device already has a passkey for this account.");

        const failures: Array<[number, string, string]> = [
            [409, "passkey_already_registered", "This device already has a passkey for this account."],
            [409, "passkey_limit", "You can register up to 20 passkeys."],
            [409, "passkey_registration_expired", "The setup expired. Try again."],
            [422, "passkey_name_invalid", "Enter a name of 1 to 64 characters."],
            [400, "passkey_invalid", "The passkey could not be verified. Try again."],
            [422, "passkey_origin_unsupported", UNSUPPORTED],
            [500, "internal", "Unable to connect to the server."],
        ];
        for(const [status, code, expected] of failures) {
            registrations.push({status, body: {success: false, code, message: "server text"}});
            await attempt(expected);
        }

        registrations.push({status: 200, body: {success: true, passkey: {id: "Y3JlZA", name: "Linux", rpId: "localhost", createdAt: Date.now(), lastUsedAt: null, backedUp: true}}});
        listed = [{id: "Y3JlZA", name: "Linux", rpId: "localhost", createdAt: Date.now(), lastUsedAt: null, backedUp: true}];
        await page.locator("#passkey-continue button").click();
        await page.locator(".passkey-add-modal").waitFor({state: "hidden", timeout: 10_000});
        await page.getByText("Passkey added.").waitFor({state: "visible", timeout: 10_000});
        const row = page.locator(".passkey-row").filter({hasText: "Linux"});
        await row.waitFor({state: "visible", timeout: 10_000});
        expect(await row.textContent()).toContain("synced");
        expect(await row.textContent()).toContain("never used");
    }));

test("등록 창의 비밀번호 오류는 세션을 끝내지 않고 문구로 보인다", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await stubCredentials(page);
        await page.goto(localUrl(app));
        await loginAs(page, "alice", RBAC_PASSWORDS.alice);
        // 실제 백엔드는 프록시가 바꾼 Origin(IP)을 422 로 거절하므로 옵션만 바꾼다. 비밀번호 확인은 그 앞에서 실제로 한다.
        await page.route("**/api/me/passkeys/options", (route) =>
            json(route, 401, {success: false, code: "password_incorrect", message: "The password is incorrect."}));
        await page.goto(`${localUrl(app)}#/me`);
        await page.locator("#passkey-add button").click();
        await page.locator("#passkey-password").fill("wrong-password");
        await page.locator("#passkey-continue button").click();
        await page.locator("#passkey-error").filter({hasText: "The password is incorrect."}).waitFor({state: "visible", timeout: 10_000});
        expect(await page.evaluate(() => location.hash)).toBe("#/me");
    }));

test("목록의 Remove 는 확인 창을 거쳐 지우고 목록을 다시 읽는다", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await stubCredentials(page);
        let listed: object[] = [{id: "a2V5", name: "Phone", rpId: "localhost", createdAt: Date.now() - 86_400_000, lastUsedAt: Date.now() - 60_000, backedUp: false}];
        const removed: string[] = [];
        await page.route("**/api/me/passkeys", (route) => json(route, 200, {success: true, passkeys: listed}));
        await page.route("**/api/me/passkeys/*", (route) => {
            removed.push(new URL(route.request().url()).pathname);
            listed = [];
            return json(route, 200, {success: true});
        });
        await page.goto(localUrl(app));
        await loginAs(page, "alice", RBAC_PASSWORDS.alice);
        await page.goto(`${localUrl(app)}#/me`);
        const row = page.locator(".passkey-row").filter({hasText: "Phone"});
        await row.waitFor({state: "visible", timeout: 10_000});
        expect(await row.textContent()).toContain("last used");
        expect(await row.textContent()).not.toContain("synced");
        await row.locator(".passkey-remove button").click();
        await page.locator("#passkey-remove-confirm button").click();
        await page.locator("#passkey-empty").waitFor({state: "visible", timeout: 10_000});
        expect(removed).toEqual(["/api/me/passkeys/a2V5"]);
    }));

test("로그인 화면의 패스키 버튼은 조건 안내와 함께 보이고, 응답마다 정한 문구를 보인다", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await stubCredentials(page);
        const verifies: Array<{status: number; body: object}> = [];
        const optionResponses: Array<{status: number; body: object}> = [];
        await page.route("**/api/login/passkey/options", (route) => {
            const next = optionResponses.shift() ?? {status: 200, body: {success: true, options: LOGIN_OPTIONS}};
            return json(route, next.status, next.body);
        });
        await page.route("**/api/login/passkey", (route) => {
            const next = verifies.shift() ?? {status: 500, body: {}};
            return json(route, next.status, next.body);
        });
        await page.goto(localUrl(app));
        await page.locator("#login-passkey").waitFor({state: "visible", timeout: 30_000});
        expect(await page.locator("#login-passkey-hint").textContent()).toBe(CONDITION);

        const message = page.locator("#login-message");
        const attempt = async (expected: string) => {
            await page.locator("#login-passkey button").click();
            await message.filter({hasText: expected}).waitFor({state: "visible", timeout: 10_000});
        };

        await queueCredential(page, [{error: {name: "NotAllowedError", message: "The operation either timed out or was not allowed."}}]);
        await attempt("Sign-in was canceled.");
        await queueCredential(page, [{error: {name: "NotAllowedError", message: CHROMIUM_CERT_ERROR}}]);
        await attempt(UNSUPPORTED);
        await queueCredential(page, [{error: {name: "SecurityError", message: "The operation is insecure."}}]);
        await attempt(UNSUPPORTED);

        verifies.push({status: 401, body: {success: false, code: "passkey_invalid", message: "The passkey was not accepted."}});
        await attempt("The passkey was not accepted.");
        verifies.push({status: 429, body: {success: false, message: "Too many login attempts"}});
        await attempt("Too many login attempts. Please try again later.");
        verifies.push({status: 503, body: {success: false, code: "passkey_busy", message: "busy"}});
        await attempt("The server is busy. Try again in a minute.");
        verifies.push({status: 503, body: {success: false, message: "Unable to complete sign-in. Try again."}});
        await attempt("Unable to connect to the server.");

        optionResponses.push({status: 503, body: {success: false, code: "passkey_unavailable", message: "x"}});
        await attempt("Sign in with your password first.");
        optionResponses.push({status: 422, body: {success: false, code: "passkey_origin_unsupported", message: "x"}});
        await attempt(UNSUPPORTED);
        optionResponses.push({status: 429, body: {success: false, message: "Too many login attempts"}});
        await attempt("Too many login attempts. Please try again later.");
    }));

test("부트스트랩이 필요하다는 응답을 받으면 패스키 버튼과 안내를 감춘다", () =>
    withApp({fixture: "bootstrap", login: false}, async (app) => {
        const {page} = app;
        await page.goto(localUrl(app));
        await page.locator("#login-passkey").waitFor({state: "visible", timeout: 30_000});
        await page.locator("#login-username").fill("admin");
        await page.locator("#login-password").fill("first-password-1234");
        await page.getByRole("button", {name: "OK", exact: true}).click();
        await page.locator("#bootstrap-token").waitFor({state: "visible", timeout: 10_000});
        expect(await page.locator("#login-passkey").count()).toBe(0);
        expect(await page.locator("#login-passkey-hint").count()).toBe(0);
    }));
