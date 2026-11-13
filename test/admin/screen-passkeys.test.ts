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
type CredentialOutcome = {error: {name: string; message: string}} | {ok: true} | {hang: true};

/**
 * 페이지가 열리기 전에 navigator.credentials 를 바꾼다. 결과는 window.__passkeyOutcomes 에서 차례로 꺼낸다.
 * initial 은 페이지를 열 때마다 큐에 먼저 넣는다(#345: 화면이 열리자마자 나가는 자동 요청의 결과).
 * 호출은 window.__passkeyCalls 에 {mediation, aborted} 로 남긴다. 조건부 UI(mediation: conditional) 요청은
 * 사용자가 자동 완성에서 고르기 전까지 끝나지 않으므로, 결과를 꺼내지 않고 취소될 때까지 기다린다.
 */
const stubCredentials = async (page: Page, initial: CredentialOutcome[] = []): Promise<void> => {
    await page.addInitScript((first) => {
        const w = window as any;
        w.__passkeyOutcomes = [...first];
        w.__passkeyCalls = [];
        const buffer = (text: string) => new TextEncoder().encode(text).buffer;
        // #345: 실행 브라우저와 관계없이 조건부 UI 를 지원하는 것으로 둔다.
        Object.defineProperty(PublicKeyCredential, "isConditionalMediationAvailable", {configurable: true, value: () => Promise.resolve(true)});
        const credential = (kind: "create" | "get") => {
            const response: any = {clientDataJSON: buffer("{}")};
            if(kind === "create") {
                response.attestationObject = buffer("att");
                response.getTransports = () => ["internal"];
            } else {
                response.authenticatorData = buffer("auth");
                response.signature = buffer("sig");
                response.userHandle = buffer("u");
            }
            return {id: "Y3JlZA", rawId: buffer("cred"), type: "public-key", response, authenticatorAttachment: "platform",
                getClientExtensionResults: () => ({})};
        };
        /** 취소 신호를 받을 때까지 끝나지 않는 요청. 조건부 요청은 window.__pickAutofill() 로 사용자가 고른 것처럼 끝낼 수 있다. */
        const pending = (call: {aborted: boolean}, signal?: AbortSignal, onPick?: (resolve: (value: unknown) => void) => void) =>
            new Promise((resolve, reject) => {
                signal?.addEventListener("abort", () => { call.aborted = true; reject(new DOMException("aborted", "AbortError")); });
                onPick?.(resolve);
            });
        const fake = (kind: "create" | "get", options?: {mediation?: string; signal?: AbortSignal}) => {
            const call = {kind, mediation: options?.mediation ?? "", aborted: false};
            w.__passkeyCalls.push(call);
            if(options?.mediation === "conditional") {
                return pending(call, options.signal, (resolve) => { w.__pickAutofill = () => resolve(credential("get")); });
            }
            const outcome = w.__passkeyOutcomes.shift() ?? {ok: true};
            if(outcome.hang) return pending(call, options?.signal);
            if(outcome.error) return Promise.reject(new DOMException(outcome.error.message, outcome.error.name));
            return Promise.resolve(credential(kind));
        };
        Object.defineProperty(navigator, "credentials", {configurable: true, value: {
            create: (options: {signal?: AbortSignal}) => fake("create", options), get: (options: {mediation?: string; signal?: AbortSignal}) => fake("get", options)
        }});
    }, initial);
};

