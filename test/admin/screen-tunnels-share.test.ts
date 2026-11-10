import type {Page} from "playwright";
import {startAdminApp, type AdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {RBAC_GROUP_FIELD_ID, RBAC_PASSWORDS, RBAC_USER_IDS} from "../helpers/rbacFixture";

// 이슈 347 — 켜기·끄기만 하는 그룹(toggle)과 터널 공유 칸.
// 'rbac-toggle': carol(default 그룹)은 toggle 이고, alice 의 20001 이 carol 에게 공유되어 있다. bob 의 20002 는 alice 에게 group_read 로만 보인다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

type Name = keyof typeof RBAC_PASSWORDS;

const hashIs = (page: Page, expected: string) =>
    page.waitForFunction((value) => location.hash === value, expected, {timeout: 10_000});
const button = (page: Page, name: string) => page.getByRole("button", {name, exact: true});
const card = (page: Page, port: number) => page.locator(`[data-port="${port}"]`);
const chip = (page: Page, userId: string) => page.locator(`#tunnel-share-chips [data-user-id="${userId}"]`);
const combobox = (page: Page) => page.locator("#tunnel-share-input");

const withApp = async (name: Name, hash: string, check: (app: AdminApp) => Promise<void>): Promise<void> => {
    const app = await startAdminApp({fixture: "rbac-toggle", ...(name === "admin" ? {} : {login: {username: name, password: RBAC_PASSWORDS[name]}})});
    try {
        await app.page.goto(`${app.url}${hash}`);
        await hashIs(app.page, hash);
        await check(app);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

const openEdit = async (page: Page, port: number) => {
    await card(page, port).locator("a.tunnel-link").click();
    await hashIs(page, `#/tunnels/${port}`);
    await page.locator("#input-destination-host").waitFor({state: "visible", timeout: 10_000});
};

/** 검색 결과 목록이 열리고 이름이 보일 때까지 기다린다(250ms 뒤에 검색한다). */
const waitOption = (page: Page, name: string) =>
    page.getByRole("option", {name: new RegExp(name)}).waitFor({state: "visible", timeout: 10_000});

// 화면의 <select> 도 option 역할을 가지므로 공유 목록 안의 option 만 센다.
const shareOptions = (page: Page) => page.locator('[role="listbox"][aria-label="Matching users"] [role="option"]');

test("toggle 사용자는 공유된 터널에 스위치가 있고 편집 화면 링크와 추가 버튼이 없다 (FR-12·FR-13)", () => withApp("carol", "#/tunnels", async ({page, calls}) => {
    await card(page, 20001).waitFor({state: "visible", timeout: 10_000});
    await page.waitForFunction(() => document.querySelectorAll('[data-port="20001"] [role="switch"]').length === 1, undefined, {timeout: 10_000});
    expect(await card(page, 20001).locator("a").count()).toBe(0);
    expect(await card(page, 20001).locator(".tunnel-lock").count()).toBe(0);
    expect(await card(page, 20001).locator(".tunnel-status").textContent()).not.toContain("view only");
    expect(await button(page, "Add tunneling service").count()).toBe(0);

    // 스위치로 끈다(연결이 없으므로 묻지 않는다).
    const off = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/tunneling/active/20001"
        && response.request().method() === "POST", {timeout: 10_000});
    await card(page, 20001).getByRole("switch").click();
    expect((await off).status()).toBe(200);
    expect((await calls()).filter((call) => call.method === "inactiveExternalPortServer")).toEqual([{method: "inactiveExternalPortServer", args: [20001]}]);
}));

test("toggle 사용자가 편집 화면 주소로 바로 들어가도 공유 칸과 저장 버튼이 없다 (FR-10)", () => withApp("carol", "#/tunnels/20001", async ({page}) => {
    await page.locator("#tunnel-readonly-note").waitFor({state: "visible", timeout: 10_000});
    // 켤 수는 있으므로 읽기 전용 안내 대신 켜고 끌 수 있다고 알린다.
    expect(await page.locator("#tunnel-readonly-note").textContent()).toBe("You can turn this tunnel on or off, but you can't change its settings.");
    expect(await combobox(page).count()).toBe(0);
    expect(await button(page, "Apply and Restart").count()).toBe(0);
}));

test("고칠 수 없는 남의 터널은 자물쇠이고 링크가 없으며, 내 터널은 링크가 있다 (FR-12)", () => withApp("alice", "#/tunnels", async ({page}) => {
    await card(page, 20002).locator(".tunnel-lock").waitFor({state: "visible", timeout: 10_000});
    expect(await card(page, 20002).locator("a").count()).toBe(0);
    expect(await card(page, 20001).locator("a.tunnel-link").count()).toBe(1);
    expect(await button(page, "Add tunneling service").count()).toBe(1);
}));

test("공유 칸은 키보드만으로 사용자를 더하고 빼며, 저장하면 공유 목록이 서버로 간다 (AC-9·FR-10)", () => withApp("alice", "#/tunnels", async ({page, calls}) => {
    await openEdit(page, 20001);
    // 이미 공유된 carol 은 칩으로 보인다(서버가 준 sharedUsers).
    await chip(page, RBAC_USER_IDS.carol).waitFor({state: "visible", timeout: 10_000});
    const input = combobox(page);
    expect(await input.getAttribute("role")).toBe("combobox");
    expect(await input.getAttribute("aria-expanded")).toBe("false");

    // 1자는 검색하지 않는다.
    await input.focus();
    await page.keyboard.type("b");
    await page.waitForTimeout(600);
    expect(await shareOptions(page).count()).toBe(0);

    // 2자부터 검색한다. 아래 화살표로 고르고 Enter 로 더한다.
    await page.keyboard.type("o");
    await waitOption(page, "bob");
    expect(await input.getAttribute("aria-expanded")).toBe("true");
    await page.keyboard.press("ArrowDown");
    const activeId = await input.getAttribute("aria-activedescendant");
    expect(activeId).toBe("tunnel-share-option-0");
    expect(await page.locator(`#${activeId}`).getAttribute("aria-selected")).toBe("true");
    await page.keyboard.press("Enter");
    await chip(page, RBAC_USER_IDS.bob).waitFor({state: "visible"});
    expect(await input.inputValue()).toBe("");
    expect(await input.getAttribute("aria-expanded")).toBe("false");
    // Enter 는 폼을 제출하지 않는다.
    expect(await page.evaluate(() => location.hash)).toBe("#/tunnels/20001");

    // Esc 로 목록을 닫는다.
    await page.keyboard.type("da");
    await waitOption(page, "dave");
    await page.keyboard.press("Escape");
    expect(await input.getAttribute("aria-expanded")).toBe("false");
    await input.fill("");

    // 칩의 × 버튼을 Shift+Tab 으로 찾아 Enter 로 뺀다. 칩은 입력 칸 앞에 있어 마지막 칩(bob)부터 닿는다.
    await input.focus();
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Remove bob");
    await page.keyboard.press("Enter");
    await chip(page, RBAC_USER_IDS.bob).waitFor({state: "detached"});
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Remove carol");
    await page.keyboard.press("Enter");
    await chip(page, RBAC_USER_IDS.carol).waitFor({state: "detached"});

    // 다시 bob 을 더하고 저장한다.
    await input.focus();
    await page.keyboard.type("bo");
    await waitOption(page, "bob");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await chip(page, RBAC_USER_IDS.bob).waitFor({state: "visible"});
    // fixture 의 20001 에는 신뢰 클라이언트가 없다. 일반 유저는 하나 이상 골라야 저장된다.
    await page.locator("#tunnel-trusted-client-a").check();
    const saved = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/tunnelingOption" && request.method() === "POST");
    await button(page, "Apply and Restart").click();
    const body = (await saved).postDataJSON();
    expect(body.sharedUserIds).toEqual([RBAC_USER_IDS.bob]);
    expect(body).not.toHaveProperty("sharedUsers");
    expect(body).not.toHaveProperty("toggleable");
    await hashIs(page, "#/tunnels");
    expect((await calls()).some((call) => call.method === "applyTunnelingOption")).toBe(true);
}));

test("새 터널 화면에도 공유 칸이 있고 마우스로 고를 수 있다 (FR-10)", () => withApp("alice", "#/tunnels", async ({page}) => {
    await button(page, "Add tunneling service").click();
    await hashIs(page, "#/tunnels/new");
    await combobox(page).waitFor({state: "visible", timeout: 10_000});
    await combobox(page).focus();
    await page.keyboard.type("ca");
    await waitOption(page, "carol");
    await page.getByRole("option", {name: /carol/}).click();
    await chip(page, RBAC_USER_IDS.carol).waitFor({state: "visible"});
}));

test("그룹 편집 화면의 터널 권한에 Toggle only 가 있고 저장된다 (FR-11)", () => withApp("admin", `#/groups/${RBAC_GROUP_FIELD_ID}`, async ({page}) => {
    const select = page.locator("#group-attr-tunnel_crud");
    await page.waitForFunction(() => {
        const input = document.querySelector("#group-name") as HTMLInputElement | null;
        return input !== null && input.value !== "";
    }, undefined, {timeout: 10_000});
    const options = await select.locator("option").evaluateAll((items) => items.map((item) => [(item as HTMLOptionElement).value, item.textContent]));
    expect(options).toEqual([["none", "None"], ["read_only", "Read only"], ["toggle", "Toggle only"], ["full", "Full"]]);
    await select.selectOption("toggle");
    const saved = page.waitForRequest((request) => new URL(request.url()).pathname === `/api/groups/${RBAC_GROUP_FIELD_ID}` && request.method() === "PUT");
    await button(page, "Save").click();
    expect((await saved).postDataJSON().attributes.tunnel_crud).toBe("toggle");
}));
