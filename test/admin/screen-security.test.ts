import type {Page} from "playwright";
import {startAdminApp, type AdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";

// U5-06 / #121 — 보안 화면(국가 필터·차단 목록). 슈퍼유저 admin 으로 시작하고, 테스트마다 rbac fixture 로 앱을 새로 띄운다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

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

// #153 — 불러오지 못한 국가 필터를 초기값(off)으로 저장하면 서버의 필터가 꺼진다. 불러오기 전에는 편집·저장을 막는다.
test("국가 필터를 불러오지 못하면 편집과 Save 가 막히고, Retry 로 불러온 뒤에야 저장할 수 있다", () => withSecurity(async ({page, url}) => {
    let failGeo = true;
    await page.route("**/api/security/geo", async (route) => {
        if(failGeo && route.request().method() === "GET") {
            await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({success: false, message: "Temporary failure."})});
            return;
        }
        await route.continue();
    });
    await page.goto(`${url}#/security`);
    await hashIs(page, "#/security");
    await page.locator("#geo-retry").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#geo-apply-admin").isDisabled()).toBe(true);
    expect(await page.locator("#geo-mode").isDisabled()).toBe(true);
    expect(await page.locator("#geo-save").isDisabled()).toBe(true);

    failGeo = false;
    await page.locator("#geo-retry").click();
    await page.locator("#geo-retry").waitFor({state: "detached", timeout: 10_000});
    expect(await page.locator("#geo-apply-admin").isDisabled()).toBe(false);
    await page.locator("#geo-apply-admin").uncheck();
    expect(await page.locator("#geo-save").isDisabled()).toBe(false);
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

// #286 — 관리자 차단 목록.
test("차단 목록에 주소를 넣으면 표에 보이고 새로 읽어도 남으며, Unblock 으로 풀린다", () => withSecurity(async ({page, url}) => {
    await goSecurity(page, url);
    await page.locator("#block-empty").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#block-empty").textContent()).toBe("No blocked addresses.");
    expect(await page.locator("#block-count").textContent()).toBe("0 / 1,000");
    expect(await page.locator("#block-submit").isDisabled()).toBe(true);

    // 틀린 주소는 저장하지 않고 서버가 준 이유를 입력란 아래에 보여 준다.
    await page.locator("#block-address").fill("0.0.0.0/0");
    await page.locator("#block-submit").click();
    await page.locator("#block-error").getByText("a range that covers every address cannot be blocked").waitFor({state: "visible", timeout: 10_000});
    // 다시 입력하면 오류를 지운다.
    await page.locator("#block-address").fill("198.51.100.9/24");
    expect(await page.locator("#block-error").count()).toBe(0);

    await page.locator("#block-applies-to").selectOption("20001");
    await page.locator("#block-note").fill("scanner");
    await page.locator("#block-submit").click();
    await toast(page, "Blocked 198.51.100.0/24.").waitFor({state: "visible", timeout: 10_000});
    const row = page.locator('#block-table tr[data-block="198.51.100.0/24"]');
    await row.waitFor({state: "visible", timeout: 10_000});
    const text = await row.textContent();
    expect(text).toContain("Port 20001");
    expect(text).toContain("scanner");
    expect(text).toContain("admin");
    expect(await page.locator("#block-address").inputValue()).toBe("");
    expect(await page.locator("#block-note").inputValue()).toBe("");
    expect(await page.locator("#block-count").textContent()).toBe("1 / 1,000");

    // 같은 주소는 서버가 거절한다(포트가 달라도 같다).
    await page.locator("#block-address").fill("198.51.100.0/24");
    await page.locator("#block-submit").click();
    await page.locator("#block-error").getByText("198.51.100.0/24 is already blocked").waitFor({state: "visible", timeout: 10_000});

    await page.reload();
    await row.waitFor({state: "visible", timeout: 10_000});
    await row.getByRole("button", {name: "Unblock", exact: true}).click();
    await toast(page, "Unblocked 198.51.100.0/24.").waitFor({state: "visible", timeout: 10_000});
    await page.locator("#block-empty").waitFor({state: "visible", timeout: 10_000});
}));

test("일시 차단 행의 Block permanently 는 확인을 거쳐 주소를 차단 목록으로 옮기고 일시 차단을 푼다", () => withSecurity(async (app) => {
    const {page} = app;
    await app.seedBan(20001, "203.0.113.9");
    await goSecurity(page, app.url);
    const banRow = page.locator('#ban-table tr[data-ban="20001/203.0.113.9"]');
    await banRow.waitFor({state: "visible", timeout: 10_000});
    const dialog = page.locator("[role=dialog]").filter({hasText: "203.0.113.9"});

    // 취소하면 아무것도 바뀌지 않는다.
    await banRow.getByRole("button", {name: "Block permanently", exact: true}).click();
    await dialog.waitFor({state: "visible", timeout: 10_000});
    expect(await dialog.textContent()).toContain("on all tunnels");
    await dialog.getByRole("button", {name: "Cancel", exact: true}).click();
    await dialog.waitFor({state: "detached", timeout: 10_000});
    expect(await page.locator("#block-empty").isVisible()).toBe(true);
    expect(await banRow.isVisible()).toBe(true);

    await banRow.getByRole("button", {name: "Block permanently", exact: true}).click();
    await dialog.getByRole("button", {name: "Block permanently", exact: true}).click();
    await toast(page, "Blocked 203.0.113.9 permanently.").waitFor({state: "visible", timeout: 10_000});
    const row = page.locator('#block-table tr[data-block="203.0.113.9"]');
    await row.waitFor({state: "visible", timeout: 10_000});
    expect(await row.textContent()).toContain("All tunnels");
    expect(await row.textContent()).toContain("From rate-limit ban on 20001");
    await page.locator("#ban-empty").waitFor({state: "visible", timeout: 10_000});
}));

test("차단 목록이 가득 차면 Block 이 꺼지고 이유를 보여 준다", () => withSecurity(async ({page, url}) => {
    await page.route("**/api/security/blocklist", async (route) => {
        if(route.request().method() !== "GET") {
            await route.continue();
            return;
        }
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({success: true, limit: 1,
            entries: [{address: "203.0.113.1", port: null, note: "", createdAt: Date.now(), createdBy: "admin"}]})});
    });
    await goSecurity(page, url);
    await page.locator('#block-table tr[data-block="203.0.113.1"]').waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#block-count").textContent()).toBe("1 / 1");
    await page.locator("#block-address").fill("203.0.113.7");
    expect(await page.locator("#block-submit").isDisabled()).toBe(true);
    expect(await page.locator("#block-full").textContent()).toBe("The blocklist is full. Unblock an address to add another.");
}));

