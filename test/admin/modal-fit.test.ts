import type {Page} from "playwright";
import {startAdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {startAdminBrowser} from "../helpers/adminBrowser";

// #277 — 긴 모달은 화면 높이의 85% 안에서 가운데에 놓이고, 본문만 안에서 스크롤한다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const openSysinfo = async (page: Page) => {
    await page.waitForFunction(() => document.querySelectorAll(".gauge-msg").length >= 2, undefined, {timeout: 30_000});
    await page.getByRole("button", {name: "INFO", exact: true}).click();
    const dialog = page.getByRole("dialog", {name: "System info"});
    await dialog.getByRole("heading", {name: "Network", exact: true}).waitFor({state: "visible", timeout: 10_000});
    return dialog;
};

/** 모달·본문·오버레이·OK 버튼의 크기와 위치. */
const measure = (page: Page) => page.evaluate(() => {
    const modal = document.querySelector(".modal") as HTMLElement;
    const body = modal.querySelector(".modal-body") as HTMLElement;
    const overlay = document.querySelector(".modal-overlay") as HTMLElement;
    const ok = Array.from(modal.querySelectorAll("button")).find((button) => button.textContent?.trim() === "OK") as HTMLElement;
    const box = modal.getBoundingClientRect();
    const okBox = ok.getBoundingClientRect();
    return {
        viewport: window.innerHeight,
        top: box.top, bottom: window.innerHeight - box.bottom, height: box.height,
        bodyScroll: body.scrollHeight, bodyClient: body.clientHeight,
        overlayScroll: overlay.scrollHeight, overlayClient: overlay.clientHeight,
        okTop: okBox.top, okBottom: okBox.bottom,
    };
});

test("a long modal stays within 85% of the viewport, centred, with only its body scrolling (AC-1·AC-2)", async () => {
    const app = await startAdminApp();
    try {
        await app.page.setViewportSize({width: 400, height: 480});
        await openSysinfo(app.page);
        const m = await measure(app.page);
        expect(m.height).toBeLessThanOrEqual(m.viewport * 0.85 + 1);
        expect(Math.abs(m.top - m.bottom)).toBeLessThanOrEqual(2);
        expect(m.bodyScroll).toBeGreaterThan(m.bodyClient);
        expect(m.overlayScroll).toBeLessThanOrEqual(m.overlayClient);
        expect(m.okTop).toBeGreaterThanOrEqual(0);
        expect(m.okBottom).toBeLessThanOrEqual(m.viewport);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("scrolling the modal body reaches its last item (AC-3)", async () => {
    const app = await startAdminApp();
    try {
        await app.page.setViewportSize({width: 400, height: 480});
        const dialog = await openSysinfo(app.page);
        await app.page.evaluate(() => {
            const body = document.querySelector(".modal .modal-body") as HTMLElement;
            body.scrollTop = body.scrollHeight;
        });
        const last = dialog.locator("dd").last();
        const inView = await last.evaluate((element) => {
            const body = (element.closest(".modal-body") as HTMLElement).getBoundingClientRect();
            const box = element.getBoundingClientRect();
            return box.top >= body.top - 1 && box.bottom <= body.bottom + 1;
        });
        expect(inView).toBe(true);
    } finally {
        await app.close();
    }
});

test("a short modal keeps its natural height and is centred (REQ-4)", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}/test/ui-fixture.html`);
        await app.page.getByRole("button", {name: "Open modal", exact: true}).click();
        await app.page.getByRole("dialog", {name: "Fixture modal"}).waitFor({state: "visible", timeout: 10_000});
        const m = await app.page.evaluate(() => {
            const modal = document.querySelector(".modal") as HTMLElement;
            const body = modal.querySelector(".modal-body") as HTMLElement;
            const box = modal.getBoundingClientRect();
            return {viewport: window.innerHeight, top: box.top, bottom: window.innerHeight - box.bottom, height: box.height,
                bodyScroll: body.scrollHeight, bodyClient: body.clientHeight};
        });
        // 내용만큼의 높이를 쓰고 스크롤하지 않으며, 세로 가운데에 놓인다.
        expect(m.bodyScroll).toBeLessThanOrEqual(m.bodyClient);
        expect(m.height).toBeLessThan(m.viewport * 0.5);
        expect(Math.abs(m.top - m.bottom)).toBeLessThanOrEqual(2);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

// 리뷰: 화면이 아주 낮으면(확대 등) 85% 안에 제목·버튼줄도 다 들어가지 않는다. 그때는 페이지 스크롤로 버튼에 닿게 한다.
test("on a very short viewport the modal buttons stay reachable by scrolling the page", async () => {
    const app = await startAdminApp();
    try {
        await app.page.setViewportSize({width: 400, height: 200});
        const dialog = await openSysinfo(app.page);
        const ok = dialog.getByRole("button", {name: "OK", exact: true});
        await ok.scrollIntoViewIfNeeded();
        const box = await ok.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(200);
        await ok.click();
        await dialog.waitFor({state: "detached", timeout: 10_000});
    } finally {
        await app.close();
    }
});

// 리뷰: 본문 끝까지 스크롤한 뒤에도 뒤 페이지로 스크롤이 넘어가지 않는다.
test("scrolling past the end of the modal body does not scroll the page behind", async () => {
    const app = await startAdminApp();
    try {
        await app.page.setViewportSize({width: 400, height: 480});
        await openSysinfo(app.page);
        expect(await app.page.locator(".modal .modal-body").evaluate((body) => getComputedStyle(body).overscrollBehaviorY)).toBe("contain");
    } finally {
        await app.close();
    }
});
