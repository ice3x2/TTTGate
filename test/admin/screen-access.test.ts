import type {Page} from "playwright";
import {startAdminApp} from "../helpers/adminApp";
import {RBAC_PASSWORDS} from "../helpers/rbacFixture";

// U3-01 / #103 — 섹션 기반 드로어와 라우트 가드. 테스트마다 rbac fixture 로 앱을 새로 띄운다.
jest.setTimeout(120_000);

type Name = keyof typeof RBAC_PASSWORDS;

const open = (name: Name) => startAdminApp({fixture: "rbac", ...(name === "admin" ? {} : {login: {username: name, password: RBAC_PASSWORDS[name]}})});

const hashIs = (page: Page, expected: string) =>
    page.waitForFunction((value) => location.hash === value, expected, {timeout: 10_000});

/** 가드가 해시를 고쳐 쓰므로 목표로 가기 전에 중립 해시(#/me)에 들른다. 그러지 않으면 앞 단언의 #/denied 를 그대로 읽는다. */
const visit = async (page: Page, url: string, hash: string) => {
    await page.goto(`${url}#/me`);
    await hashIs(page, "#/me");
    await page.goto(`${url}${hash}`);
};

const drawerTitles = async (page: Page): Promise<string[]> => {
    await page.getByRole("button", {name: "Open menu"}).click();
    const dialog = page.locator('[role=dialog][aria-label="Navigation"]');
    await dialog.waitFor({state: "visible"});
    const titles = await dialog.locator(".drawer-item").allTextContents();
    await page.keyboard.press("Escape");
    await dialog.waitFor({state: "detached"});
    return titles;
};

test("alice 는 #/tunnels 에서 시작하고 드로어에 Tunnels·My account 만 있다", async () => {
    const app = await open("alice");
    try {
        await hashIs(app.page, "#/tunnels");
        await app.page.getByRole("button", {name: "Open menu"}).click();
        const dialog = app.page.locator('[role=dialog][aria-label="Navigation"]');
        await dialog.waitFor({state: "visible"});
        expect(await dialog.locator(".drawer-item").allTextContents()).toEqual(["Tunnels", "My account"]);
        expect(await app.page.locator("#drawer-username").textContent()).toBe("alice");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("alice 가 권한 없는 해시로 가면 #/denied 이고 버튼으로 기본 화면에 돌아간다", async () => {
    const app = await open("alice");
    try {
        await hashIs(app.page, "#/tunnels");
        await visit(app.page, app.url, "#/users");
        await hashIs(app.page, "#/denied");
        expect(await app.page.locator("#denied-message").textContent()).toBe("You don't have access to this page.");
        await app.page.getByRole("button", {name: "Go to my tunnels"}).click();
        await hashIs(app.page, "#/tunnels");

        // 라우터 기본값(#/status)은 사용자가 고른 것이 아니므로 거부 대신 기본 화면으로 보낸다.
        await visit(app.page, app.url, "#/status");
        await hashIs(app.page, "#/tunnels");

        for(const hash of ["#/server", "#/groups", "#/users/new", "#/groups/default"]) {
            await visit(app.page, app.url, hash);
            await hashIs(app.page, "#/denied");
        }
        for(const hash of ["#/me", "#/me/password"]) {
            await visit(app.page, app.url, hash);
            await hashIs(app.page, hash);
            await app.page.locator("#screen-placeholder").waitFor({state: "visible", timeout: 10_000});
            expect(await app.page.evaluate(() => location.hash)).toBe(hash);
        }
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("admin 은 #/status 에서 시작하고 NAV 6개를 모두 보며 어디로든 갈 수 있다", async () => {
    const app = await open("admin");
    try {
        await hashIs(app.page, "#/status");
        expect(await drawerTitles(app.page)).toEqual(["Status", "Tunnels", "Server settings", "Users", "Groups", "My account"]);
        for(const hash of ["#/users", "#/groups", "#/me"]) {
            await visit(app.page, app.url, hash);
            await hashIs(app.page, hash);
            await app.page.locator("#screen-placeholder").waitFor({state: "visible", timeout: 10_000});
        }
        await visit(app.page, app.url, "#/denied");
        await hashIs(app.page, "#/denied");
        await app.page.locator("#denied-message").waitFor({state: "visible", timeout: 10_000});
        // 버튼은 고정 해시가 아니라 사용자의 기본 화면으로 간다.
        await app.page.getByRole("button", {name: "Go to my tunnels"}).click();
        await hashIs(app.page, "#/status");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("carol(Default 그룹)은 #/tunnels 에서 시작하고 Tunnels·My account 를 본다", async () => {
    const app = await open("carol");
    try {
        await hashIs(app.page, "#/tunnels");
        expect(await drawerTitles(app.page)).toEqual(["Tunnels", "My account"]);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("가드는 권한 없는 화면을 마운트하지 않아 일반 유저의 이동이 403 을 만들지 않는다", async () => {
    const app = await open("alice");
    try {
        await hashIs(app.page, "#/tunnels");
        const denied: string[] = [];
        app.page.on("response", (response) => {
            if(response.status() === 403) denied.push(`${response.request().method()} ${new URL(response.url()).pathname}`);
        });
        // 새로 읽을 때 #/status(Status 화면) 와 직접 입력한 #/server(Server settings 화면)를 지난다.
        await app.page.goto(`${app.url}#/status`);
        await app.page.reload();
        await hashIs(app.page, "#/tunnels");
        await visit(app.page, app.url, "#/server");
        await hashIs(app.page, "#/denied");
        await app.page.locator("#denied-message").waitFor({state: "visible", timeout: 10_000});
        expect(denied).toEqual([]);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("갈 수 있는 섹션이 없는 유저는 #/denied 에서 버튼 대신 안내를 본다", async () => {
    const app = await open("alice");
    try {
        await hashIs(app.page, "#/tunnels");
        await app.page.route("**/api/me", async (route) => {
            const response = await route.fetch();
            const body = await response.json();
            await route.fulfill({response, json: {...body, sections: []}});
        });
        await app.page.reload();
        await hashIs(app.page, "#/denied");
        await app.page.locator("#denied-help").waitFor({state: "visible", timeout: 10_000});
        expect(await app.page.getByRole("button", {name: "Go to my tunnels"}).count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});