const passkeyCalls = (page: Page) => page.evaluate(() => (window as any).__passkeyCalls as Array<{kind: string; mediation: string; aborted: boolean}>);

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
        // 기기 종류로 이름을 미리 채운다. 테스트 브라우저는 이 테스트를 돌리는 운영체제의 이름을 알린다(CI 는 Linux).
        const expectedDevice = process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "Mac" : "Linux";
        expect(await page.locator("#passkey-name").inputValue()).toBe(expectedDevice);
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
            // 이슈 349: 로그인과 등록의 passkey_invalid 문구를 하나로 합쳤다.
            [400, "passkey_invalid", "The passkey was not accepted."],
            [422, "passkey_origin_unsupported", UNSUPPORTED],
            // 이슈 349 AC-4: 번역 맵에 없는 code 는 서버 문구를 그대로 보인다.
            [500, "internal", "server text"],
        ];
        for(const [status, code, expected] of failures) {
            // 이슈 349 FR-7: 문구에 들어가는 값(패스키 한도)은 별도 필드로 온다.
            registrations.push({status, body: {success: false, code, message: "server text", limit: 20}});
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
        // 이슈 349 AC-4: 번역 맵에 없는 code 는 서버 문구를 그대로 보인다.
        verifies.push({status: 503, body: {success: false, code: "sign_in_unavailable", message: "Unable to complete sign-in. Try again."}});
        await attempt("Unable to complete sign-in. Try again.");

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

// #338 REQ-3: 이 기기에서 패스키를 쓴 적이 있으면 로그인 화면은 패스키 버튼을 먼저 보이고 비밀번호 입력란은 접어 둔다.
test("패스키 우선 표시가 있는 기기는 패스키 버튼과 Use password 만 보이고, 실패하거나 Use password 를 누르면 비밀번호 칸을 편다", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        // #345: 화면이 열리면 자동 요청이 먼저 나간다. 그 결과를 매번 취소로 정한다.
        await stubCredentials(page, [{error: {name: "NotAllowedError", message: "The operation either timed out or was not allowed."}}]);
        await page.addInitScript(() => { localStorage.setItem("tttgate.passkeyPreferred", "1"); });
        await page.route("**/api/login/passkey/options", (route) => json(route, 200, {success: true, options: LOGIN_OPTIONS}));
        await page.goto(localUrl(app));
        await page.locator("#login-passkey").waitFor({state: "visible", timeout: 30_000});
        await page.waitForFunction(() => (window as any).__passkeyCalls.length === 1, undefined, {timeout: 10_000});
        expect(await page.locator("#login-password").count()).toBe(0);
        expect(await page.locator("#login-passkey-hint").textContent()).toBe(CONDITION);

        await page.locator("#login-use-password").click();
        await page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
        expect(await page.evaluate(() => document.activeElement?.id)).toBe("login-username");

        await page.reload();
        await page.locator("#login-passkey").waitFor({state: "visible", timeout: 30_000});
        await page.waitForFunction(() => (window as any).__passkeyCalls.length === 1, undefined, {timeout: 10_000});
        await queueCredential(page, [{error: {name: "NotAllowedError", message: "The operation either timed out or was not allowed."}}]);
        await page.locator("#login-passkey button").click();
        await page.locator("#login-message").filter({hasText: "Sign-in was canceled."}).waitFor({state: "visible", timeout: 10_000});
        await page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
    }));

test("패스키 우선 표시가 없으면 지금처럼 비밀번호 칸을 먼저 보이고 패스키 버튼을 그 아래에 둔다", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await page.goto(localUrl(app));
        await page.locator("#login-password").waitFor({state: "visible", timeout: 30_000});
        await page.locator("#login-passkey").waitFor({state: "visible", timeout: 10_000});
        expect(await page.locator("#login-use-password").count()).toBe(0);
    }));

// ── #345 패스키를 쓴 기기에서는 로그인 화면을 열자마자 패스키 창을 띄운다 ─────────────────────

const NOT_ALLOWED: CredentialOutcome = {error: {name: "NotAllowedError", message: "The operation either timed out or was not allowed."}};
const preferPasskey = (page: Page) => page.addInitScript(() => { localStorage.setItem("tttgate.passkeyPreferred", "1"); });
const countRequests = (page: Page, pathname: string) => {
    const counter = {count: 0};
    page.on("request", (request) => { if(request.method() === "POST" && new URL(request.url()).pathname === pathname) counter.count++; });
    return counter;
};
const nonConditionalGets = async (page: Page) => (await passkeyCalls(page)).filter((call) => call.kind === "get" && call.mediation !== "conditional");

