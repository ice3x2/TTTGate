import type {Page} from "playwright";
import {startAdminApp, type AdminApp} from "../helpers/adminApp";
import {RBAC_USER_IDS} from "../helpers/rbacFixture";

// U3-03 / #105 — 사용자 목록·편집 화면과 임시 비밀번호 모달. admin 으로 시작하고, 테스트마다 rbac fixture 로 앱을 새로 띄운다.
jest.setTimeout(120_000);

const ADMIN_ID = RBAC_USER_IDS.admin;
const ALICE_ID = RBAC_USER_IDS.alice;
const BOB_ID = RBAC_USER_IDS.bob;
const CAROL_ID = RBAC_USER_IDS.carol;
const DAVE_ID = RBAC_USER_IDS.dave;

const hashIs = (page: Page, expected: string | RegExp) =>
    page.waitForFunction(({exact, pattern}) => exact !== null ? location.hash === exact : new RegExp(pattern).test(location.hash),
        typeof expected === "string" ? {exact: expected, pattern: ""} : {exact: null, pattern: expected.source}, {timeout: 10_000});

const cards = (page: Page) => page.locator("li[data-user-id]");
const card = (page: Page, id: string) => page.locator(`li[data-user-id="${id}"]`);
const button = (page: Page, name: string) => page.getByRole("button", {name, exact: true});

