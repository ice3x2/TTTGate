import type {Page} from "playwright";
import {startAdminApp, type AdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {RBAC_PASSWORDS} from "../helpers/rbacFixture";

// U4-06 / #114 — 감사 로그 화면. 슈퍼유저는 전체 이벤트와 사용자 필터, 일반 유저는 "My activity" 로 본인 이벤트만 본다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const hashIs = (page: Page, expected: string) =>
    page.waitForFunction((value) => location.hash === value, expected, {timeout: 10_000});

const events = (page: Page) => page.locator("#audit-list .audit-event");

const openFromDrawer = async (page: Page, title: string) => {
    await page.getByRole("button", {name: "Open menu"}).click();
    const dialog = page.locator('[role=dialog][aria-label="Navigation"]');
    await dialog.waitFor({state: "visible"});
    await dialog.getByText(title, {exact: true}).click();
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

/** 화면의 CSRF 쿠키로 그룹 하나를 만든다(group_created 감사가 실제 경로로 남는다). */
const createGroup = (page: Page, name: string) => page.evaluate(async (groupName) => {
    const csrf = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("csrfToken="))?.slice("csrfToken=".length) ?? "";
    const response = await fetch("/api/groups", {method: "POST", credentials: "same-origin",
        headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf}, body: JSON.stringify({name: groupName})});
    return response.status;
}, name);

const withApp = async (options: Parameters<typeof startAdminApp>[0], check: (app: AdminApp) => Promise<void>): Promise<void> => {
    const app = await startAdminApp(options);
    try {
        await check(app);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

test("admin 은 드로어의 Audit log 로 전체 이벤트·사용자 필터를 보고, 최신 이벤트가 맨 위다", () => withApp({fixture: "rbac"}, async ({page}) => {
    expect(await createGroup(page, "Audit probe")).toBe(201);
    await openFromDrawer(page, "Audit log");
    await hashIs(page, "#/audit");
    await page.locator("header h1").filter({hasText: /^Audit log$/}).waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#audit-filter-user").count()).toBe(1);
    await events(page).first().waitFor({state: "visible", timeout: 10_000});
    const first = events(page).first();
    expect(await first.getAttribute("data-type")).toBe("group_created");
    expect((await first.locator(".badge").textContent())?.trim()).toBe("success");
    expect(await first.locator(".audit-meta").textContent()).toContain("@admin");
}));

test("타입·결과 필터는 서버에 다시 묻고, 상세는 펼치고 접을 수 있다", () => withApp({fixture: "rbac"}, async ({page}) => {
    await page.goto(`${page.url().split("#")[0]}#/audit`);
    await events(page).first().waitFor({state: "visible", timeout: 10_000});

    const toggle = events(page).first().locator(".audit-toggle");
    await toggle.click();
    await events(page).first().locator(".audit-detail").waitFor({state: "visible"});
    expect(await toggle.getAttribute("aria-expanded")).toBe("true");
    await toggle.click();
    await events(page).first().locator(".audit-detail").waitFor({state: "detached"});

    const listed = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/audit" && new URL(request.url()).searchParams.get("type") === "login_success");
    await page.locator("#audit-filter-type").selectOption("login_success");
    await listed;
    await events(page).first().waitFor({state: "visible", timeout: 10_000});
    const types = await events(page).evaluateAll((items) => items.map((item) => item.getAttribute("data-type")));
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types)).toEqual(new Set(["login_success"]));

    await page.locator("#audit-filter-outcome").selectOption("failure");
    await page.locator("#audit-empty").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#audit-empty").textContent()).toBe("No events in this range.");
}));