test("#345 패스키를 쓴 기기는 화면을 열자마자 패스키 요청을 한 번 보내고, 취소하면 문구 없이 버튼 화면에 머문다 (AC-1, AC-2)", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await stubCredentials(page, [NOT_ALLOWED]);
        await preferPasskey(page);
        const options = countRequests(page, "/api/login/passkey/options");
        await page.route("**/api/login/passkey/options", (route) => json(route, 200, {success: true, options: LOGIN_OPTIONS}));
        await page.goto(localUrl(app));
        await page.waitForFunction(() => (window as any).__passkeyCalls.length >= 1, undefined, {timeout: 30_000});
        await page.waitForTimeout(500);
        expect(options.count).toBe(1);
        expect((await nonConditionalGets(page)).length).toBe(1);
        expect((await page.locator("#login-message").textContent())?.trim()).toBe("");
        expect(await page.locator("#login-password").count()).toBe(0);
        expect(await page.locator("#login-passkey button").isVisible()).toBe(true);
    }));

test("#345 자동 요청을 서버가 passkey_invalid 로 거부하면 문구와 비밀번호 칸을 보이고, 이 기기의 패스키 우선 표시를 지운다 (AC-2a)", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await stubCredentials(page);
        await page.goto(localUrl(app));
        await page.evaluate(() => { localStorage.setItem("tttgate.passkeyPreferred", "1"); });
        await page.route("**/api/login/passkey/options", (route) => json(route, 200, {success: true, options: LOGIN_OPTIONS}));
        await page.route("**/api/login/passkey", (route) => json(route, 401, {success: false, code: "passkey_invalid", message: "Passkey sign-in failed."}));
        await page.reload();
        await page.locator("#login-message").filter({hasText: "The passkey was not accepted."}).waitFor({state: "visible", timeout: 30_000});
        await page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
        expect(await page.evaluate(() => localStorage.getItem("tttgate.passkeyPreferred"))).toBeNull();
        await page.reload();
        await page.locator("#login-password").waitFor({state: "visible", timeout: 30_000});
        await page.waitForTimeout(500);
        expect((await nonConditionalGets(page)).length).toBe(0);
    }));

test("#345 로그아웃 직후의 로그인 화면은 자동 요청을 보내지 않고, 새로 고침하면 다시 보낸다 (AC-3)", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await stubCredentials(page, [NOT_ALLOWED]);
        await page.goto(localUrl(app));
        await page.route("**/api/login/passkey/options", (route) => json(route, 200, {success: true, options: LOGIN_OPTIONS}));
        await loginAs(page, "alice", RBAC_PASSWORDS.alice);
        await page.evaluate(() => { localStorage.setItem("tttgate.passkeyPreferred", "1"); (window as any).__passkeyCalls.length = 0; });
        // 좁은 화면에서는 Sign out 이 서랍 안에 있다.
        await page.locator('[aria-label="Open menu"]').click();
        await page.locator("#nav-sign-out").click();
        await page.locator("#login-passkey").waitFor({state: "visible", timeout: 30_000});
        await page.waitForTimeout(500);
        expect((await nonConditionalGets(page)).length).toBe(0);
        await page.reload();
        await page.waitForFunction(() => (window as any).__passkeyCalls.some((call: {mediation: string}) => call.mediation !== "conditional"), undefined, {timeout: 30_000});
    }));

test("#345 패스키 우선 표시가 없거나 IP 주소로 열면 자동 요청이 없다 (AC-4)", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await stubCredentials(page);
        await page.route("**/api/login/passkey/options", (route) => json(route, 200, {success: true, options: LOGIN_OPTIONS}));
        await page.goto(localUrl(app));
        await page.locator("#login-password").waitFor({state: "visible", timeout: 30_000});
        await page.waitForTimeout(500);
        expect((await nonConditionalGets(page)).length).toBe(0);
        await page.goto(app.url);
        await page.evaluate(() => { localStorage.setItem("tttgate.passkeyPreferred", "1"); });
        await page.reload();
        await page.locator("#login-password").waitFor({state: "visible", timeout: 30_000});
        await page.waitForTimeout(500);
        expect((await passkeyCalls(page)).length).toBe(0);
    }));

