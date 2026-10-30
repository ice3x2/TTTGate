import type {Page} from "playwright";
import {startAdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {startAdminBrowser} from "../helpers/adminBrowser";
import {RBAC_PASSWORDS} from "../helpers/rbacFixture";

// #278 — 데스크탑(1024px 이상)에서는 서랍 메뉴가 왼쪽에 늘 열려 있고, 좁은 화면에서는 지금처럼 버튼으로 연다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const DESKTOP = {width: 1280, height: 800};
const MOBILE = {width: 400, height: 800};

const drawerVisible = (page: Page) => page.locator("#nav-drawer").isVisible();

/** 서랍이 보이면 true 가 될 때까지(또는 사라지면 false 가 될 때까지) 기다린다. */
const waitDrawer = (page: Page, visible: boolean) =>
    page.locator("#nav-drawer").waitFor({state: visible ? "visible" : "hidden", timeout: 10_000});

const layout = (page: Page) => page.evaluate(() => {
    const drawer = document.querySelector("#nav-drawer") as HTMLElement | null;
    const main = document.querySelector(".shell-main") as HTMLElement;
    const header = document.querySelector("header.hdr") as HTMLElement;
    const menuButton = document.querySelector("#menu-button") as HTMLElement | null;
    return {
        drawerRight: drawer ? drawer.getBoundingClientRect().right : null,
        mainLeft: main.getBoundingClientRect().left,
        headerLeft: header.getBoundingClientRect().left,
        menuButtonShown: !!menuButton && menuButton.getBoundingClientRect().width > 0 && getComputedStyle(menuButton).display !== "none",
        overlays: document.querySelectorAll(".drawer-overlay").length,
        items: document.querySelectorAll("#nav-drawer .drawer-item").length,
    };
});

test("on a desktop the drawer is open from the start beside the content, with no menu button or overlay (AC-1)", async () => {
    const app = await startAdminApp();
    try {
        await app.page.setViewportSize(DESKTOP);
        await waitDrawer(app.page, true);
        const l = await layout(app.page);
        expect(l.items).toBeGreaterThan(0);
        expect(l.overlays).toBe(0);
        expect(l.menuButtonShown).toBe(false);
        expect(l.mainLeft).toBeGreaterThanOrEqual(l.drawerRight!);
        expect(l.headerLeft).toBeGreaterThanOrEqual(l.drawerRight!);
        // 늘 열린 서랍은 탐색 랜드마크다. 모달 대화상자로 두면 스크린 리더가 본문을 막힌 곳으로 다룬다.
        const drawer = app.page.locator("#nav-drawer");
        expect(await drawer.getAttribute("role")).toBeNull();
        expect(await drawer.getAttribute("aria-modal")).toBeNull();
        expect(await app.page.getByRole("navigation", {name: "Navigation"}).isVisible()).toBe(true);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

// 다른 테스트는 좁은 화면에서 로그인한 뒤 폭을 넓힌다. 처음부터 넓은 창으로 열어도 서랍이 열려 있어야 한다.
test("a page first opened on a desktop shows the drawer without any resize (AC-1)", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize(DESKTOP);
        await app.page.goto(`${app.url}/test/shell-fixture.html#/status`);
        await app.page.getByRole("heading", {name: "Status", exact: true}).waitFor({state: "visible"});
        await waitDrawer(app.page, true);
        expect(await app.page.locator("#menu-button").count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("on a desktop the drawer stays open after moving to another screen (AC-2)", async () => {
    const app = await startAdminApp();
    try {
        await app.page.setViewportSize(DESKTOP);
        await waitDrawer(app.page, true);
        const before = await app.page.evaluate(() => location.hash);
        const other = app.page.locator("#nav-drawer .drawer-item:not([aria-current='page'])").first();
        const target = await other.getAttribute("href");
        await other.click();
        await app.page.waitForFunction((hash) => location.hash === hash, target, {timeout: 10_000});
        expect(target).not.toBe(before);
        // 화면이 바뀐 뒤에도 서랍이 그대로 보이고, 현재 항목 표시가 새 화면으로 옮겨 간다.
        await app.page.locator(`#nav-drawer .drawer-item[aria-current='page'][href='${target}']`).waitFor({state: "visible", timeout: 10_000});
        expect(await drawerVisible(app.page)).toBe(true);
    } finally {
        await app.close();
    }
});

test("on a narrow screen the drawer opens from the menu button and closes after choosing an item (AC-3)", async () => {
    const app = await startAdminApp();
    try {
        await app.page.setViewportSize(MOBILE);
        expect(await drawerVisible(app.page)).toBe(false);
        await app.page.locator("#menu-button").click();
        await waitDrawer(app.page, true);
        expect((await layout(app.page)).overlays).toBe(1);
        await app.page.locator("#nav-drawer .drawer-item:not([aria-current='page'])").first().click();
        await waitDrawer(app.page, false);
    } finally {
        await app.close();
    }
});

test("resizing between narrow and desktop shows and hides the drawer without reloading (AC-4)", async () => {
    const app = await startAdminApp();
    try {
        await app.page.setViewportSize(MOBILE);
        expect(await drawerVisible(app.page)).toBe(false);
        await app.page.setViewportSize(DESKTOP);
        await waitDrawer(app.page, true);
        await app.page.setViewportSize(MOBILE);
        await waitDrawer(app.page, false);
        expect(await app.page.locator("#menu-button").isVisible()).toBe(true);

        // 좁은 화면에서 연 채로 넓혔다가 다시 좁히면, 서랍이 저절로 다시 열려 있지 않다.
        await app.page.locator("#menu-button").click();
        await waitDrawer(app.page, true);
        await app.page.setViewportSize(DESKTOP);
        await app.page.locator("#menu-button").waitFor({state: "detached", timeout: 10_000});
        expect((await layout(app.page)).overlays).toBe(0);
        await app.page.setViewportSize(MOBILE);
        await app.page.locator("#menu-button").waitFor({state: "visible", timeout: 10_000});
        await waitDrawer(app.page, false);
        expect((await layout(app.page)).overlays).toBe(0);
        expect(await app.page.locator("#menu-button").getAttribute("aria-expanded")).toBe("false");
    } finally {
        await app.close();
    }
});

test("the forced password change screen shows no drawer even on a desktop (AC-5)", async () => {
    const app = await startAdminApp({fixture: "rbac", login: {username: "dave", password: RBAC_PASSWORDS.dave}});
    try {
        await app.page.setViewportSize(DESKTOP);
        await app.page.waitForFunction(() => location.hash === "#/me/password", undefined, {timeout: 10_000});
        // 넓은 폭이 매체 쿼리에 반영된 뒤 두 프레임을 더 기다려, 화면이 그 폭으로 다시 그려진 다음에 센다.
        await app.page.waitForFunction(() => matchMedia("(min-width: 1024px)").matches, undefined, {timeout: 10_000});
        await app.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(await app.page.locator("#nav-drawer").count()).toBe(0);
    } finally {
        await app.close();
    }
});

// 늘 열린 서랍은 키가 작은 창에서도 맨 아래 Sign out 까지 닿아야 한다.
test("on a short desktop window the drawer scrolls so its last controls stay reachable", async () => {
    const app = await startAdminApp();
    try {
        await app.page.setViewportSize({width: 1280, height: 320});
        await waitDrawer(app.page, true);
        // 목록이 실제로 창보다 길어야 이 테스트가 뜻을 가진다.
        expect(await app.page.locator("#nav-drawer ul").evaluate((list) => list.scrollHeight > list.clientHeight)).toBe(true);
        const signOut = app.page.locator("#nav-sign-out");
        await signOut.scrollIntoViewIfNeeded();
        const box = await signOut.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y + box!.height).toBeLessThanOrEqual(320);
    } finally {
        await app.close();
    }
});