test("이미 All tunnels 로 막힌 주소를 Block permanently 로 옮기면 already blocked 를 알린다 (REQ-5 AC-3)", () => withSecurity(async (app) => {
    const {page} = app;
    await goSecurity(page, app.url);
    await page.locator("#block-address").fill("203.0.113.9");
    await page.locator("#block-submit").click();
    await page.locator('#block-table tr[data-block="203.0.113.9"]').waitFor({state: "visible", timeout: 10_000});
    await app.seedBan(20001, "203.0.113.9");
    await page.reload();
    const banRow = page.locator('#ban-table tr[data-ban="20001/203.0.113.9"]');
    await banRow.waitFor({state: "visible", timeout: 10_000});
    await banRow.getByRole("button", {name: "Block permanently", exact: true}).click();
    await page.locator("[role=dialog]").getByRole("button", {name: "Block permanently", exact: true}).click();
    await toast(page, "203.0.113.9 is already blocked on all tunnels").waitFor({state: "visible", timeout: 10_000});
    // 이미 영구 차단된 주소의 일시 차단은 서버가 풀었으므로 표에서도 사라진다.
    await page.locator("#ban-empty").waitFor({state: "visible", timeout: 10_000});
}));

test("목록이 가득 차면 Block permanently 확인 창이 그 사실을 미리 알린다", () => withSecurity(async (app) => {
    const {page} = app;
    await page.route("**/api/security/blocklist", async (route) => {
        if(route.request().method() !== "GET") {
            await route.continue();
            return;
        }
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({success: true, limit: 1,
            entries: [{address: "203.0.113.1", port: null, note: "", createdAt: Date.now(), createdBy: "admin"}]})});
    });
    await app.seedBan(20001, "203.0.113.9");
    await goSecurity(page, app.url);
    const banRow = page.locator('#ban-table tr[data-ban="20001/203.0.113.9"]');
    await banRow.waitFor({state: "visible", timeout: 10_000});
    await banRow.getByRole("button", {name: "Block permanently", exact: true}).click();
    const dialog = page.locator("[role=dialog]").filter({hasText: "203.0.113.9"});
    await dialog.waitFor({state: "visible", timeout: 10_000});
    expect(await dialog.locator("#promote-full").textContent())
        .toBe("The blocklist is full. This works only if the address is already blocked on one tunnel.");
}));
