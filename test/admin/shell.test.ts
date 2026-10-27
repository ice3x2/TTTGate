import type {Page} from "playwright";
import {startAdminBrowser} from "../helpers/adminBrowser";
import {startAdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";

// 앱 기동 예산보다 짧으면 부하에서 helper 의 진단 대신 jest 시간 초과로 끝난다(#273).
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const FIXTURE = "/test/shell-fixture.html";

const setHash = async (page: Page, hash: string) => {
    await page.evaluate((value) => { window.location.hash = value; }, hash);
    await page.waitForFunction((value) => location.hash === value, hash);
};

const heading = async (page: Page, title: string) => {
    await page.getByRole("heading", {name: title, exact: true}).waitFor({state: "visible"});
};

test("#/status 로 열면 제목과 화면 표식이 status 다", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}${FIXTURE}#/status`);
        await heading(app.page, "Status");
        expect(await app.page.locator("h1").textContent()).toBe("Status");
        expect(await app.page.locator("#screen").textContent()).toBe("status");
        expect(await app.page.locator(".hdr-version").count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

test("메뉴 버튼이 드로어를 열고 항목을 고르면 해시와 화면이 바뀌며 초점이 돌아온다", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}${FIXTURE}#/status`);
        await heading(app.page, "Status");

        const menu = app.page.getByRole("button", {name: "Open menu"});
        await menu.click();
        const dialog = app.page.getByRole("dialog", {name: "Navigation"});
        await dialog.waitFor({state: "visible"});
        expect(await menu.getAttribute("aria-expanded")).toBe("true");
        await app.page.waitForFunction(() => document.activeElement?.classList.contains("drawer-item") === true);
        expect(await app.page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("Status");
        expect(await app.page.locator('.drawer-item[aria-current="page"]').textContent()).toBe("Status");

        await app.page.getByRole("link", {name: "Tunnels"}).click();
        await dialog.waitFor({state: "detached"});
        expect(await app.page.evaluate(() => location.hash)).toBe("#/tunnels");
        await app.page.waitForFunction(() => document.activeElement?.id === "menu-button");
        await heading(app.page, "Tunnels");
        expect(await app.page.locator("#screen").textContent()).toBe("tunnels");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

test("Escape 와 오버레이 클릭이 드로어를 닫는다", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}${FIXTURE}#/status`);
        await heading(app.page, "Status");
        const menu = app.page.getByRole("button", {name: "Open menu"});
        const dialog = app.page.getByRole("dialog", {name: "Navigation"});

        await menu.click();
        await dialog.waitFor({state: "visible"});
        await app.page.keyboard.press("Escape");
        await dialog.waitFor({state: "detached"});

        await menu.click();
        await dialog.waitFor({state: "visible"});
        await app.page.locator(".drawer-overlay").click({position: {x: 380, y: 40}});
        await dialog.waitFor({state: "detached"});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

test("해시마다 제목·화면 표식·뒤로 가기가 규칙대로 바뀐다", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}${FIXTURE}#/status`);
        await heading(app.page, "Status");

        await setHash(app.page, "#/tunnels/20001");
        await heading(app.page, "Tunnel 20001");
        expect(await app.page.locator("#screen").textContent()).toBe("tunnel-edit:20001");
        expect(await app.page.getByRole("button", {name: "Open menu"}).count()).toBe(0);
        await app.page.getByRole("button", {name: "Back"}).click();
        await app.page.waitForFunction(() => location.hash === "#/tunnels");
        await heading(app.page, "Tunnels");

        await setHash(app.page, "#/tunnels/new");
        await heading(app.page, "New tunnel");
        expect(await app.page.locator("#screen").textContent()).toBe("tunnel-edit:new");

        await setHash(app.page, "#/server");
        await heading(app.page, "Server settings");
        expect(await app.page.locator("#screen").textContent()).toBe("server");

        await setHash(app.page, "#/nope");
        await heading(app.page, "Status");
        expect(await app.page.locator("#screen").textContent()).toBe("status");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

test("본문이 모바일에서 전폭이고 데스크톱에서 서랍 오른쪽 공간에 1024px 로 중앙 정렬된다", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}${FIXTURE}#/status`);
        await heading(app.page, "Status");
        expect(await app.page.locator("main.shell-main").evaluate((el) => el.getBoundingClientRect().width)).toBe(400);
        expect(await app.page.evaluate(() => document.documentElement.scrollWidth)).toBe(
            await app.page.evaluate(() => document.documentElement.clientWidth));

        await app.page.setViewportSize({width: 1280, height: 800});
        await app.page.waitForFunction(() => document.querySelector("main.shell-main")!.getBoundingClientRect().width === 1024
            && document.querySelector("#nav-drawer") !== null);
        // 이슈 278: 데스크탑에서는 서랍이 왼쪽에 늘 열려 있으므로, 본문은 서랍을 뺀 나머지 폭의 가운데에 놓인다.
        const box = await app.page.evaluate(() => {
            const rect = document.querySelector("main.shell-main")!.getBoundingClientRect();
            const drawerRight = document.querySelector("#nav-drawer")!.getBoundingClientRect().right;
            return {width: rect.width, left: rect.left, centredLeft: drawerRight + (document.documentElement.clientWidth - drawerRight - 1024) / 2};
        });
        expect(box.width).toBe(1024);
        expect(box.left).toBeCloseTo(box.centredLeft, 0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

// ---- #102 (U2-10) 사용자명·Sign out·섹션 필터. 실제 백엔드가 필요하므로 startAdminApp 을 쓴다. ----

test("드로어 하단에 사용자명과 Sign out 이 있고 Sign out 은 세션을 끝낸다", async () => {
    const app = await startAdminApp({fixture: "password"});
    try {
        await app.page.getByRole("button", {name: "Open menu"}).click();
        await app.page.getByRole("dialog", {name: "Navigation"}).waitFor({state: "visible"});
        expect(await app.page.locator("#drawer-username").textContent()).toBe("admin");
        expect(await app.page.locator("#drawer-username").getAttribute("class")).toContain("mono");

        await app.page.locator("#nav-sign-out").click();
        await app.page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
        const validate = await app.page.request.get(`${app.origin}/api/validateSession`);
        expect(validate.status()).toBe(401);

        // 뒤로 가기로도 셸이 돌아오지 않는다.
        await app.page.goBack().catch(() => undefined);
        await app.page.waitForTimeout(300);
        expect(await app.page.locator("#login-password").count()).toBe(1);
        expect(await app.page.getByRole("button", {name: "Open menu"}).count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

test("슈퍼유저 드로어는 NAV 10개를 순서대로 보여 준다", async () => {
    const app = await startAdminApp({fixture: "password"});
    try {
        await app.page.getByRole("button", {name: "Open menu"}).click();
        await app.page.getByRole("dialog", {name: "Navigation"}).waitFor({state: "visible"});
        expect(await app.page.locator(".drawer-item").allTextContents()).toEqual(["Status", "Tunnels", "Server settings", "Trusted clients", "Users", "Groups", "Security", "Audit log", "Sessions", "My account"]);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);
