import type {Page} from "playwright";
import {startAdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";

// 이슈 368 — 켜 둘 시간 창. 상한별 범위·단위 버튼·"자동으로 끄지 않기"·고정 값·360px.
// 적용 상한은 상태 응답(/api/externalServerStatuses)의 timeoutCapSeconds 를 바꿔 준다. 서버 계산은 관리 API 테스트가 맡는다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const PORT = 20002;

const withCap = async (page: Page, cap: number | null) => {
    await page.route("**/api/externalServerStatuses", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        const statuses = (body.statuses as Array<Record<string, unknown>>).map((status) => status.port === PORT
            ? {...status, active: true, activeStart: body.serverTime, activeTimeout: 3600, timeoutCapSeconds: cap} : status);
        await route.fulfill({response, json: {...body, statuses}});
    });
};

const openDialog = async (page: Page, url: string) => {
    await page.goto(`${url}#/tunnels/${PORT}`);
    const timer = page.locator("#tunnel-status-area .timer-text");
    await timer.waitFor({state: "visible", timeout: 10_000});
    await timer.click();
    const dialog = page.getByRole("dialog", {name: "Keep it on for"});
    await dialog.waitFor({state: "visible", timeout: 10_000});
    return dialog;
};

const visible = (locator: ReturnType<Page["locator"]>) => locator.evaluateAll((elements) =>
    elements.some((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden"));

test("AC-1 상한이 없으면 단위 버튼·슬라이더·'자동으로 끄지 않기'가 보이고 숫자 칸이 없다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, null);
        const dialog = await openDialog(app.page, app.url);
        expect(await dialog.locator("input[type=number]").count()).toBe(0);
        expect(await dialog.getByRole("button", {name: "Hours", exact: true}).isVisible()).toBe(true);
        expect(await dialog.getByRole("button", {name: "Days", exact: true}).isVisible()).toBe(true);
        expect(await dialog.getByRole("slider", {name: "Keep it on for"}).isVisible()).toBe(true);
        expect(await visible(dialog.getByRole("switch", {name: "Don't turn off automatically", exact: true}))).toBe(true);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-2·AC-10 상한 12시간이면 단위 버튼과 '자동으로 끄지 않기'가 화면에 보이지 않고 슬라이더 최댓값이 720분이다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, 12 * 3600);
        const dialog = await openDialog(app.page, app.url);
        expect(await dialog.getByRole("button", {name: "Days", exact: true}).count()).toBe(0);
        expect(await visible(dialog.locator(".no-auto"))).toBe(false);
        expect(await dialog.getByRole("slider", {name: "Keep it on for"}).getAttribute("max")).toBe("720");
        expect((await dialog.locator(".cap-note").textContent())?.trim()).toBe("This tunnel can stay on for up to 12 h.");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-4·AC-11 화살표는 1분, −/+ 도 1분씩이고 끝에서 잠기며, 값 글자는 n분·n시간 m분이다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, 2 * 3600);
        const dialog = await openDialog(app.page, app.url);
        const slider = dialog.getByRole("slider", {name: "Keep it on for"});
        const value = () => dialog.locator(".value").textContent().then((text) => text?.trim());
        await slider.focus();
        await slider.press("Home");
        expect(await value()).toBe("1 min");
        expect(await dialog.getByRole("button", {name: "Shorter", exact: true}).isDisabled()).toBe(true);
        for(let i = 0; i < 58; i++) await slider.press("ArrowRight");
        expect(await value()).toBe("59 min");
        await dialog.getByRole("button", {name: "Longer", exact: true}).click();
        expect(await value()).toBe("1 h");
        expect(await slider.getAttribute("aria-valuetext")).toBe("1 h");
        await slider.press("End");
        expect(await value()).toBe("2 h");
        expect(await dialog.getByRole("button", {name: "Longer", exact: true}).isDisabled()).toBe(true);
        await slider.press("PageDown");
        expect(await value()).toBe("1 h");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-3·AC-12 상한 1일 12시간이면 일 단위에서 슬라이더 대신 '1 day' 가 고정으로 보인다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, 36 * 3600);
        const dialog = await openDialog(app.page, app.url);
        await dialog.getByRole("button", {name: "Days", exact: true}).click();
        expect((await dialog.locator(".value").textContent())?.trim()).toBe("1 day");
        expect(await dialog.getByRole("slider").count()).toBe(0);
        expect(await dialog.locator(".fixed-note").isVisible()).toBe(true);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-5·AC-6 남은 시간으로 열고, 값을 바꾸지 않고 확인해도 그 초가 timeout 으로 나간다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, null);
        const dialog = await openDialog(app.page, app.url);
        // 상태 응답은 지금 켜고 1시간(3600초)을 걸었다고 꾸민다. 남은 시간 60분으로 열린다(초가 지나 59분일 수 있다).
        expect(await dialog.locator(".value").textContent()).toMatch(/^(1 h|59 min)$/);
        const posted = app.page.waitForResponse((response) => response.request().method() === "POST"
            && new URL(response.url()).pathname === `/api/tunneling/active/${PORT}`, {timeout: 10_000});
        await dialog.getByRole("button", {name: "OK", exact: true}).click();
        const body = (await posted).request().postDataJSON();
        expect(body.active).toBe(true);
        expect([3540, 3600]).toContain(body.timeout);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-9 폭 360px 에서 창에 가로 스크롤이 없다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await app.page.setViewportSize({width: 360, height: 800});
        await withCap(app.page, null);
        const dialog = await openDialog(app.page, app.url);
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await app.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});
