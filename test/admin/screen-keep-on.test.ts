import type {Locator, Page} from "playwright";
import {startAdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";

// 이슈 368 — 켜 둘 시간 창. 상한별 범위·단위 버튼·"자동으로 끄지 않기"·고정 값·360px.
// 적용 상한은 상태 응답(/api/externalServerStatuses)의 timeoutCapSeconds 를 바꿔 준다. 서버 계산은 관리 API 테스트가 맡는다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const PORT = 20002;
const HOUR = 3600;
const DAY = 86_400;
/** 상태 응답은 2시간을 걸고 30분 전에 켰다고 꾸민다. 창을 열 때 남은 시간은 1시간 30분이다. */
const ACTIVE_TIMEOUT = 2 * HOUR;
const STARTED_AGO_MS = 30 * 60_000;

/**
 * 상태 응답을 꾸민다. activeStart 는 첫 응답의 서버 시각으로 한 번만 정한다.
 * 그래야 폴링마다 남은 시간이 실제처럼 줄어든다(검토 C-1: 줄어드는 남은 시간이 고른 값을 되돌리지 않는지 본다).
 */
const withCap = async (page: Page, cap: number | null) => {
    let activeStart: number | undefined;
    await page.route("**/api/externalServerStatuses", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        activeStart ??= body.serverTime - STARTED_AGO_MS;
        const statuses = (body.statuses as Array<Record<string, unknown>>).map((status) => status.port === PORT
            ? {...status, active: true, activeStart, activeTimeout: ACTIVE_TIMEOUT, timeoutCapSeconds: cap} : status);
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

const visible = (locator: Locator) => locator.evaluateAll((elements) =>
    elements.some((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden"));
const textOf = (locator: Locator) => locator.textContent().then((text) => text?.trim());
const isFocused = (locator: Locator) => locator.evaluate((element) => element === document.activeElement);
/** FR-20: 꺼지는 시각은 시:분, 오늘이 아니면 월/일을 붙인다. "ends" 는 붙지 않는다(검토 H-1). */
const endsSentence = (duration: string) => new RegExp(`^Turns off at (\\d{1,2}/\\d{1,2} )?\\d{2}:\\d{2} \\(${duration} from now\\)\\.$`);

test("AC-1 상한이 없으면 단위 버튼·슬라이더·'자동으로 끄지 않기'가 보이고 숫자 칸이 없다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, null);
        const dialog = await openDialog(app.page, app.url);
        expect(await dialog.locator("input[type=number]").count()).toBe(0);
        expect(await dialog.getByRole("radiogroup", {name: "Unit"}).isVisible()).toBe(true);
        expect(await dialog.getByRole("radio", {name: "Hours", exact: true}).isVisible()).toBe(true);
        expect(await dialog.getByRole("radio", {name: "Days", exact: true}).isVisible()).toBe(true);
        expect(await dialog.getByRole("slider", {name: "Keep it on for"}).isVisible()).toBe(true);
        expect(await visible(dialog.getByRole("switch", {name: "Don't turn off automatically", exact: true}))).toBe(true);
        expect(await dialog.locator(".cap-note").count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test.each([
    [2 * HOUR, "2 h"],
    [12 * HOUR, "12 h"],
    [DAY + 12 * HOUR, "1 day 12 h"],
    [3 * DAY, "3 days"],
])("AC-10 상한 %i 초면 '자동으로 끄지 않기'가 화면에 보이지 않고, 상한 안내는 '%s' 다", async (cap, label) => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, cap);
        const dialog = await openDialog(app.page, app.url);
        expect(await visible(dialog.getByRole("switch", {name: "Don't turn off automatically", exact: true}))).toBe(false);
        expect(await visible(dialog.locator(".no-auto"))).toBe(false);
        expect(await textOf(dialog.locator(".cap-note"))).toBe(`This tunnel can stay on for up to ${label}.`);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-2 상한 12시간이면 단위 버튼이 없고 슬라이더 최댓값이 720분이며, 양 끝 글자는 1 min·12 h 다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, 12 * HOUR);
        const dialog = await openDialog(app.page, app.url);
        expect(await dialog.getByRole("radio").count()).toBe(0);
        expect(await dialog.getByRole("slider", {name: "Keep it on for"}).getAttribute("max")).toBe("720");
        expect(await dialog.locator(".scale span").allTextContents()).toEqual(["1 min", "12 h"]);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-3 상한 3일이면 일 단위에서 1~3일을, 시간 단위에서 1분~24시간을 고른다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, 3 * DAY);
        const dialog = await openDialog(app.page, app.url);
        const slider = dialog.getByRole("slider", {name: "Keep it on for"});
        expect([await slider.getAttribute("min"), await slider.getAttribute("max")]).toEqual(["1", "1440"]);
        expect(await dialog.locator(".scale span").allTextContents()).toEqual(["1 min", "24 h"]);
        await dialog.getByRole("radio", {name: "Days", exact: true}).click();
        expect(await dialog.getByRole("radio", {name: "Days", exact: true}).getAttribute("aria-checked")).toBe("true");
        expect([await slider.getAttribute("min"), await slider.getAttribute("max")]).toEqual(["1", "3"]);
        expect(await dialog.locator(".scale span").allTextContents()).toEqual(["1 day", "3 days"]);
        await slider.focus();
        await slider.press("End");
        expect(await textOf(dialog.locator(".value"))).toBe("3 days");
        // FR-10: 일 → 시간은 24시간이다.
        await dialog.getByRole("radio", {name: "Hours", exact: true}).click();
        expect(await textOf(dialog.locator(".value"))).toBe("24 h");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-4·AC-11 화살표는 1분, −/+ 도 1분씩이고 끝에서 잠기며 초점이 슬라이더로 옮겨 간다. 값 글자는 n분·n시간 m분이다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, 2 * HOUR);
        const dialog = await openDialog(app.page, app.url);
        const slider = dialog.getByRole("slider", {name: "Keep it on for"});
        const value = () => textOf(dialog.locator(".value"));
        const less = dialog.getByRole("button", {name: "1 min shorter", exact: true});
        const more = dialog.getByRole("button", {name: "1 min longer", exact: true});
        await slider.focus();
        await slider.press("Home");
        expect(await value()).toBe("1 min");
        expect(await less.isDisabled()).toBe(true);
        for(let i = 0; i < 58; i++) await slider.press("ArrowRight");
        expect(await value()).toBe("59 min");
        await more.click();
        expect(await value()).toBe("1 h");
        expect(await slider.getAttribute("aria-valuetext")).toBe("1 h");
        await less.click();
        expect(await value()).toBe("59 min");
        await slider.press("End");
        await slider.press("ArrowLeft");
        expect(await value()).toBe("1 h 59 min");
        await more.focus();
        await more.press("Enter");
        expect(await value()).toBe("2 h");
        expect(await more.isDisabled()).toBe(true);
        expect(await isFocused(slider)).toBe(true);
        await slider.press("PageDown");
        expect(await value()).toBe("1 h");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-11 일 단위의 −/+ 는 1일씩이고 끝에서 잠긴다. PageUp·PageDown 도 1일이다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, 3 * DAY);
        const dialog = await openDialog(app.page, app.url);
        await dialog.getByRole("radio", {name: "Days", exact: true}).click();
        const value = () => textOf(dialog.locator(".value"));
        const less = dialog.getByRole("button", {name: "1 day shorter", exact: true});
        const more = dialog.getByRole("button", {name: "1 day longer", exact: true});
        expect(await value()).toBe("1 day");
        expect(await less.isDisabled()).toBe(true);
        await more.click();
        expect(await value()).toBe("2 days");
        await more.click();
        expect(await value()).toBe("3 days");
        expect(await more.isDisabled()).toBe(true);
        await less.click();
        expect(await value()).toBe("2 days");
        const slider = dialog.getByRole("slider", {name: "Keep it on for"});
        await slider.focus();
        await slider.press("PageUp");
        expect(await value()).toBe("3 days");
        await slider.press("PageDown");
        expect(await value()).toBe("2 days");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("단위 버튼은 radiogroup 이고 화살표로 바꾼다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, null);
        const dialog = await openDialog(app.page, app.url);
        const hours = dialog.getByRole("radio", {name: "Hours", exact: true});
        const days = dialog.getByRole("radio", {name: "Days", exact: true});
        expect(await hours.getAttribute("aria-checked")).toBe("true");
        await hours.focus();
        await hours.press("ArrowRight");
        expect(await days.getAttribute("aria-checked")).toBe("true");
        expect(await isFocused(days)).toBe(true);
        expect(await days.getAttribute("tabindex")).toBe("0");
        expect(await hours.getAttribute("tabindex")).toBe("-1");
        // 누르는 영역은 44px 이상이다(FR-17).
        expect(await days.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-12 상한 1일 12시간이면 일 단위에서 슬라이더 대신 '1 day' 가 고정으로 보이고 이유를 적는다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, DAY + 12 * HOUR);
        const dialog = await openDialog(app.page, app.url);
        await dialog.getByRole("radio", {name: "Days", exact: true}).click();
        expect(await textOf(dialog.locator(".value"))).toBe("1 day");
        expect(await dialog.getByRole("slider").count()).toBe(0);
        expect(await textOf(dialog.locator(".fixed-note"))).toBe("In days, only 1 day is possible.");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("FR-20 고른 값 바로 아래에 꺼지는 시각 문장이 있고, 슬라이더가 그 문장으로 설명된다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, null);
        const dialog = await openDialog(app.page, app.url);
        const slider = dialog.getByRole("slider", {name: "Keep it on for"});
        await slider.focus();
        await slider.press("Home");
        const ends = dialog.locator(".ends");
        expect(await textOf(ends)).toMatch(endsSentence("1 min"));
        expect(await slider.getAttribute("aria-describedby")).toBe(await ends.getAttribute("id"));
        // 값은 실시간 영역이 아니다(aria-valuetext 와 두 번 읽히지 않게 한다).
        expect(await dialog.locator(".value").getAttribute("aria-live")).toBeNull();
        // 순서: 값 → 꺼지는 시각 → 슬라이더 줄.
        expect(await dialog.locator(".value + .ends + .slider-row").count()).toBe(1);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("검토 C-1 창을 연 동안 남은 시간이 줄어도 고른 값·단위·스위치가 되돌아가지 않는다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, null);
        const dialog = await openDialog(app.page, app.url);
        const slider = dialog.getByRole("slider", {name: "Keep it on for"});
        const value = () => textOf(dialog.locator(".value"));
        await slider.focus();
        await slider.press("Home");
        expect(await value()).toBe("1 min");
        // 상태는 1초마다 다시 읽는다. 두 번 넘게 읽을 동안 기다린다.
        await app.page.waitForTimeout(2_500);
        expect(await value()).toBe("1 min");

        await dialog.getByRole("radio", {name: "Days", exact: true}).click();
        expect(await value()).toBe("1 day");
        await app.page.waitForTimeout(2_500);
        expect(await dialog.getByRole("radio", {name: "Days", exact: true}).getAttribute("aria-checked")).toBe("true");
        expect(await value()).toBe("1 day");

        const noAuto = dialog.getByRole("switch", {name: "Don't turn off automatically", exact: true});
        await noAuto.click();
        expect(await noAuto.getAttribute("aria-checked")).toBe("true");
        await app.page.waitForTimeout(2_500);
        expect(await noAuto.getAttribute("aria-checked")).toBe("true");
        expect(await value()).toBe("Stays on");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-5·AC-6 남은 시간(1시간 30분)으로 열고, 값을 바꾸지 않고 확인해도 그 초가 timeout 으로 나간다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await withCap(app.page, null);
        const dialog = await openDialog(app.page, app.url);
        // 2시간을 걸고 30분 전에 켰으므로 남은 시간 90분으로 열린다(초가 지나 89분일 수 있다).
        expect(await dialog.getByRole("radio", {name: "Hours", exact: true}).getAttribute("aria-checked")).toBe("true");
        expect(await textOf(dialog.locator(".value"))).toMatch(/^1 h (30|29) min$/);
        const posted = app.page.waitForResponse((response) => response.request().method() === "POST"
            && new URL(response.url()).pathname === `/api/tunneling/active/${PORT}`, {timeout: 10_000});
        await dialog.getByRole("button", {name: "OK", exact: true}).click();
        const body = (await posted).request().postDataJSON();
        expect(body.active).toBe(true);
        expect([5340, 5400]).toContain(body.timeout);
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
