import type {Page} from "playwright";
import {startAdminApp, type AdminApp} from "../helpers/adminApp";

// U5-06 / #121 — 보안 화면(국가 필터·차단 목록). 슈퍼유저 admin 으로 시작하고, 테스트마다 rbac fixture 로 앱을 새로 띄운다.
jest.setTimeout(120_000);

const hashIs = (page: Page, expected: string) =>
    page.waitForFunction((value) => location.hash === value, expected, {timeout: 10_000});

const withSecurity = async (check: (app: AdminApp) => Promise<void>): Promise<void> => {
    const app = await startAdminApp({fixture: "rbac"});
    try {
        await check(app);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

const goSecurity = async (page: Page, url: string) => {
    await page.goto(`${url}#/security`);
    await hashIs(page, "#/security");
    await page.locator("#geo-mode").waitFor({state: "visible", timeout: 10_000});
    await page.waitForFunction(() => document.querySelectorAll("#geo-country-list input").length > 0, undefined, {timeout: 10_000});
};

const toast = (page: Page, text: string | RegExp) => page.locator(".toasts").getByText(text).first();

test("드로어의 Security 는 #/security 로 가고, 처음에는 필터가 꺼져 있고 차단이 없다", () => withSecurity(async ({page}) => {
    await page.getByRole("button", {name: "Open menu"}).click();
    const dialog = page.locator('[role=dialog][aria-label="Navigation"]');
    await dialog.waitFor({state: "visible"});
    await dialog.getByText("Security", {exact: true}).click();
    await hashIs(page, "#/security");
    await page.locator("header h1").filter({hasText: /^Security$/}).waitFor({state: "visible", timeout: 10_000});
    await page.locator("#geo-mode").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#geo-mode").inputValue()).toBe("off");
    // 로드 직후에는 바뀐 것이 없으므로 저장할 수 없다.
    expect(await page.locator("#geo-save").isDisabled()).toBe(true);
    await page.locator("#ban-empty").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#ban-empty").textContent()).toBe("No banned addresses.");
}));

test("allow 모드는 국가가 있어야 저장되고, 저장한 값은 새로 읽어도 남으며 칩을 빼면 다시 막힌다", () => withSecurity(async ({page, url}) => {
    await goSecurity(page, url);
    await page.locator("#geo-mode").selectOption("allow");
    expect(await page.locator("#geo-save").isDisabled()).toBe(true);
    expect(await page.locator("#geo-error").textContent()).toBe("Allow mode requires at least one country.");

    const total = await page.locator("#geo-country-list input").count();
    await page.locator("#geo-country-filter").fill("kor");
    await page.locator("#geo-country-KR").waitFor({state: "visible"});
    expect(await page.locator("#geo-country-list input").count()).toBeLessThan(total);
    await page.locator("#geo-country-KR").check();
    await page.locator("#geo-selected").getByText("KR", {exact: true}).waitFor({state: "visible"});
    expect(await page.locator("#geo-save").isEnabled()).toBe(true);

    await page.locator("#geo-unknown-policy").selectOption("deny");
    expect(await page.locator("#geo-apply-admin").isChecked()).toBe(true);
    await page.locator("#geo-save").click();
    await toast(page, "Country filter saved.").waitFor({state: "visible", timeout: 10_000});
    await toast(page, /^unknownPolicy=deny with applyToAdmin=true/).waitFor({state: "visible", timeout: 10_000});

    await page.reload();
    await page.locator("#geo-mode").waitFor({state: "visible", timeout: 10_000});
    await page.waitForFunction(() => (document.querySelector("#geo-mode") as HTMLSelectElement | null)?.value === "allow", undefined, {timeout: 10_000});
    await page.locator("#geo-selected").getByText("KR", {exact: true}).waitFor({state: "visible", timeout: 10_000});

    await page.locator('[aria-label="Remove KR"]').click();
    await page.locator("#geo-selected").getByText("KR", {exact: true}).waitFor({state: "detached"});
    expect(await page.locator("#geo-save").isDisabled()).toBe(true);
    expect(await page.locator("#geo-error").textContent()).toBe("Allow mode requires at least one country.");
}));

test("필터를 끄고 저장하면 저장 토스트만 뜨고 경고는 없다", () => withSecurity(async ({page, url}) => {
    await goSecurity(page, url);
    await page.locator("#geo-mode").selectOption("deny");
    await page.locator("#geo-country-filter").fill("kor");
    await page.locator("#geo-country-KR").check();
    await page.locator("#geo-save").click();
    await toast(page, "Country filter saved.").waitFor({state: "visible", timeout: 10_000});
    await page.locator(".toasts").getByRole("button", {name: "Dismiss"}).evaluateAll((buttons) => buttons.forEach((button) => (button as HTMLButtonElement).click()));

    await page.locator("#geo-mode").selectOption("off");
    const saved = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/security/geo" && response.request().method() === "PUT");
    await page.locator("#geo-save").click();
    const body = await (await saved).json();
    expect(body.warnings).toEqual([]);
    await toast(page, "Country filter saved.").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator(".toasts .warn").count()).toBe(0);
}));

test("차단된 주소는 표에 보이고 Unban 으로 풀린다", () => withSecurity(async (app) => {
    const {page} = app;
    await app.seedBan(20001, "203.0.113.9");
    await goSecurity(page, app.url);
    const row = page.locator('#ban-table tr[data-ban="20001/203.0.113.9"]');
    await row.waitFor({state: "visible", timeout: 10_000});
    expect(await row.textContent()).toContain("203.0.113.9");
    // 남은 시간은 서버 시각 기준으로 1초마다 줄어든다.
    const remainingText = async () => (await row.locator("td").nth(3).textContent()) ?? "";
    const seconds = (text: string) => { const [m, sec] = text.split(":").map(Number); return m * 60 + sec; };
    const before = await remainingText();
    await page.waitForFunction((value) => document.querySelector('#ban-table tr[data-ban="20001/203.0.113.9"] td:nth-child(4)')?.textContent !== value,
        before, {timeout: 5_000});
    expect(seconds(await remainingText())).toBeLessThan(seconds(before));
    await row.getByRole("button", {name: "Unban", exact: true}).click();
    await toast(page, "Unbanned 203.0.113.9.").waitFor({state: "visible", timeout: 10_000});
    await page.locator("#ban-empty").waitFor({state: "visible", timeout: 10_000});
}));