test("#188 기간 탭은 선택 탭만 Tab 순서에 두고, 화살표·Home·End 로 옮겨 가며 매번 다시 묻는다", () => withApp({fixture: "rbac"}, async ({page}) => {
    await page.goto(`${page.url().split("#")[0]}#/audit`);
    await events(page).first().waitFor({state: "visible", timeout: 10_000});
    const tabs = page.locator("#audit-range [role=tab]");
    const state = () => tabs.evaluateAll((items) => items.map((item) => ({
        label: item.textContent?.trim(), selected: item.getAttribute("aria-selected"),
        tabindex: item.getAttribute("tabindex"), focused: item === document.activeElement
    })));
    const only = (label: string) => ["24h", "7d", "30d", "All"].map((name) => ({
        label: name, selected: String(name === label), tabindex: name === label ? "0" : "-1", focused: name === label
    }));
    const DAY = 86_400_000;
    const RANGE: Record<string, number | undefined> = {"24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY, "All": undefined};
    const listed: string[] = [];
    page.on("request", (request) => {
        const url = new URL(request.url());
        if(url.pathname === "/api/audit") listed.push(url.searchParams.get("from") ?? "");
    });
    // 버블 단계의 window 리스너는 탭의 핸들러 다음에 돌아 defaultPrevented 를 그대로 본다.
    await page.evaluate(() => {
        (window as any).__keys = [];
        window.addEventListener("keydown", (event) => (window as any).__keys.push(event.defaultPrevented));
    });
    const lastPrevented = () => page.evaluate(() => (window as any).__keys.at(-1) as boolean);
    const isRange = (from: string, label: string) => {
        const expected = RANGE[label];
        return expected === undefined ? from === "" : from !== "" && Math.abs(Date.now() - Number(from) - expected) < 60_000;
    };
    /** 다루는 키는 그 기간으로 /api/audit 를 정확히 한 번 다시 묻고 기본 동작을 막는다. All 은 from 이 없다. */
    const press = async (key: string, label: string) => {
        listed.length = 0;
        await page.keyboard.press(key);
        for(const deadline = Date.now() + 10_000; listed.length === 0 && Date.now() < deadline;) await page.waitForTimeout(50);
        await page.waitForTimeout(300);
        expect(listed).toHaveLength(1);
        expect(isRange(listed[0], label)).toBe(true);
        expect(await lastPrevented()).toBe(true);
        expect(await state()).toEqual(only(label));
    };
    /** 선택이 그대로면 다시 묻지 않는다. prevented 는 그 키의 기본 동작을 막았는지다. */
    const still = async (key: string, label: string, prevented: boolean) => {
        listed.length = 0;
        await page.keyboard.press(key);
        await page.waitForTimeout(300);
        expect(listed).toEqual([]);
        expect(await lastPrevented()).toBe(prevented);
        expect(await state()).toEqual(only(label));
    };

    const initial = await state();
    expect(initial.map(({tabindex, selected}) => ({tabindex, selected}))).toEqual(only("7d").map(({tabindex, selected}) => ({tabindex, selected})));
    await tabs.nth(1).focus();
    await press("ArrowRight", "30d");
    await press("ArrowRight", "All");
    await press("ArrowRight", "24h");
    await press("ArrowLeft", "All");
    await press("Home", "24h");
    await still("Home", "24h", true);
    await press("End", "All");
    await still("End", "All", true);

    // 다루지 않는 키와 수정키 조합은 막지도, 선택을 바꾸지도 않는다.
    await still("ArrowDown", "All", false);
    await still("Shift+ArrowLeft", "All", false);
    await still("Control+Home", "All", false);
}));

test("50 건씩 읽고 Load more 로 나머지를 뒤에 붙인다", () => withApp({fixture: "rbac"}, async (app) => {
    await app.seedAudit(60);
    await app.page.goto(`${app.url}#/audit`);
    await app.page.reload();
    await app.page.waitForFunction(() => document.querySelectorAll("#audit-list .audit-event").length === 50, undefined, {timeout: 10_000});
    const more = app.page.locator("#audit-load-more");
    await more.waitFor({state: "visible"});
    await more.locator("button").click();
    await app.page.waitForFunction(() => document.querySelectorAll("#audit-list .audit-event").length >= 60, undefined, {timeout: 10_000});
    await more.waitFor({state: "detached", timeout: 10_000});
}));

test("alice 는 My activity 로 본인 이벤트만 보고 사용자 필터가 없다", () => withApp({fixture: "rbac", login: {username: "alice", password: RBAC_PASSWORDS.alice}}, async ({page}) => {
    await openFromDrawer(page, "Audit log");
    await hashIs(page, "#/audit");
    await page.locator("header h1").filter({hasText: /^My activity$/}).waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#audit-filter-user").count()).toBe(0);
    await events(page).first().waitFor({state: "visible", timeout: 10_000});
    const metas = await page.locator("#audit-list .audit-meta").allTextContents();
    expect(metas.length).toBeGreaterThan(0);
    for(const meta of metas) expect(meta.startsWith("@alice")).toBe(true);
}));

test("my_audit 가 없는 carol 은 드로어에 Audit log 가 없고 직접 가면 #/denied 다", () => withApp({fixture: "rbac-no-audit", login: {username: "carol", password: RBAC_PASSWORDS.carol}}, async ({page}) => {
    expect(await drawerTitles(page)).not.toContain("Audit log");
    await page.evaluate(() => { window.location.hash = "#/audit"; });
    await hashIs(page, "#/denied");
}));

test("늦게 온 앞선 필터 응답은 나중 필터의 결과를 덮지 않는다", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.seedAudit(60);
    await page.goto(`${app.url}#/audit`);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll("#audit-list .audit-event").length === 50, undefined, {timeout: 10_000});
    // failure 필터 응답만 늦춘다. 그사이 필터를 되돌리면 마지막 필터(전체)의 결과가 남아야 한다.
    await page.route((url) => url.pathname === "/api/audit" && url.searchParams.get("outcome") === "failure", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        await route.continue();
    });
    await page.locator("#audit-filter-outcome").selectOption("failure");
    await page.locator("#audit-filter-outcome").selectOption("");
    await page.waitForTimeout(3_500);
    expect(await page.locator("#audit-list .audit-event").count()).toBe(50);
    expect(await page.locator("#audit-empty").count()).toBe(0);
}));

test("늦게 온 Load more 응답은 필터를 바꾼 뒤의 목록에 붙지 않는다", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.seedAudit(60);
    await page.goto(`${app.url}#/audit`);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll("#audit-list .audit-event").length === 50, undefined, {timeout: 10_000});
    await page.route((url) => url.pathname === "/api/audit" && url.searchParams.has("cursor"), async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        await route.continue();
    });
    await page.locator("#audit-load-more button").click();
    await page.locator("#audit-filter-type").selectOption("user_updated");
    await page.waitForTimeout(3_500);
    const types = await page.locator("#audit-list .audit-event").evaluateAll((items) => items.map((item) => item.getAttribute("data-type")));
    expect(types.length).toBe(50);
    expect(new Set(types)).toEqual(new Set(["user_updated"]));
}));
