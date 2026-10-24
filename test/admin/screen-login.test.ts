import type {Page} from "playwright";
import {ADMIN_TEST_PASSWORD, startAdminApp} from "../helpers/adminApp";
import {REGULAR_USER, TEMP_USER} from "../helpers/adminFixture";

const clickOk = (page: Page) => page.getByRole("button", {name: "OK", exact: true}).click();

const expectMessage = async (page: Page, text: string) => {
    await page.waitForFunction((value) => document.querySelector("#login-message")?.textContent === value, text, {timeout: 10_000});
    expect(await page.locator("#login-message").textContent()).toBe(text);
};

const expectStatusScreen = async (page: Page) => {
    await page.waitForFunction(() => location.hash === "#/status", undefined, {timeout: 10_000});
    // 옛 ServerStatusLayout 이 같은 이름의 h2 를 함께 그리므로 골격의 h1 로 좁혀 확인한다.
    await page.locator("h1").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("h1").textContent()).toBe("Status");
};

test("부트스트랩 화면이 단계별 문구를 보여주고 새로고침 없이 상태 화면에 도달한다", async () => {
    const app = await startAdminApp({fixture: "bootstrap", login: false});
    try {
        let loads = 0;
        app.page.on("load", () => { loads++; });
        const password = app.page.locator("#login-password");
        await password.waitFor({state: "visible", timeout: 10_000});

        await clickOk(app.page);
        await expectMessage(app.page, "Please enter your password.");

        await password.fill("short");
        await clickOk(app.page);
        await expectMessage(app.page, "The password must be 8 to 1024 characters long.");

        await password.fill("plainword");
        await clickOk(app.page);
        await expectMessage(app.page, "Enter the bootstrap token to set the first password.");
        const tokenField = app.page.getByLabel("Bootstrap token", {exact: true});
        await tokenField.waitFor({state: "visible", timeout: 10_000});
        await app.page.getByText("Read the token from config/.bootstrap-token on the server.", {exact: true})
            .waitFor({state: "visible", timeout: 10_000});

        await tokenField.fill("wrong-token");
        await clickOk(app.page);
        await expectMessage(app.page, "The bootstrap token is invalid. Check config/.bootstrap-token on the server.");

        await tokenField.fill(await app.token());
        await clickOk(app.page);
        await expectStatusScreen(app.page);

        expect(loads).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("비밀번호 fixture 는 오답에 문구를 보여주고 정답에 상태 화면으로 넘어간다", async () => {
    const app = await startAdminApp({fixture: "password", login: false});
    try {
        const password = app.page.locator("#login-password");
        await password.waitFor({state: "visible", timeout: 10_000});

        await password.fill("wrong-password");
        await clickOk(app.page);
        await expectMessage(app.page, "The password is incorrect.");

        await password.fill(ADMIN_TEST_PASSWORD);
        await clickOk(app.page);
        await expectStatusScreen(app.page);

        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("비밀번호 입력란에서 Enter 를 누르면 로그인 요청 1건으로 제출된다", async () => {
    const app = await startAdminApp({fixture: "password", login: false});
    try {
        const loginRequests: string[] = [];
        app.page.on("request", (request) => {
            if(request.method() === "POST" && new URL(request.url()).pathname === "/api/login") loginRequests.push(request.url());
        });
        const password = app.page.locator("#login-password");
        await password.waitFor({state: "visible", timeout: 10_000});
        await password.fill(ADMIN_TEST_PASSWORD);

        const pending = app.page.waitForResponse(
            (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/login",
            {timeout: 10_000});
        await password.press("Enter");
        expect((await pending).status()).toBe(200);

        await expectStatusScreen(app.page);
        expect(loginRequests.length).toBe(1);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("with-tunnels fixture 는 기본 옵션만으로 로그인을 마치고 호출 기록을 돌려준다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await expectStatusScreen(app.page);
        // 호출 기록은 IPC 왕복으로 오므로 배열이 오는 것과 각 항목의 형태까지 확인한다.
        // 어떤 메서드가 담기는지는 화면마다 다르므로 여기서 고정하지 않는다.
        const calls = await app.calls();
        expect(Array.isArray(calls)).toBe(true);
        expect(calls.every((call) => typeof call.method === "string" && Array.isArray(call.args))).toBe(true);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

// ---- #102 (U2-10) 다사용자 로그인 ----

const loginWith = async (page: Page, username: string, password: string) => {
    await page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await clickOk(page);
};

test("Username 입력란은 비밀번호보다 앞에 있고 autocomplete=username 이다", async () => {
    const app = await startAdminApp({fixture: "password", login: false});
    try {
        const username = app.page.locator("#login-username");
        await username.waitFor({state: "visible", timeout: 10_000});
        expect(await username.getAttribute("autocomplete")).toBe("username");
        const order = await app.page.evaluate(() => {
            const user = document.getElementById("login-username")!;
            const pass = document.getElementById("login-password")!;
            return Boolean(user.compareDocumentPosition(pass) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        expect(order).toBe(true);
        expect(await app.page.getByLabel("Username", {exact: true}).count()).toBe(1);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("성공한 username 을 기억해 다음에 채워 둔다", async () => {
    const app = await startAdminApp({fixture: "password", login: false});
    try {
        await loginWith(app.page, "admin", ADMIN_TEST_PASSWORD);
        await expectStatusScreen(app.page);
        expect(await app.page.evaluate(() => localStorage.getItem("tttgate.lastUsername"))).toBe("admin");

        // 세션 쿠키만 지우고 페이지를 새로 열면 로그인 화면이 기억한 username 으로 시작한다(localStorage 는 남는다).
        await app.page.context().clearCookies();
        await app.page.reload();
        await app.page.locator("#login-username").waitFor({state: "visible", timeout: 10_000});
        expect(await app.page.locator("#login-username").inputValue()).toBe("admin");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("username 을 비우면 admin 으로 보낸다", async () => {
    const app = await startAdminApp({fixture: "password", login: false});
    try {
        await app.page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
        await app.page.locator("#login-username").fill("");
        await app.page.locator("#login-password").fill(ADMIN_TEST_PASSWORD);
        const pending = app.page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/login");
        await clickOk(app.page);
        expect((await pending).postDataJSON()).toEqual({username: "admin", password: ADMIN_TEST_PASSWORD});
        await expectStatusScreen(app.page);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("없는 username 은 비밀번호 오류와 같은 문구다", async () => {
    const app = await startAdminApp({fixture: "password", login: false});
    try {
        await loginWith(app.page, "nobody", ADMIN_TEST_PASSWORD);
        await expectMessage(app.page, "The password is incorrect.");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("부트스트랩은 username 힌트를 보이고 형식 오류를 알리며 root 로 첫 슈퍼유저를 만든다", async () => {
    const app = await startAdminApp({fixture: "bootstrap", login: false});
    try {
        await loginWith(app.page, "", "plainword");
        await expectMessage(app.page, "Enter the bootstrap token to set the first password.");
        await app.page.getByText("Choose the first superuser name (default: admin)", {exact: true}).waitFor({state: "visible", timeout: 10_000});
        const tokenField = app.page.getByLabel("Bootstrap token", {exact: true});
        await tokenField.fill(await app.token());

        await app.page.locator("#login-username").fill("bad name");
        await clickOk(app.page);
        await expectMessage(app.page, "Username must be 3-32 characters: a-z, 0-9, dot, underscore, hyphen.");

        await app.page.locator("#login-username").fill("root");
        await app.page.locator("#login-password").fill("strong-root-password-1");
        await clickOk(app.page);
        await expectStatusScreen(app.page);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("일반 유저는 자기 섹션(tunnels)만 드로어에서 본다", async () => {
    const app = await startAdminApp({fixture: "regular-user", login: false});
    try {
        await loginWith(app.page, REGULAR_USER.username, REGULAR_USER.password);
        // #103 (U3-01): tunnels 섹션만 보는 사용자의 기본 화면은 #/tunnels 다.
        await app.page.waitForFunction(() => location.hash === "#/tunnels", undefined, {timeout: 10_000});
        await app.page.getByRole("button", {name: "Open menu"}).click();
        await app.page.getByRole("dialog", {name: "Navigation"}).waitFor({state: "visible"});
        expect(await app.page.locator(".drawer-item").allTextContents()).toEqual(["Tunnels"]);
        expect(await app.page.locator("#drawer-username").textContent()).toBe(REGULAR_USER.username);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("비밀번호 변경이 필요한 사용자는 #/me/password 에 고정되고 Sign out 으로만 나간다", async () => {
    const app = await startAdminApp({fixture: "regular-user", login: false});
    try {
        await loginWith(app.page, TEMP_USER.username, TEMP_USER.password);
        await app.page.waitForFunction(() => location.hash === "#/me/password", undefined, {timeout: 10_000});
        await app.page.locator("#pw-forced-note").waitFor({state: "visible", timeout: 10_000});
        expect(await app.page.locator('[aria-label="Open menu"]').count()).toBe(0);
        await app.page.getByRole("button", {name: "Sign out", exact: true}).click();
        await app.page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("슈퍼유저가 다른 화면에서 Sign out 해도 다음 사용자는 기본 화면에서 시작한다", async () => {
    const app = await startAdminApp({fixture: "regular-user"});
    try {
        await app.page.evaluate(() => { window.location.hash = "#/server"; });
        await app.page.locator("h1").filter({hasText: "Server settings"}).waitFor({state: "visible", timeout: 10_000});
        await app.page.getByRole("button", {name: "Open menu"}).click();
        await app.page.locator("#nav-sign-out").click();
        await loginWith(app.page, REGULAR_USER.username, REGULAR_USER.password);
        await app.page.waitForFunction(() => location.hash === "#/tunnels", undefined, {timeout: 10_000});
        await app.page.getByRole("button", {name: "Open menu"}).waitFor({state: "visible", timeout: 10_000});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("/api/me 가 401 이면 로그인 화면으로, 네트워크 오류면 Offline 으로 간다", async () => {
    const app = await startAdminApp({fixture: "password", login: false});
    try {
        await app.page.route("**/api/me", (route) => route.fulfill({status: 401, contentType: "application/json", body: JSON.stringify({success: false})}));
        // /api/me 응답을 실제로 기다린다. 기다리지 않으면 로그인 전 화면에서도 아래 조건이 참이라 다음 단계와 경쟁한다.
        const meRequested = app.page.waitForResponse((response) => new URL(response.url()).pathname === "/api/me", {timeout: 10_000});
        await loginWith(app.page, "admin", ADMIN_TEST_PASSWORD);
        expect((await meRequested).status()).toBe(401);
        // 로그인은 성공했지만 /api/me 가 401 이라 다시 로그인 화면이다.
        await app.page.waitForFunction(() => document.querySelector("#login-password") !== null && document.querySelector("#menu-button") === null,
            undefined, {timeout: 10_000});
        await app.page.waitForTimeout(300);
        expect(await app.page.getByRole("button", {name: "Open menu"}).count()).toBe(0);

        await app.page.unroute("**/api/me");
        await app.page.route("**/api/me", (route) => route.abort());
        await loginWith(app.page, "admin", ADMIN_TEST_PASSWORD);
        await app.page.getByText("Offline server...", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    } finally {
        await app.close();
    }
}, 60_000);