test("#345 비밀번호 화면의 사용자 이름 칸은 자동 완성 패스키를 받고, 패스키 버튼을 누르면 그 요청을 먼저 취소한다 (AC-5, AC-6)", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await stubCredentials(page, [NOT_ALLOWED]);
        await page.route("**/api/login/passkey/options", (route) => json(route, 200, {success: true, options: LOGIN_OPTIONS}));
        await page.goto(localUrl(app));
        await page.locator("#login-password").waitFor({state: "visible", timeout: 30_000});
        expect(await page.locator("#login-username").getAttribute("autocomplete")).toBe("username webauthn");
        await page.waitForFunction(() => (window as any).__passkeyCalls.some((call: {mediation: string}) => call.mediation === "conditional"), undefined, {timeout: 10_000});
        await page.locator("#login-passkey button").click();
        await page.locator("#login-message").filter({hasText: "Sign-in was canceled."}).waitFor({state: "visible", timeout: 10_000});
        const calls = await passkeyCalls(page);
        const conditional = calls.findIndex((call) => call.mediation === "conditional");
        const button = calls.findIndex((call) => call.mediation !== "conditional");
        expect(conditional).toBeLessThan(button);
        expect(calls[conditional].aborted).toBe(true);
        // 버튼 요청이 끝나면 조건부 요청을 다시 건다. 동시에 진행 중인 요청은 한 개뿐이다.
        await page.waitForFunction(() => (window as any).__passkeyCalls.filter((call: {mediation: string; aborted: boolean}) => call.mediation === "conditional" && !call.aborted).length === 1, undefined, {timeout: 10_000});
    }));

test("#345 자동 요청이 끝나지 않아도 Use password 를 누를 수 있고, 누르면 그 요청을 취소하고 비밀번호 칸을 편다", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await stubCredentials(page, [{hang: true}]);
        await preferPasskey(page);
        await page.route("**/api/login/passkey/options", (route) => json(route, 200, {success: true, options: LOGIN_OPTIONS}));
        await page.goto(localUrl(app));
        await page.waitForFunction(() => (window as any).__passkeyCalls.length === 1, undefined, {timeout: 30_000});
        expect(await page.locator("#login-use-password").isDisabled()).toBe(false);
        await page.locator("#login-use-password").click();
        await page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
        expect((await passkeyCalls(page))[0].aborted).toBe(true);
        expect((await page.locator("#login-message").textContent())?.trim()).toBe("");
    }));

test("#345 자동 완성 요청은 100초마다 새로 건다(서버 challenge 는 150초 뒤 만료된다)", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await page.clock.install();
        await stubCredentials(page);
        await page.route("**/api/login/passkey/options", (route) => json(route, 200, {success: true, options: LOGIN_OPTIONS}));
        await page.goto(localUrl(app));
        await page.locator("#login-password").waitFor({state: "visible", timeout: 30_000});
        await page.waitForFunction(() => (window as any).__passkeyCalls.filter((call: {mediation: string}) => call.mediation === "conditional").length === 1, undefined, {timeout: 10_000});
        await page.clock.fastForward(99_000);
        // 실제 시간이 조금 흘러도 100초 경계 전에는 첫 요청이 살아 있어야 한다.
        expect((await passkeyCalls(page)).filter((call) => call.mediation === "conditional").map((call) => call.aborted)).toEqual([false]);
        await page.clock.fastForward(2_000);
        await page.waitForFunction(() => (window as any).__passkeyCalls.filter((call: {mediation: string}) => call.mediation === "conditional").length === 2, undefined, {timeout: 10_000});
        const conditional = (await passkeyCalls(page)).filter((call) => call.mediation === "conditional");
        expect(conditional[0].aborted).toBe(true);
        expect(conditional[1].aborted).toBe(false);
    }));

test("#345 자동 완성으로 고른 패스키를 서버가 거부해도 이 기기의 패스키 우선 표시는 지우지 않는다", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await stubCredentials(page);
        await page.route("**/api/login/passkey/options", (route) => json(route, 200, {success: true, options: LOGIN_OPTIONS}));
        await page.route("**/api/login/passkey", (route) => json(route, 401, {success: false, code: "passkey_invalid", message: "Passkey sign-in failed."}));
        await page.goto(localUrl(app));
        await page.locator("#login-password").waitFor({state: "visible", timeout: 30_000});
        await page.evaluate(() => { localStorage.setItem("tttgate.passkeyPreferred", "1"); });
        await page.waitForFunction(() => typeof (window as any).__pickAutofill === "function", undefined, {timeout: 10_000});
        await page.evaluate(() => (window as any).__pickAutofill());
        await page.locator("#login-message").filter({hasText: "The passkey was not accepted."}).waitFor({state: "visible", timeout: 10_000});
        expect(await page.evaluate(() => localStorage.getItem("tttgate.passkeyPreferred"))).toBe("1");
    }));

