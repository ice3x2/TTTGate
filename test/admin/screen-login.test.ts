import type {Page} from "playwright";
import {ADMIN_TEST_PASSWORD, startAdminApp} from "../helpers/adminApp";
import type {AdminApp} from "../helpers/adminApp";

// 옛 layout/ServerStatusLayout.svelte 는 현재 API 봉투 규약({success, …, sysUsage})을 풀지 않아
// #/status 에 도착하면 예외를 던진다. 그 화면은 #88 (U1-06) 이 교체하므로 여기서는 고치지 않고,
// 로그인 화면이 만든 오류만 남기고 그 한 가지만 걸러낸다. 컴포넌트 이름이 메시지에 붙는 것은
// Svelte 개발 모드의 동작이며, startAdminApp 은 항상 Vite 개발 서버로 앱을 연다.
const loginErrors = (app: AdminApp): string[] => app.errors.filter((message) => !message.includes("ServerStatusLayout.svelte"));

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
        await expectMessage(app.page, "The password does not meet the server's minimum length.");

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
        expect(loginErrors(app)).toEqual([]);
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

        expect(loginErrors(app)).toEqual([]);
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
        expect(loginErrors(app)).toEqual([]);
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
        expect(loginErrors(app)).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);
