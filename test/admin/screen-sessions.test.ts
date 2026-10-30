import type {Page} from "playwright";
import {startAdminApp, type AdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {RBAC_PASSWORDS, RBAC_USER_IDS} from "../helpers/rbacFixture";

// U4-06 / #114 — 세션 관리 화면. 슈퍼유저는 전체 세션을 보고 끊으며, 일반 유저는 다른 기기 로그아웃만 한다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const hashIs = (page: Page, expected: string) =>
    page.waitForFunction((value) => location.hash === value, expected, {timeout: 10_000});

const rows = (page: Page) => page.locator("#sessions-list .session-row");
const rowCount = (page: Page, count: number) =>
    page.waitForFunction((n) => document.querySelectorAll("#sessions-list .session-row").length === n, count, {timeout: 10_000});
const aliceRows = (page: Page) => rows(page).filter({has: page.locator(".session-user", {hasText: /^alice$/})});

const withApp = async (options: Parameters<typeof startAdminApp>[0], check: (app: AdminApp) => Promise<void>): Promise<void> => {
    const app = await startAdminApp(options);
    try {
        await check(app);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

const openSessions = async (page: Page) => {
    await page.getByRole("button", {name: "Open menu"}).click();
    const dialog = page.locator('[role=dialog][aria-label="Navigation"]');
    await dialog.waitFor({state: "visible"});
    await dialog.getByText("Sessions", {exact: true}).click();
    await hashIs(page, "#/sessions");
};

const TWO_ALICE = {fixture: "rbac" as const, extraLogins: [{as: "alice", userAgent: "UA-ALICE-1"}, {as: "alice", userAgent: "UA-ALICE-2"}]};

test("admin 은 모든 세션을 보고 자기 세션에만 this device 가 붙는다", () => withApp(TWO_ALICE, async ({page}) => {
    await openSessions(page);
    await rowCount(page, 3);
    expect(await page.getByText("this device", {exact: true}).count()).toBe(1);
    const current = rows(page).filter({has: page.getByText("this device", {exact: true})});
    expect(await current.locator(".session-user").textContent()).toBe("admin");
    const agents = (await aliceRows(page).allTextContents()).join(" ");
    expect(agents).toContain("UA-ALICE-1");
    expect(agents).toContain("UA-ALICE-2");
}));

test("다른 사용자의 세션 하나를 끊으면 목록과 서버 모두 줄어든다", () => withApp(TWO_ALICE, async (app) => {
    const {page} = app;
    await openSessions(page);
    await rowCount(page, 3);
    await aliceRows(page).first().locator(".session-end").click();
    const modal = page.locator(".end-session-modal");
    await modal.waitFor({state: "visible"});
    expect(await modal.textContent()).toContain("End session");
    expect(await modal.textContent()).toContain("alice");
    await page.locator("#confirm-end").click();
    await page.getByText("Session ended.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await rowCount(page, 2);
    expect(await app.sessions()).toHaveLength(2);
}));

test("사용자 필터로 alice 를 고르고 모두 끊으면 필터가 유지된 채 비고, 필터를 풀면 admin 만 남는다", () => withApp(TWO_ALICE, async ({page}) => {
    await openSessions(page);
    await rowCount(page, 3);
    await page.locator("#sessions-filter-user").selectOption(RBAC_USER_IDS.alice);
    await rowCount(page, 2);
    const endAll = page.locator("#sessions-end-all-user button");
    expect(await endAll.isEnabled()).toBe(true);
    await endAll.click();
    await page.locator(".end-all-modal").waitFor({state: "visible"});
    await page.locator("#confirm-end-all").click();
    await rowCount(page, 0);
    expect(await page.locator("#sessions-filter-user").inputValue()).toBe(RBAC_USER_IDS.alice);
    await page.locator("#sessions-filter-user").selectOption("");
    await rowCount(page, 1);
}));

test("자기 세션을 끊으면 경고 문구를 보이고 로그인 화면으로 간다", () => withApp({fixture: "rbac"}, async ({page}) => {
    await openSessions(page);
    await rowCount(page, 1);
    await rows(page).first().locator(".session-end").click();
    const modal = page.locator(".end-session-modal");
    await modal.waitFor({state: "visible"});
    expect(await modal.textContent()).toContain("You will be signed out.");
    await page.locator("#confirm-end").click();
    await page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
}));

test("alice 는 본인 세션만 보고 다른 기기 로그아웃만 할 수 있다", () => withApp({fixture: "rbac",
    login: {username: "alice", password: RBAC_PASSWORDS.alice}, extraLogins: [{as: "alice", userAgent: "UA-ALICE-1"}]}, async ({page}) => {
    await openSessions(page);
    await rowCount(page, 2);
    expect(await page.locator("#sessions-filter-user").count()).toBe(0);
    expect(await page.locator(".session-end").count()).toBe(0);
    await page.locator("#sessions-logout-others button").click();
    await page.getByText("Signed out 1 other device(s).", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await rowCount(page, 1);
}));

test("다른 곳에서 끊긴 세션은 10초 폴링으로 목록에서 사라진다", () => withApp({fixture: "rbac", extraLogins: [{as: "alice", userAgent: "UA-ALICE-1"}]}, async (app) => {
    const {page} = app;
    await openSessions(page);
    await rowCount(page, 2);
    const alice = (await app.sessions()).find((entry) => entry.username === "alice")!;
    // 화면을 거치지 않고 API 로 끊는다. 목록은 다음 폴링에서 갱신된다.
    const status = await page.evaluate(async (id) => {
        const csrf = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("csrfToken="))?.slice("csrfToken=".length) ?? "";
        return (await fetch(`/api/sessions/${id}`, {method: "DELETE", credentials: "same-origin", headers: {"X-CSRF-Token": csrf}})).status;
    }, alice.id);
    expect(status).toBe(200);
    await page.waitForFunction(() => document.querySelectorAll("#sessions-list .session-row").length === 1, undefined, {timeout: 12_000});
}));