const withUsers = async (check: (app: AdminApp) => Promise<void>): Promise<void> => {
    const app = await startAdminApp({fixture: "rbac"});
    try {
        await app.page.goto(`${app.url}#/users`);
        await hashIs(app.page, "#/users");
        await card(app.page, ADMIN_ID).waitFor({state: "visible", timeout: 10_000});
        await check(app);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

const openUser = async (page: Page, id: string) => {
    await card(page, id).locator("a").click();
    await hashIs(page, `#/users/${id}`);
    // 입력란이 생기기 전에는 조건이 참이 되지 않게 요소부터 확인한다.
    await page.waitForFunction(() => {
        const input = document.querySelector("#user-username") as HTMLInputElement | null;
        return input !== null && input.value !== "";
    }, undefined, {timeout: 10_000});
};

const backToList = async (page: Page) => {
    await page.locator('[aria-label="Back"]').click();
    await hashIs(page, "#/users");
    await card(page, ADMIN_ID).waitFor({state: "visible", timeout: 10_000});
};

const newUser = async (page: Page) => {
    await button(page, "Add user").click();
    await hashIs(page, "#/users/new");
    await page.locator("#user-username").waitFor({state: "visible", timeout: 10_000});
};

test("#/users 는 사용자 카드 5개를 보이고 역할·상태·그룹·임시 비밀번호 표시가 있다", () => withUsers(async ({page}) => {
    expect(await cards(page).count()).toBe(5);
    const admin = (await card(page, ADMIN_ID).textContent()) ?? "";
    for(const text of ["Admin", "superuser", "active", "@admin · Superusers"]) expect(admin).toContain(text);
    expect(await card(page, DAVE_ID).textContent()).toContain("temp password");
    expect(await card(page, ALICE_ID).textContent()).not.toContain("temp password");
}));

test("필터는 이름·그룹의 부분 일치로 카드를 거르고, 비면 모두 보인다", () => withUsers(async ({page}) => {
    const filter = page.locator("#users-filter");
    await filter.fill("field");
    await page.waitForFunction(() => document.querySelectorAll("li[data-user-id]").length === 3);
    for(const id of [ALICE_ID, BOB_ID, DAVE_ID]) expect(await card(page, id).count()).toBe(1);
    await filter.fill("zzz");
    await page.getByText("No users match.", {exact: true}).waitFor({state: "visible"});
    expect(await cards(page).count()).toBe(0);
    await filter.fill("");
    await page.waitForFunction(() => document.querySelectorAll("li[data-user-id]").length === 5);
}));

test("alice 카드를 열면 값이 채워지고 Save 는 비활성이며 Back 으로 목록에 돌아간다", () => withUsers(async ({page}) => {
    await openUser(page, ALICE_ID);
    const username = page.locator("#user-username");
    expect(await username.inputValue()).toBe("alice");
    expect(await username.isDisabled()).toBe(true);
    expect(await page.locator("#user-display-name").inputValue()).toBe("Alice");
    expect(await page.locator("#user-role").inputValue()).toBe("regular");
    expect(await page.locator("#user-group").inputValue()).toBe("g_0000000000000001");
    expect(await page.locator("#user-status").inputValue()).toBe("active");
    expect(await button(page, "Save").isDisabled()).toBe(true);
    await backToList(page);
}));

test("Add user 는 편집 가능한 이름과 자동 생성 임시 비밀번호로 시작한다", () => withUsers(async ({page}) => {
    await newUser(page);
    expect(await page.locator("#user-username").isDisabled()).toBe(false);
    expect(await page.locator("#user-status").count()).toBe(0);
    expect(await page.locator("#user-temp-auto").isChecked()).toBe(true);
    expect(await page.locator("#user-temp-password").count()).toBe(0);
}));

test("erin 을 만들면 임시 비밀번호를 한 번 보이고, Done 뒤 편집 화면과 목록에 반영된다", () => withUsers(async ({page}) => {
    await newUser(page);
    await page.locator("#user-username").fill("erin");
    await page.locator("#user-display-name").fill("Erin");
    await page.locator("#user-role").selectOption("regular");
    await page.locator("#user-group").selectOption("g_0000000000000001");
    await button(page, "Create user").click();
    const shownUsername = page.locator("#temp-password-username");
    await shownUsername.waitFor({state: "visible", timeout: 10_000});
    expect(await shownUsername.textContent()).toBe("@erin");
    expect(await page.locator("#temp-password-value").textContent()).toMatch(/^[A-Za-z0-9]{16}$/);
    await button(page, "Done").click();
    await hashIs(page, /^#\/users\/u_[0-9a-f]{16}$/);
    // 새 사용자 폼에도 erin 이 들어 있으므로, 편집 화면으로 바뀐 것(이름 비활성)까지 함께 기다린다.
    await page.waitForFunction(() => {
        const input = document.querySelector("#user-username") as HTMLInputElement | null;
        return input !== null && input.value === "erin" && input.disabled;
    }, undefined, {timeout: 10_000});
    // 모달이 닫히면 비밀번호도 DOM 에서 사라진다.
    expect(await page.locator("#temp-password-value").count()).toBe(0);
    await backToList(page);
    expect(await cards(page).count()).toBe(6);
    const erin = page.locator("li[data-user-id]").filter({hasText: "@erin"});
    const text = (await erin.textContent()) ?? "";
    expect(text).toContain("temp password");
    expect(text).toContain("@erin · Field team");
}));

test("직접 정한 임시 비밀번호는 8자 이상이어야 하고, 그 값이 그대로 보인다", () => withUsers(async ({page}) => {
    await newUser(page);
    await page.locator("#user-username").fill("frank");
    await page.locator("#user-temp-auto").uncheck();
    const password = page.locator("#user-temp-password");
    await password.waitFor({state: "visible"});
    await password.fill("short");
    await button(page, "Create user").click();
    await page.getByText("Use at least 8 characters.", {exact: true}).waitFor({state: "visible"});
    await password.fill("manual-pass-1234");
    await button(page, "Create user").click();
    await page.locator("#temp-password-username").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#temp-password-username").textContent()).toBe("@frank");
    expect(await page.locator("#temp-password-value").textContent()).toBe("manual-pass-1234");
}));

test("형식이 틀린 이름은 요청 없이 막고, 이미 있는 이름은 서버 오류 문구를 보인다", () => withUsers(async ({page}) => {
    await newUser(page);
    await page.locator("#user-username").fill("AB");
    await button(page, "Create user").click();
    await page.getByText("Username must be 3–32 chars, lowercase letters, digits, . _ -", {exact: true}).waitFor({state: "visible"});
    expect(await page.evaluate(() => location.hash)).toBe("#/users/new");

    await page.locator("#user-username").fill("alice");
    await button(page, "Create user").click();
    const error = page.locator("#user-form-error");
    await error.waitFor({state: "visible", timeout: 10_000});
    expect(await error.textContent()).toBe("That username is already in use.");
    expect(await page.evaluate(() => location.hash)).toBe("#/users/new");
}));

test("alice 를 superuser 로 바꾸면 그룹 선택이 사라지고 저장 뒤 목록에 Superusers 로 보인다", () => withUsers(async ({page}) => {
    await openUser(page, ALICE_ID);
    await page.locator("#user-role").selectOption("superuser");
    await page.locator("#user-group").waitFor({state: "detached"});
    await button(page, "Save").click();
    await page.getByText("User saved.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await backToList(page);
    const text = (await card(page, ALICE_ID).textContent()) ?? "";
    expect(text).toContain("superuser");
    expect(text).toContain("@alice · Superusers");
}));

test("bob 을 disabled 로 저장하면 목록 카드에 disabled 가 보인다", () => withUsers(async ({page}) => {
    await openUser(page, BOB_ID);
    await page.locator("#user-status").selectOption("disabled");
    await button(page, "Save").click();
    await page.getByText("User saved.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await backToList(page);
    expect(await card(page, BOB_ID).textContent()).toContain("disabled");
}));

test("마지막 슈퍼유저는 강등도 비활성화도 할 수 없다", () => withUsers(async ({page}) => {
    await openUser(page, ADMIN_ID);
    await page.locator("#user-role").selectOption("regular");
    const group = page.locator("#user-group");
    await group.waitFor({state: "visible"});
    expect(await group.inputValue()).toBe("default");
    await button(page, "Save").click();
    const error = page.locator("#user-form-error");
    await error.filter({hasText: "At least one active superuser must remain."}).waitFor({state: "visible", timeout: 10_000});

    await page.locator("#user-role").selectOption("superuser");
    await page.locator("#user-status").selectOption("disabled");
    await button(page, "Save").click();
    // 같은 문구가 다시 나오는지 보려고 저장 응답을 기다린다.
    await page.waitForResponse((response) => response.request().method() === "PUT", {timeout: 10_000}).catch(() => undefined);
    await error.filter({hasText: "At least one active superuser must remain."}).waitFor({state: "visible", timeout: 10_000});
}));

test("터널을 가진 alice 는 지울 수 없고, carol 은 지워진다", () => withUsers(async ({page}) => {
    await openUser(page, ALICE_ID);
    await button(page, "Delete").click();
    await button(page, "Delete user").click();
    await page.getByText("Reassign this user's tunnels first.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    expect(await page.evaluate(() => location.hash)).toBe(`#/users/${ALICE_ID}`);

    await backToList(page);
    await openUser(page, CAROL_ID);
    await button(page, "Delete").click();
    await button(page, "Delete user").click();
    await page.getByText("User deleted.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await hashIs(page, "#/users");
    await page.waitForFunction(() => document.querySelectorAll("li[data-user-id]").length === 4, undefined, {timeout: 10_000});
}));

test("bob 의 비밀번호를 초기화하면 새 임시 비밀번호를 보이고 목록에 temp password 가 붙는다", () => withUsers(async ({page}) => {
    await openUser(page, BOB_ID);
    await button(page, "Reset password").click();
    await page.getByRole("dialog").filter({hasText: "@bob"}).waitFor({state: "visible"});
    await button(page, "Issue password").click();
    const value = page.locator("#temp-password-value");
    await value.waitFor({state: "visible", timeout: 10_000});
    expect((await value.textContent())?.length).toBe(16);
    await button(page, "Done").click();
    await value.waitFor({state: "detached"});
    expect(await page.evaluate(() => location.hash)).toBe(`#/users/${BOB_ID}`);
    await backToList(page);
    expect(await card(page, BOB_ID).textContent()).toContain("temp password");
}));

/** UI 로 두 번째 슈퍼유저를 만들고 그 편집 화면(#/users/<id>)에 머문다. */
const createSuperuser = async (page: Page, username: string): Promise<string> => {
    await newUser(page);
    await page.locator("#user-username").fill(username);
    await page.locator("#user-role").selectOption("superuser");
    await page.locator("#user-group").waitFor({state: "detached"});
    await button(page, "Create user").click();
    await page.locator("#temp-password-value").waitFor({state: "visible", timeout: 10_000});
    await button(page, "Done").click();
    await hashIs(page, /^#\/users\/u_[0-9a-f]{16}$/);
    await page.waitForFunction((name) => {
        const input = document.querySelector("#user-username") as HTMLInputElement | null;
        return input !== null && input.value === name && input.disabled;
    }, username, {timeout: 10_000});
    return (await page.evaluate(() => location.hash)).slice("#/users/".length);
};

test("슈퍼유저를 일반 유저로 내리면 고른 그룹으로 옮겨진다", () => withUsers(async ({page}) => {
    const id = await createSuperuser(page, "sam");
    await page.locator("#user-role").selectOption("regular");
    await page.locator("#user-group").selectOption("g_0000000000000001");
    await button(page, "Save").click();
    await page.getByText("User saved.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await backToList(page);
    const text = (await card(page, id).textContent()) ?? "";
    expect(text).toContain("regular");
    expect(text).toContain("@sam · Field team");
}));

test("admin 이 자기 역할을 내리면 403 없이 새 기본 화면으로 가고 드로어에서 관리 항목이 빠진다", () => withUsers(async ({page}) => {
    await createSuperuser(page, "sam");
    await backToList(page);
    const denied: string[] = [];
    page.on("response", (response) => { if(response.status() === 403) denied.push(new URL(response.url()).pathname); });
    await openUser(page, ADMIN_ID);
    await page.locator("#user-role").selectOption("regular");
    await page.locator("#user-group").waitFor({state: "visible"});
    await button(page, "Save").click();
    await hashIs(page, "#/tunnels");
    await page.getByRole("button", {name: "Open menu"}).click();
    const dialog = page.locator('[role=dialog][aria-label="Navigation"]');
    await dialog.waitFor({state: "visible"});
    expect(await dialog.locator(".drawer-item").allTextContents()).not.toContain("Users");
    expect(denied).toEqual([]);
}));

test("임시 비밀번호 모달을 Escape 로 닫아도 Done 과 같이 처리한다", () => withUsers(async ({page}) => {
    // 생성 뒤 Escape: 새 사용자 편집 화면으로 간다.
    await newUser(page);
    await page.locator("#user-username").fill("gina");
    await button(page, "Create user").click();
    await page.locator("#temp-password-value").waitFor({state: "visible", timeout: 10_000});
    await page.keyboard.press("Escape");
    await hashIs(page, /^#\/users\/u_[0-9a-f]{16}$/);
    await page.locator("#temp-password-value").waitFor({state: "detached"});

    // 초기화 뒤 Escape: 화면에 머물고 사용자를 한 번 다시 읽는다.
    await backToList(page);
    await openUser(page, BOB_ID);
    let reloads = 0;
    page.on("request", (request) => {
        if(request.method() === "GET" && new URL(request.url()).pathname === `/api/users/${BOB_ID}`) reloads++;
    });
    await button(page, "Reset password").click();
    await button(page, "Issue password").click();
    await page.locator("#temp-password-value").waitFor({state: "visible", timeout: 10_000});
    await page.keyboard.press("Escape");
    await page.locator("#temp-password-value").waitFor({state: "detached"});
    await page.waitForResponse((response) => new URL(response.url()).pathname === `/api/users/${BOB_ID}`, {timeout: 10_000}).catch(() => undefined);
    await page.waitForTimeout(500);
    expect(reloads).toBe(1);
    expect(await page.evaluate(() => location.hash)).toBe(`#/users/${BOB_ID}`);
}));

test("표시 이름을 비워도 변경으로 보지 않아 Save 가 비활성이다", () => withUsers(async ({page}) => {
    await openUser(page, ALICE_ID);
    await page.locator("#user-display-name").fill("");
    expect(await button(page, "Save").isDisabled()).toBe(true);
}));

test("사용자 편집 화면의 Sessions 행은 세션 수를 보이고 모두 끊을 수 있다", async () => {
    const app = await startAdminApp({fixture: "rbac", extraLogins: [{as: "alice", userAgent: "UA-ALICE-1"}, {as: "alice", userAgent: "UA-ALICE-2"}]});
    try {
        const {page} = app;
        await page.goto(`${app.url}#/users/${ALICE_ID}`);
        const count = page.locator("#user-session-count");
        await count.filter({hasText: "2 active session(s)"}).waitFor({state: "visible", timeout: 10_000});
        await page.locator("#user-end-sessions button").click();
        await page.locator(".end-all-modal").waitFor({state: "visible"});
        await page.locator("#confirm-end-all").click();
        await page.getByText("Ended 2 session(s).", {exact: true}).waitFor({state: "visible", timeout: 10_000});
        await count.filter({hasText: "0 active session(s)"}).waitFor({state: "visible", timeout: 10_000});
        expect(await page.locator("#user-end-sessions button").isDisabled()).toBe(true);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});
