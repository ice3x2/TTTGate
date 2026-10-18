import type {Page} from "playwright";
import {startAdminApp, type AdminApp} from "../helpers/adminApp";
import {RBAC_GROUP_FIELD_ID} from "../helpers/rbacFixture";

// U3-04 / #106 — 그룹 목록·편집 화면과 속성 11종. admin 으로 시작하고, 테스트마다 rbac fixture 로 앱을 새로 띄운다.
jest.setTimeout(120_000);

const hashIs = (page: Page, expected: string | RegExp) =>
    page.waitForFunction(({exact, pattern}) => exact !== null ? location.hash === exact : new RegExp(pattern).test(location.hash),
        typeof expected === "string" ? {exact: expected, pattern: ""} : {exact: null, pattern: expected.source}, {timeout: 10_000});

const cards = (page: Page) => page.locator("li[data-group-id]");
const card = (page: Page, id: string) => page.locator(`li[data-group-id="${id}"]`);
const button = (page: Page, name: string) => page.getByRole("button", {name, exact: true});
const attr = (page: Page, key: string) => page.locator(`#group-attr-${key}`);

const withGroups = async (check: (app: AdminApp) => Promise<void>): Promise<void> => {
    const app = await startAdminApp({fixture: "rbac"});
    try {
        await app.page.goto(`${app.url}#/groups`);
        await hashIs(app.page, "#/groups");
        await card(app.page, "default").waitFor({state: "visible", timeout: 10_000});
        await check(app);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

const openGroup = async (page: Page, id: string) => {
    await card(page, id).locator("a").click();
    await hashIs(page, `#/groups/${id}`);
    await page.waitForFunction(() => {
        const input = document.querySelector("#group-name") as HTMLInputElement | null;
        return input !== null && input.value !== "";
    }, undefined, {timeout: 10_000});
};

const newGroup = async (page: Page) => {
    await button(page, "Add group").click();
    await hashIs(page, "#/groups/new");
    // 신뢰 클라이언트 목록까지 읽힌 뒤에 입력한다.
    await attr(page, "allowed_trusted_clients-client-a").waitFor({state: "visible", timeout: 10_000});
};

const waitForEdit = async (page: Page) => {
    await hashIs(page, /^#\/groups\/g_[0-9a-f]{16}$/);
    await page.waitForFunction(() => {
        const input = document.querySelector("#group-name") as HTMLInputElement | null;
        return input !== null && input.value !== "" && document.querySelector("#group-attr-allowed_trusted_clients-client-a") !== null;
    }, undefined, {timeout: 10_000});
};

test("#/groups 는 그룹 카드 3개와 멤버 수·속성 요약을 보인다", () => withGroups(async ({page}) => {
    expect(await cards(page).count()).toBe(3);
    const superusers = (await card(page, "system:superuser").textContent()) ?? "";
    for(const text of ["Superusers", "system", "Members: 1", "Superusers are not limited by attributes."]) expect(superusers).toContain(text);
    const field = (await card(page, RBAC_GROUP_FIELD_ID).textContent()) ?? "";
    for(const text of ["Field team", "Members: 3", "crud=full · tunnels≤2 · ports 20000-20099 · TCP,HTTP,HTTP_REWRITE"]) expect(field).toContain(text);
    const defaults = (await card(page, "default").textContent()) ?? "";
    expect(defaults).toContain("Members: 1");
    expect(defaults).toContain("ports none");
}));

test("Add group 은 기본값과 신뢰 클라이언트 선택지로 시작한다", () => withGroups(async ({page}) => {
    // #155 — 신뢰 클라이언트 id 만 필요하므로 비밀값이 든 서버 옵션 전체를 받지 않는다.
    const serverOptionReads: string[] = [];
    const bodies: string[] = [];
    page.on("request", (request) => { if(new URL(request.url()).pathname === "/api/serverOption") serverOptionReads.push(request.url()); });
    page.on("response", async (response) => { if(new URL(response.url()).pathname.startsWith("/api/")) bodies.push(await response.text().catch(() => "")); });
    await newGroup(page);
    expect(await attr(page, "max_tunnel_count").inputValue()).toBe("10");
    expect(await attr(page, "tunnel_crud").inputValue()).toBe("full");
    expect(await attr(page, "allowed_protocols-TCP").isChecked()).toBe(false);
    expect(await attr(page, "http_tunnel_rewrite_permissions-cors").isDisabled()).toBe(true);
    // Checkbox 는 label 이 input 을 감싼다(for 속성 없음).
    expect((await page.locator("label:has(#group-attr-allowed_trusted_clients-client-a)").textContent())?.trim()).toBe("Client A");
    expect((await page.locator("label:has(#group-attr-allowed_trusted_clients-client-b)").textContent())?.trim()).toBe("Client B");
    expect(serverOptionReads).toEqual([]);
    expect(bodies.join("\n")).not.toContain("clientSecret");
}));

test("새 그룹의 속성 11종은 저장 뒤 새로 읽어도 그대로이고 목록 요약에 반영된다", () => withGroups(async ({page}) => {
    await newGroup(page);
    await page.locator("#group-name").fill("Lab");
    await attr(page, "tunnel_crud").selectOption("read_only");
    await attr(page, "max_tunnel_count").fill("5");
    await attr(page, "max_tunnel_duration_ms").fill("12");
    await button(page, "Add range").click();
    await attr(page, "allowed_port_range-0-from").fill("30000");
    await attr(page, "allowed_port_range-0-to").fill("30010");
    for(const protocol of ["HTTP", "HTTPS", "HTTP_REWRITE"]) await attr(page, `allowed_protocols-${protocol}`).check();
    await attr(page, "http_tunnel_rewrite_permissions-cors").check();
    await attr(page, "http_tunnel_rewrite_permissions-body").check();
    await attr(page, "allowed_trusted_clients-client-b").check();
    await attr(page, "max_concurrent_connections").fill("50");
    await attr(page, "rate_limit").selectOption("10MB/s");
    await attr(page, "admin_ui_section_access-my_audit").uncheck();
    await attr(page, "admin_ui_section_access-my_sessions").uncheck();
    await attr(page, "tunnel_visibility").selectOption("group_read");
    const created = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/groups" && request.method() === "POST");
    await button(page, "Create group").click();
    // 체크박스 목록은 표 순서대로 배열이 된다(누른 순서와 무관하다).
    const body = (await created).postDataJSON();
    expect(body.attributes.allowed_protocols).toEqual(["HTTP", "HTTPS", "HTTP_REWRITE"]);
    expect(body.attributes.admin_ui_section_access).toEqual(["tunnels", "my_profile"]);
    expect(body.attributes.max_tunnel_duration_ms).toBe(12 * 3_600_000);
    expect(body.attributes.rate_limit).toBe("10MB/s");
    await waitForEdit(page);

    await page.reload();
    await waitForEdit(page);
    expect(await page.locator("#group-name").inputValue()).toBe("Lab");
    expect(await attr(page, "tunnel_crud").inputValue()).toBe("read_only");
    expect(await attr(page, "max_tunnel_count").inputValue()).toBe("5");
    expect(await attr(page, "max_tunnel_duration_ms").inputValue()).toBe("12");
    expect(await attr(page, "allowed_port_range-0-from").inputValue()).toBe("30000");
    expect(await attr(page, "allowed_port_range-0-to").inputValue()).toBe("30010");
    expect(await attr(page, "allowed_protocols-TCP").isChecked()).toBe(false);
    for(const protocol of ["HTTP", "HTTPS", "HTTP_REWRITE"]) expect(await attr(page, `allowed_protocols-${protocol}`).isChecked()).toBe(true);
    expect(await attr(page, "http_tunnel_rewrite_permissions-cors").isChecked()).toBe(true);
    expect(await attr(page, "http_tunnel_rewrite_permissions-host").isChecked()).toBe(false);
    expect(await attr(page, "http_tunnel_rewrite_permissions-header").isChecked()).toBe(false);
    expect(await attr(page, "http_tunnel_rewrite_permissions-body").isChecked()).toBe(true);
    expect(await attr(page, "allowed_trusted_clients-client-a").isChecked()).toBe(false);
    expect(await attr(page, "allowed_trusted_clients-client-b").isChecked()).toBe(true);
    expect(await attr(page, "max_concurrent_connections").inputValue()).toBe("50");
    expect(await attr(page, "rate_limit").inputValue()).toBe("10MB/s");
    expect(await attr(page, "admin_ui_section_access-tunnels").isChecked()).toBe(true);
    expect(await attr(page, "admin_ui_section_access-my_audit").isChecked()).toBe(false);
    expect(await attr(page, "admin_ui_section_access-my_profile").isChecked()).toBe(true);
    expect(await attr(page, "admin_ui_section_access-my_sessions").isChecked()).toBe(false);
    expect(await attr(page, "tunnel_visibility").inputValue()).toBe("group_read");

    await page.locator('[aria-label="Back"]').click();
    await hashIs(page, "#/groups");
    await page.waitForFunction(() => document.querySelectorAll("li[data-group-id]").length === 4, undefined, {timeout: 10_000});
    const lab = page.locator("li[data-group-id]").filter({hasText: "Lab"});
    expect(await lab.textContent()).toContain("crud=read_only · tunnels≤5 · ports 30000-30010 · HTTP,HTTPS,HTTP_REWRITE");
}));

test("서버 정합성 오류(HTTP rewrite 단독, from > to)는 폼 오류로 보이고 화면에 남는다", () => withGroups(async ({page}) => {
    await newGroup(page);
    await page.locator("#group-name").fill("Bad");
    await attr(page, "allowed_protocols-HTTP_REWRITE").check();
    await button(page, "Create group").click();
    const error = page.locator("#group-form-error[role=alert]");
    await error.waitFor({state: "visible", timeout: 10_000});
    expect((await error.textContent())?.trim()).not.toBe("");
    expect(await page.evaluate(() => location.hash)).toBe("#/groups/new");

    await attr(page, "allowed_protocols-HTTP_REWRITE").uncheck();
    await page.locator("#group-name").fill("Bad2");
    await button(page, "Add range").click();
    await attr(page, "allowed_port_range-0-from").fill("40000");
    await attr(page, "allowed_port_range-0-to").fill("30000");
    // 앞 오류가 남아 있으므로 두 번째 POST 응답을 기다린 뒤 다시 본다.
    const responded = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/groups" && response.request().method() === "POST",
        {timeout: 10_000});
    await button(page, "Create group").click();
    expect((await responded).status()).toBe(422);
    await error.waitFor({state: "visible", timeout: 10_000});
    expect((await error.textContent())?.trim()).not.toBe("");
    expect(await page.evaluate(() => location.hash)).toBe("#/groups/new");
}));

test("이름이 비면 요청 없이 Enter a group name. 을 보인다", () => withGroups(async ({page}) => {
    await newGroup(page);
    await button(page, "Create group").click();
    await page.getByText("Enter a group name.", {exact: true}).waitFor({state: "visible"});
}));

test("HTTP rewrite 를 끄면 리라이트 권한이 비활성화되고 해제된다", () => withGroups(async ({page}) => {
    await newGroup(page);
    const rewrite = attr(page, "allowed_protocols-HTTP_REWRITE");
    const cors = attr(page, "http_tunnel_rewrite_permissions-cors");
    await rewrite.check();
    expect(await cors.isDisabled()).toBe(false);
    await cors.check();
    await rewrite.uncheck();
    await page.waitForFunction(() => (document.querySelector("#group-attr-http_tunnel_rewrite_permissions-cors") as HTMLInputElement).disabled);
    expect(await cors.isChecked()).toBe(false);
}));

test("Superusers 그룹은 읽기 전용이고 저장·삭제 버튼이 없다", () => withGroups(async ({page}) => {
    const requests: string[] = [];
    page.on("request", (request) => { if(request.method() !== "GET") requests.push(`${request.method()} ${new URL(request.url()).pathname}`); });
    await openGroup(page, "system:superuser");
    await page.locator("#group-readonly-note").waitFor({state: "visible"});
    for(const selector of ["#group-name", "#group-attr-tunnel_crud", "#group-attr-max_tunnel_count"]) {
        expect(await page.locator(selector).isDisabled()).toBe(true);
    }
    expect(await attr(page, "max_tunnel_count").inputValue()).toBe("10");
    expect(await button(page, "Save").count()).toBe(0);
    expect(await button(page, "Delete").count()).toBe(0);
    expect(requests).toEqual([]);
}));

test("Default 그룹은 이름만 잠기고 속성 저장이 새로 읽은 뒤에도 남는다", () => withGroups(async ({page}) => {
    await openGroup(page, "default");
    expect(await page.locator("#group-name").isDisabled()).toBe(true);
    expect(await attr(page, "max_tunnel_count").isDisabled()).toBe(false);
    expect(await button(page, "Delete").count()).toBe(0);
    await attr(page, "max_tunnel_count").fill("7");
    await button(page, "Save").click();
    await page.getByText("Group saved.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await page.reload();
    await page.waitForFunction(() => (document.querySelector("#group-attr-max_tunnel_count") as HTMLInputElement | null)?.value === "7",
        undefined, {timeout: 10_000});
}));

test("멤버가 있는 그룹은 지울 수 없고, 새로 만든 빈 그룹은 지워진다", () => withGroups(async ({page}) => {
    await openGroup(page, RBAC_GROUP_FIELD_ID);
    await button(page, "Delete").click();
    await button(page, "Delete group").click();
    await page.getByText("Move the members to another group first.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    expect(await page.evaluate(() => location.hash)).toBe(`#/groups/${RBAC_GROUP_FIELD_ID}`);

    await page.goto(`${page.url().split("#")[0]}#/groups`);
    await card(page, "default").waitFor({state: "visible", timeout: 10_000});
    await newGroup(page);
    await page.locator("#group-name").fill("Temp");
    await button(page, "Create group").click();
    await waitForEdit(page);
    await button(page, "Delete").click();
    await button(page, "Delete group").click();
    await page.getByText("Group deleted.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await hashIs(page, "#/groups");
    await page.waitForFunction(() => document.querySelectorAll("li[data-group-id]").length === 3, undefined, {timeout: 10_000});
}));

test("기존 그룹에서 기간만 바꿔도 저장할 수 있고 새로 읽은 뒤 그 값이다", () => withGroups(async ({page}) => {
    await openGroup(page, RBAC_GROUP_FIELD_ID);
    expect(await button(page, "Save").isDisabled()).toBe(true);
    await attr(page, "max_tunnel_duration_ms").fill("3");
    expect(await button(page, "Save").isEnabled()).toBe(true);
    await button(page, "Save").click();
    await page.getByText("Group saved.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await page.reload();
    await page.waitForFunction(() => (document.querySelector("#group-attr-max_tunnel_duration_ms") as HTMLInputElement | null)?.value === "3",
        undefined, {timeout: 10_000});
}));

test("빈 숫자 입력은 0 으로 저장한다", () => withGroups(async ({page}) => {
    await newGroup(page);
    await page.locator("#group-name").fill("Zero");
    await attr(page, "max_tunnel_count").fill("");
    await attr(page, "max_tunnel_duration_ms").fill("");
    await attr(page, "max_concurrent_connections").fill("");
    const created = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/groups" && request.method() === "POST");
    await button(page, "Create group").click();
    const attributes = (await created).postDataJSON().attributes;
    expect([attributes.max_tunnel_count, attributes.max_tunnel_duration_ms, attributes.max_concurrent_connections]).toEqual([0, 0, 0]);
    await waitForEdit(page);
    await page.reload();
    await waitForEdit(page);
    expect(await attr(page, "max_tunnel_count").inputValue()).toBe("0");
}));

test("시간 단위로 나누어떨어지지 않는 기간은 다른 필드만 저장할 때 바뀌지 않는다", () => withGroups(async ({page}) => {
    // API 로 1.5 시간을 넣는다(화면은 시간 단위 입력이라 직접 만들 수 없다).
    const status = await page.evaluate(async (id) => {
        const csrf = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("csrfToken="))?.slice("csrfToken=".length) ?? "";
        const current = await (await fetch(`/api/groups/${id}`, {credentials: "same-origin"})).json();
        const response = await fetch(`/api/groups/${id}`, {method: "PUT", credentials: "same-origin",
            headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf},
            body: JSON.stringify({attributes: {...current.group.attributes, max_tunnel_duration_ms: 5_400_000}})});
        return response.status;
    }, RBAC_GROUP_FIELD_ID);
    expect(status).toBe(200);
    await openGroup(page, RBAC_GROUP_FIELD_ID);
    expect(await attr(page, "max_tunnel_duration_ms").inputValue()).toBe("1.5");
    await attr(page, "allowed_trusted_clients-client-b").check();
    const saved = page.waitForRequest((request) => request.method() === "PUT" && new URL(request.url()).pathname === `/api/groups/${RBAC_GROUP_FIELD_ID}`);
    await button(page, "Save").click();
    expect((await saved).postDataJSON().attributes.max_tunnel_duration_ms).toBe(5_400_000);
    await page.getByText("Group saved.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
}));