test("#345 부트스트랩이 필요하면 자동 완성 요청을 취소하고 사용자 이름 칸에서 webauthn 을 뺀다", () =>
    withApp({fixture: "bootstrap", login: false}, async (app) => {
        const {page} = app;
        await stubCredentials(page);
        await page.route("**/api/login/passkey/options", (route) => json(route, 200, {success: true, options: LOGIN_OPTIONS}));
        await page.goto(localUrl(app));
        await page.locator("#login-password").waitFor({state: "visible", timeout: 30_000});
        await page.waitForFunction(() => (window as any).__passkeyCalls.some((call: {mediation: string}) => call.mediation === "conditional"), undefined, {timeout: 10_000});
        await page.locator("#login-username").fill("admin");
        await page.locator("#login-password").fill("first-password-1234");
        await page.getByRole("button", {name: "OK", exact: true}).click();
        await page.locator("#bootstrap-token").waitFor({state: "visible", timeout: 10_000});
        await page.waitForFunction(() => (window as any).__passkeyCalls.every((call: {mediation: string; aborted: boolean}) => call.mediation !== "conditional" || call.aborted), undefined, {timeout: 10_000});
        expect(await page.locator("#login-username").getAttribute("autocomplete")).toBe("username");
    }));

// ── #346 FR-10a: 2단계 인증 강제 대상이 패스키만 가졌으면 비밀번호 로그인은 403 passkey_required 다 ─────────────

const passkeyRequired = (page: Page) => page.route("**/api/login", (route) =>
    json(route, 403, {success: false, code: "passkey_required", message: "This account signs in with a passkey."}));
const submitPassword = async (page: Page) => {
    await page.locator("#login-password").waitFor({state: "visible", timeout: 30_000});
    await page.locator("#login-username").fill("alice");
    await page.locator("#login-password").fill("user-password-1234");
    await page.getByRole("button", {name: "OK", exact: true}).click();
};

test("#346 passkey_required 를 받으면 비밀번호 칸을 접고 패스키 로그인으로 안내하며, 다른 계정으로 돌아갈 수 있다 (AC-3b)", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await stubCredentials(page, [{hang: true}]);
        await passkeyRequired(page);
        await page.route("**/api/login/passkey/options", (route) => json(route, 200, {success: true, options: LOGIN_OPTIONS}));
        await page.goto(localUrl(app));
        await submitPassword(page);
        const notice = page.locator("#login-passkey-required");
        await notice.waitFor({state: "visible", timeout: 10_000});
        expect((await notice.textContent())?.trim()).toBe("This account signs in with a passkey.");
        expect(await page.locator("#login-password").count()).toBe(0);
        expect(await page.locator("#login-passkey button").isVisible()).toBe(true);
        expect(await page.locator("#login-use-password").count()).toBe(0);
        expect((await page.locator("#login-passkey-lost").textContent())?.trim()).toBe("Lost your passkey? Ask your administrator to reset your sign-in.");
        await page.locator("#login-start-over").click();
        await page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
        expect(await page.locator("#login-passkey-required").count()).toBe(0);
    }));

test("#346 패스키를 쓸 수 없는 주소에서 passkey_required 를 받으면 쓸 수 있는 주소의 조건과 관리자 안내를 보인다", () =>
    withApp({fixture: "rbac", login: false}, async (app) => {
        const {page} = app;
        await passkeyRequired(page);
        await page.goto(app.url);
        await submitPassword(page);
        const notice = page.locator("#login-passkey-required");
        await notice.waitFor({state: "visible", timeout: 10_000});
        expect((await notice.textContent())?.trim()).toBe("This account signs in with a passkey, but passkeys aren't available at this address.");
        expect(await page.locator("#login-passkey").count()).toBe(0);
        expect((await page.locator("#login-passkey-hint").textContent())).toContain(CONDITION);
        expect((await page.locator("#login-passkey-lost").textContent())?.trim())
            .toBe("If you can't, ask your administrator to reset your password and two-factor authentication.");
    }));
