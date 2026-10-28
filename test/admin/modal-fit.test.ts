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

// 화면이 아주 낮으면(확대 등) 85% 안에 제목·본문 여백·버튼줄이 다 들어가지 않는다(약 205px 미만). 그때는 페이지 스크롤로 버튼에 닿게 한다.
test("on a very short viewport the modal buttons stay reachable by scrolling the page", async () => {
    const app = await startAdminApp();
    try {
        await app.page.setViewportSize({width: 400, height: 140});
        const dialog = await openSysinfo(app.page);
        // 처음 열었을 때 제목이 실제로 보인다. 모달이 초점 이동 때문에 안쪽으로 밀려 제목을 가리면 안 된다.
        const headingVisible = await dialog.getByRole("heading", {name: "System info"}).evaluate((heading) => {
            const box = heading.getBoundingClientRect();
            return box.top >= 0 && heading.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
        });
        expect(headingVisible).toBe(true);
        // 아주 낮은 화면에서는 화면 밖의 버튼이 아니라 대화상자 자체에 초점을 준다. 보이지 않는 곳에 초점을 두지 않는다.
        expect(await app.page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("dialog");
        const ok = dialog.getByRole("button", {name: "OK", exact: true});
        // 사용자처럼 휠로 끝까지 내린다. scrollIntoView 는 overflow: hidden 인 요소도 코드로 움직여 잘림을 가린다.
        await app.page.mouse.move(200, 70);
        for(let i = 0; i < 20; i++) await app.page.mouse.wheel(0, 400);
        await app.page.waitForFunction(() => {
            const overlay = document.querySelector(".modal-overlay") as HTMLElement;
            return overlay.scrollTop + overlay.clientHeight >= overlay.scrollHeight - 1;
        }, undefined, {timeout: 10_000});
        // boundingBox 는 잘림을 보지 않는다. 버튼의 위·아래 끝 지점에 실제로 버튼이 그려져 있는지 본다.
        const edges = await ok.evaluate((button) => {
            const box = button.getBoundingClientRect();
            const x = box.left + box.width / 2;
            const at = (y: number) => button.contains(document.elementFromPoint(x, y));
            return {top: at(box.top + 1), bottom: at(box.bottom - 1), inViewport: box.top >= 0 && box.bottom <= window.innerHeight};
        });
        expect(edges).toEqual({top: true, bottom: true, inViewport: true});
        await ok.click();
        await dialog.waitFor({state: "detached", timeout: 10_000});
    } finally {
        await app.close();
    }
});

// 본문 끝까지 스크롤한 뒤에도 뒤 페이지로 스크롤이 넘어가지 않는다.
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

// 보통 높이의 화면에서는 모달을 열 때 첫 초점 대상이 본문 아래쪽에 있어도 보이게 한다(키보드 사용자의 초점 표시).
test("on a normal viewport the first focused control inside a long body is scrolled into view", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 480});
        await app.page.goto(`${app.url}/test/ui-fixture.html`);
        await app.page.getByRole("button", {name: "Open tall modal", exact: true}).click();
        const action = app.page.getByRole("button", {name: "Body action", exact: true});
        await app.page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Body action", undefined, {timeout: 10_000});
        const inBody = await action.evaluate((button) => {
            const body = (button.closest(".modal-body") as HTMLElement).getBoundingClientRect();
            const box = button.getBoundingClientRect();
            return box.top >= body.top - 1 && box.bottom <= body.bottom + 1;
        });
        expect(inBody).toBe(true);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

// 85% 규칙을 푸는 경계는 240px 이다. 그보다 높으면 85% 안에서 본문만 스크롤하고, 그 이하면 페이지(오버레이)를 스크롤한다.
test.each([[260, false], [230, true]] as const)("at %ipx the overlay scrolls: %s (boundary 240px)", async (height, overlayScrolls) => {
    const app = await startAdminApp();
    try {
        await app.page.setViewportSize({width: 400, height});
        await openSysinfo(app.page);
        const m = await measure(app.page);
        expect(m.overlayScroll > m.overlayClient).toBe(overlayScrolls);
        if(!overlayScrolls) expect(m.height).toBeLessThanOrEqual(m.viewport * 0.85 + 1);
        // 낮은 화면 규칙과 초점 규칙이 같은 경계를 쓴다. 제목이 보이고, 초점은 대화상자에 있다.
        const low = await app.page.evaluate(() => {
            const heading = document.querySelector(".modal-head .ttl") as HTMLElement;
            const box = heading.getBoundingClientRect();
            return {
                headingVisible: box.top >= 0 && heading.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)),
                dialogFocused: document.activeElement?.getAttribute("role") === "dialog",
                overscroll: getComputedStyle(document.querySelector(".modal-overlay")!).overscrollBehaviorY,
                modalOverflow: getComputedStyle(document.querySelector(".modal")!).overflowY,
            };
        });
        expect(low.headingVisible).toBe(true);
        expect(low.dialogFocused).toBe(overlayScrolls);
        expect(low.modalOverflow).toBe("hidden");
        if(overlayScrolls) expect(low.overscroll).toBe("contain");
    } finally {
        await app.close();
    }
});

// 낮은 화면에서도 내용이 짧은 모달은 가운데에 놓인다. 넘칠 때만 위에서 시작한다.
test("on a low viewport a short modal stays centred", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 230});
        await app.page.goto(`${app.url}/test/ui-fixture.html`);
        await app.page.getByRole("button", {name: "Open tiny modal", exact: true}).click();
        await app.page.getByRole("dialog", {name: "Tiny fixture modal"}).waitFor({state: "visible", timeout: 10_000});
        const m = await app.page.evaluate(() => {
            const modal = document.querySelector(".modal") as HTMLElement;
            const overlay = modal.parentElement as HTMLElement;
            const box = modal.getBoundingClientRect();
            return {top: box.top, bottom: window.innerHeight - box.bottom, fits: overlay.scrollHeight <= overlay.clientHeight};
        });
        // 이 모달은 230px 에 들어간다. 들어가는데도 위에 붙으면 가운데 정렬 규칙이 깨진 것이다.
        expect(m.fits).toBe(true);
        expect(Math.abs(m.top - m.bottom)).toBeLessThanOrEqual(2);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});
