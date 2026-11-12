import type {Page} from "playwright";
import {startAdminApp, type AdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {RBAC_PASSWORDS, RBAC_USER_IDS} from "../helpers/rbacFixture";

// U3-06 / #108 — 터널 화면의 소유권 표시와 그룹 속성 제한. 테스트마다 rbac fixture 로 앱을 새로 띄운다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

type Name = keyof typeof RBAC_PASSWORDS;

const hashIs = (page: Page, expected: string) =>
    page.waitForFunction((value) => location.hash === value, expected, {timeout: 10_000});

const button = (page: Page, name: string) => page.getByRole("button", {name, exact: true});
const card = (page: Page, port: number) => page.locator(`[data-port="${port}"]`);

const withTunnels = async (name: Name, check: (app: AdminApp) => Promise<void>, expectedCards?: number): Promise<void> => {
    const app = await startAdminApp({fixture: "rbac", ...(name === "admin" ? {} : {login: {username: name, password: RBAC_PASSWORDS[name]}})});
    try {
        await app.page.goto(`${app.url}#/tunnels`);
        await hashIs(app.page, "#/tunnels");
        if(expectedCards !== undefined) {
            await app.page.waitForFunction((count) => document.querySelectorAll("[data-port]").length === count, expectedCards, {timeout: 10_000});
        }
        await check(app);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

/** 편집 화면을 연다. <li> 를 누르면 링크 밖 3행에 떨어질 수 있어 링크를 누른다. */
const openTunnel = async (page: Page, port: number) => {
    await card(page, port).locator("a.tunnel-link").click();
    await hashIs(page, `#/tunnels/${port}`);
    await page.locator("#input-destination-host").waitFor({state: "visible", timeout: 10_000});
};

const certRequests = (page: Page): string[] => {
    const urls: string[] = [];
    page.on("request", (request) => { if(request.url().includes("/api/externalCert/")) urls.push(request.url()); });
    return urls;
};

const optionValues = (page: Page, selector: string) =>
    page.locator(`${selector} option`).evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));

// #338: 소유자(내 것이 아닐 때)와 view only 는 상태 줄에, 보기만 허락된 터널은 스위치 대신 자물쇠다.
const statusOf = (page: Page, port: number) => card(page, port).locator(".tunnel-status");
const waitStatus = (page: Page, port: number, pattern: RegExp) => page.waitForFunction(([target, source]) =>
    new RegExp(source as string).test(document.querySelector(`li[data-port="${target}"] .tunnel-status`)?.textContent ?? ""),
    [port, pattern.source] as const, {timeout: 10_000});

// 이슈 367: 소유자가 둘 이상이면 목록을 소유자별로 묶는다. 줄의 @소유자 대신 묶음 머리글이 소유자를 보인다.
const ownerHeadingOf = (page: Page, port: number) => page.waitForFunction((target) => {
    const title = document.querySelector(`li[data-port="${target}"]`)?.closest(".owner-group")?.querySelector(".owner-title");
    return title?.textContent?.trim() ?? false;
}, port, {timeout: 10_000}).then((handle) => handle.jsonValue() as Promise<string>);

test("alice 는 자기·그룹 공유 터널만 보고, 공유 터널은 view only 와 자물쇠이며 스위치가 없다", () => withTunnels("alice", async ({page}) => {
    expect(await card(page, 20003).count()).toBe(0);
    await waitStatus(page, 20001, /^On/);
    expect(await statusOf(page, 20001).textContent()).not.toContain("@alice");
    expect(await statusOf(page, 20001).textContent()).not.toContain("view only");
    expect(await card(page, 20001).getByRole("switch").count()).toBe(1);
    await waitStatus(page, 20002, /^On · view only$/);
    expect(await ownerHeadingOf(page, 20002)).toBe("bob (Bob)");
    expect(await ownerHeadingOf(page, 20001)).toBe("alice (Alice)");
    expect(await card(page, 20002).locator(".tunnel-lock").getAttribute("title")).toBe("View only");
    expect(await card(page, 20002).getByRole("switch").count()).toBe(0);
    expect(await button(page, "Add tunneling service").count()).toBe(1);
    expect(await page.locator("#tunnel-limit-note").count()).toBe(0);
}, 2));

test("alice 의 편집 화면은 인증서를 읽지 않고 그룹 범위·프로토콜·신뢰 클라이언트만 보인다", () => withTunnels("alice", async ({page}) => {
    const certs = certRequests(page);
    await openTunnel(page, 20001);
    expect(certs).toEqual([]);
    expect(await page.getByText("Unable to connect to the server.").count()).toBe(0);
    // 이슈 365 FR-6: 허용 범위는 안내 글자가 아니라 누를 수 있는 칩이다.
    await page.locator("#tunnel-port-ranges").getByRole("button", {name: "Use a free port in 20000–20099", exact: true}).waitFor({state: "visible"});
    expect(await optionValues(page, "#select-protocol")).toEqual(["tcp", "http"]);
    expect(await page.locator("#input-allow-client-names").count()).toBe(0);
    expect(await page.locator("#tunnel-trusted-client-a").count()).toBe(1);
    expect(await page.locator("#tunnel-trusted-client-b").count()).toBe(0);
    expect(await page.locator("#tunnel-owner").count()).toBe(0);
    await page.locator("#input-external-port").fill("30000");
    await page.getByText("Port is outside the allowed ranges.", {exact: true}).waitFor({state: "visible"});
    expect(await button(page, "Apply and Restart").isEnabled()).toBe(true);
}, 2));

test("alice 가 HTTP 로 바꾸면 허용된 리라이트(CORS·Host)만 보인다", () => withTunnels("alice", async ({page}) => {
    await openTunnel(page, 20001);
    await page.locator("#select-protocol").selectOption("http");
    await page.locator("#select-change-acao").waitFor({state: "visible"});
    expect(await page.locator("#select-change-host-in-body").count()).toBe(1);
    for(const id of ["#http-request-headers", "#http-response-headers", "#http-body-rewrite"]) expect(await page.locator(id).count()).toBe(0);
}, 2));

test("alice 가 TLS 를 켜도 인증서 입력 대신 생성 안내가 보이고 인증서 요청이 없다", () => withTunnels("alice", async ({page}) => {
    const certs = certRequests(page);
    await openTunnel(page, 20001);
    await page.locator("#input-tls").check();
    await page.locator("#tunnel-cert-note").waitFor({state: "visible"});
    expect(await page.locator("#tunnel-cert-note").textContent()).toBe("A generated certificate will be used.");
    expect(await page.locator("#tunnel-cert").count()).toBe(0);
    expect(certs).toEqual([]);
}, 2));

test("alice 가 bob 의 공유 터널을 열면 읽기 전용이고 저장·삭제 버튼이 없다", () => withTunnels("alice", async ({page}) => {
    // 이슈 347 FR-12: 고칠 수 없는 터널은 목록에 편집 링크가 없다. 주소로 바로 연다.
    expect(await card(page, 20002).locator("a").count()).toBe(0);
    await page.goto(`${page.url().split("#")[0]}#/tunnels/20002`);
    await hashIs(page, "#/tunnels/20002");
    await page.locator("#input-destination-host").waitFor({state: "visible", timeout: 10_000});
    await page.locator("#tunnel-readonly-note").waitFor({state: "visible"});
    // 이슈 347: group_read 로만 보이는 터널은 켤 수도 없으므로 읽기 전용 안내다.
    expect(await page.locator("#tunnel-readonly-note").textContent()).toBe("This tunnel is shared with you as read only.");
    expect(await page.locator("#input-destination-host").isDisabled()).toBe(true);
    expect(await button(page, "Apply and Restart").count()).toBe(0);
    expect(await button(page, "Stop and Remove").count()).toBe(0);
}, 2));

test("alice 가 한도까지 만들면 추가 버튼이 사라지고 한도 안내가 보인다", () => withTunnels("alice", async ({page}) => {
    await button(page, "Add tunneling service").click();
    await hashIs(page, "#/tunnels/new");
    await page.locator("#input-external-port").fill("20050");
    await page.locator("#input-destination-host").fill("127.0.0.1");
    await page.locator("#input-destination-port").fill("9000");
    await button(page, "Start").click();
    await hashIs(page, "#/tunnels");
    await page.waitForFunction(() => document.querySelectorAll("[data-port]").length === 3, undefined, {timeout: 10_000});
    await page.locator("#tunnel-limit-note").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#tunnel-limit-note").textContent()).toBe("Tunnel limit reached (2/2).");
    expect(await button(page, "Add tunneling service").count()).toBe(0);
}, 2));

test("carol 은 터널이 없고, 포트·프로토콜이 없는 그룹이라 저장이 포트 오류로 거부된다", () => withTunnels("carol", async ({page}) => {
    await page.getByText("No tunnels yet.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("[data-port]").count()).toBe(0);
    await button(page, "Add tunneling service").click();
    await hashIs(page, "#/tunnels/new");
    const port = page.locator("#input-external-port");
    await port.waitFor({state: "visible", timeout: 10_000});
    expect(await port.inputValue()).toBe("");
    await page.getByText("No ports are allowed for your group.", {exact: true}).waitFor({state: "visible"});
    expect(await optionValues(page, "#select-protocol")).toEqual(["tcp"]);
    await port.fill("25000");
    await page.getByText("Port is outside the allowed ranges.", {exact: true}).waitFor({state: "visible"});
    expect(await page.getByText("No ports are allowed for your group.", {exact: true}).count()).toBe(0);
    await page.locator("#input-destination-host").fill("127.0.0.1");
    await page.locator("#input-destination-port").fill("9000");
    await button(page, "Start").click();
    await page.getByText("Fail to apply tunneling option: This port is outside your group's allowed ranges.", {exact: true})
        .waitFor({state: "visible", timeout: 10_000});
    expect(await page.evaluate(() => location.hash)).toBe("#/tunnels/new");
}));

// #338 REQ-11: 터널이 없고 추가할 수 없으면 관리자에게 요청하라는 안내를 더한다. 추가할 수 있으면 보이지 않는다.
test("carol 은 추가할 수 있어 요청 안내가 없고, 읽기 전용 그룹이 되면 요청 안내를 본다", () => withTunnels("carol", async ({page}) => {
    await page.getByText("No tunnels yet.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#tunnel-ask-admin").count()).toBe(0);
    await page.route("**/api/me", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.group.attributes.tunnel_crud = "read_only";
        await route.fulfill({response, json: body});
    });
    await page.reload();
    await page.locator("#tunnel-ask-admin").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#tunnel-ask-admin").textContent()).toBe("Ask an administrator to add a tunnel for you.");
    expect(await button(page, "Add tunneling service").count()).toBe(0);
}));

test("admin 은 모든 터널과 소유자를 보고 읽기 전용 표시가 없다", () => withTunnels("admin", async ({page}) => {
    expect(await ownerHeadingOf(page, 20003)).toBe("Tunnels from before the upgrade");
    expect(await ownerHeadingOf(page, 20001)).toBe("alice (Alice)");
    expect(await page.locator(".tunnel-lock").count()).toBe(0);
    expect(await page.locator(".tunnel-status").filter({hasText: "view only"}).count()).toBe(0);
}, 3));

test("admin 이 20003 의 소유자를 alice 로 바꾸면 alice 는 그 터널을 편집할 수 있다", () => withTunnels("admin", async ({page}) => {
    await openTunnel(page, 20003);
    const owner = page.locator("#tunnel-owner");
    await page.waitForFunction(() => (document.querySelector("#tunnel-owner") as HTMLSelectElement | null)?.value === "system:migrated",
        undefined, {timeout: 10_000});
    expect(await button(page, "Change owner").isDisabled()).toBe(true);
    expect(await page.locator("#input-allow-client-names").count()).toBe(1);
    await page.locator("#input-tls").check();
    await page.locator("#tunnel-cert").waitFor({state: "visible"});
    await page.locator("#input-tls").uncheck();

    await owner.selectOption(RBAC_USER_IDS.alice);
    expect(await button(page, "Change owner").isEnabled()).toBe(true);
    await button(page, "Change owner").click();
    await page.getByRole("dialog").getByText("Move tunnel 20003 to @alice?").waitFor({state: "visible"});
    await button(page, "Move").click();
    await page.getByText("Owner changed.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await page.goto(`${page.url().split("#")[0]}#/tunnels`);
    await hashIs(page, "#/tunnels");
    await page.waitForFunction(() => document.querySelector('li[data-port="20003"]')?.closest(".owner-group")?.querySelector(".owner-title")
        ?.textContent?.trim() === "alice (Alice)", undefined, {timeout: 10_000});

    // 같은 서버 상태에서 alice 로 다시 들어온다.
    await page.locator('[aria-label="Open menu"]').click();
    await page.locator("#nav-sign-out").click();
    await page.locator("#login-username").waitFor({state: "visible", timeout: 10_000});
    await page.locator("#login-username").fill("alice");
    await page.locator("#login-password").fill(RBAC_PASSWORDS.alice);
    await button(page, "OK").click();
    await page.goto(`${page.url().split("#")[0]}#/tunnels`);
    await page.waitForFunction(() => document.querySelectorAll("[data-port]").length === 3, undefined, {timeout: 10_000});
    expect(await card(page, 20003).locator("[data-readonly]").count()).toBe(0);
}, 3));

/** 다음 POST /api/tunnelingOption 의 본문을 잡는다. */
const nextSave = (page: Page) => page.waitForRequest((request) =>
    request.method() === "POST" && new URL(request.url()).pathname === "/api/tunnelingOption", {timeout: 10_000});

test("alice 가 신뢰 클라이언트 없는 기존 터널을 저장하면 요청 없이 이유를 보이고, 고른 뒤에는 저장된다", () => withTunnels("alice", async ({page}) => {
    await openTunnel(page, 20001);
    let posts = 0;
    page.on("request", (request) => { if(request.method() === "POST" && new URL(request.url()).pathname === "/api/tunnelingOption") posts++; });
    await page.locator("#input-destination-port").fill("9001");
    await button(page, "Apply and Restart").click();
    await page.getByText("Select at least one trusted client.", {exact: true}).waitFor({state: "visible"});
    expect(posts).toBe(0);

    await page.locator("#tunnel-trusted-client-a").check();
    const saved = nextSave(page);
    await button(page, "Apply and Restart").click();
    const body = (await saved).postDataJSON();
    // 일반 유저는 allowedClientNames 를 보내지 않는다(서버가 legacy_client_names_not_allowed 로 거부한다).
    expect("allowedClientNames" in body).toBe(false);
    expect(body.allowedClientIds).toEqual(["client-a"]);
    await page.getByText("Success to apply tunneling option", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await hashIs(page, "#/tunnels");
}, 2));

test("alice 가 HTTP 에서 CORS 를 켠 뒤 TCP 로 되돌려 저장하면 저장 직전 정규화로 리라이트가 모두 꺼진다", () => withTunnels("alice", async ({page}) => {
    await openTunnel(page, 20001);
    await page.locator("#tunnel-trusted-client-a").check();
    await page.locator("#select-protocol").selectOption("http");
    await page.locator("#select-change-acao").selectOption("true");
    await page.locator("#select-protocol").selectOption("tcp");
    const saved = nextSave(page);
    await button(page, "Apply and Restart").click();
    const http = (await saved).postDataJSON().httpOption;
    expect(http.replaceAccessControlAllowOrigin).toBe(false);
    expect(http.rewriteHostInTextBody).toBe(false);
    await hashIs(page, "#/tunnels");
}, 2));

test("admin 이 소유자가 있는 터널의 소유자를 바꾼 뒤 같은 화면에서 저장해도 이전 소유자로 되돌아가지 않는다", () => withTunnels("admin", async ({page}) => {
    await openTunnel(page, 20001);
    await page.waitForFunction((id) => (document.querySelector("#tunnel-owner") as HTMLSelectElement | null)?.value === id,
        RBAC_USER_IDS.alice, {timeout: 10_000});
    await page.locator("#tunnel-owner").selectOption(RBAC_USER_IDS.bob);
    await button(page, "Change owner").click();
    await button(page, "Move").click();
    await page.getByText("Owner changed.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await page.locator("#input-destination-port").fill("9005");
    const saved = nextSave(page);
    await button(page, "Apply and Restart").click();
    const body = (await saved).postDataJSON();
    // 소유자 변경은 전용 API 만 한다. 저장 본문이 화면을 연 시점의 ownerId 를 실어 보내면 서버가 그 값으로 되돌린다.
    expect("ownerId" in body).toBe(false);
    expect("owner" in body).toBe(false);
    expect("editable" in body).toBe(false);
    await page.getByText("Success to apply tunneling option", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await hashIs(page, "#/tunnels");
    await page.waitForFunction(() => document.querySelector('li[data-port="20001"]')?.closest(".owner-group")?.querySelector(".owner-title")
        ?.textContent?.trim() === "bob (Bob)", undefined, {timeout: 10_000});
}, 3));

// #150 — 서버는 allowedClientIds 가 있으면 이름 목록을 보지 않는다. 슈퍼유저 화면도 id 를 보이고 고칠 수 있어야 한다.
test("admin 은 신뢰 클라이언트 id 를 고를 수 있고, id 가 있으면 이름보다 우선한다는 안내를 본다", () => withTunnels("admin", async ({page}) => {
    await openTunnel(page, 20003);
    await page.locator("#tunnel-client-id-client-a").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#tunnel-client-id-client-b").count()).toBe(1);
    expect(await page.locator("#tunnel-client-ids-priority").count()).toBe(0);
    await page.locator("#tunnel-client-id-client-b").check();
    await page.locator("#tunnel-client-ids-priority").waitFor({state: "visible"});
    const saved = nextSave(page);
    await button(page, "Apply and Restart").click();
    expect((await saved).postDataJSON().allowedClientIds).toEqual(["client-b"]);
    await page.getByText("Success to apply tunneling option", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await hashIs(page, "#/tunnels");
    await openTunnel(page, 20003);
    await page.waitForFunction(() => (document.querySelector("#tunnel-client-id-client-b") as HTMLInputElement | null)?.checked === true,
        undefined, {timeout: 10_000});
    await page.locator("#tunnel-client-ids-priority").waitFor({state: "visible"});
}, 3));

test("admin 이 소유자를 바꾼 뒤 같은 화면에서 저장해도 revision 충돌이 없다", () => withTunnels("admin", async ({page}) => {
    await openTunnel(page, 20003);
    await page.waitForFunction(() => (document.querySelector("#tunnel-owner") as HTMLSelectElement | null)?.value === "system:migrated",
        undefined, {timeout: 10_000});
    await page.locator("#tunnel-owner").selectOption(RBAC_USER_IDS.bob);
    await button(page, "Change owner").click();
    await button(page, "Move").click();
    await page.getByText("Owner changed.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await page.locator("#input-destination-port").fill("9003");
    await button(page, "Apply and Restart").click();
    await page.getByText("Success to apply tunneling option", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await hashIs(page, "#/tunnels");
    // 이슈 367: 소유자는 줄 끝의 @소유자가 아니라 소유자별 묶음의 머리글로 보인다.
    expect(await ownerHeadingOf(page, 20003)).toBe("bob (Bob)");
}, 3));

// #178 — 슈퍼유저가 소유자 그룹이 허용하지 않은 id 를 넣으면 소유자는 자기 터널을 저장하지 못한다.
test("admin 이 소유자 그룹이 허용하지 않은 신뢰 클라이언트 id 를 고르면 저장 전에 경고를 본다", () => withTunnels("admin", async ({page}) => {
    await openTunnel(page, 20001);
    await page.locator("#tunnel-client-id-client-b").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#tunnel-client-ids-not-allowed").count()).toBe(0);
    await page.locator("#tunnel-client-id-client-a").check();
    expect(await page.locator("#tunnel-client-ids-not-allowed").count()).toBe(0);
    await page.locator("#tunnel-client-id-client-b").check();
    const warning = page.locator("#tunnel-client-ids-not-allowed");
    await warning.waitFor({state: "visible"});
    expect(await warning.textContent()).toContain("client-b");
    expect(await warning.textContent()).not.toContain("client-a");
}, 3));

test("bob 은 그룹 밖 id 가 들어간 자기 터널에서 그 id 를 보고 해제해 저장할 수 있다", () => withTunnels("bob", async ({page}) => {
    await openTunnel(page, 20002);
    const outside = page.locator("#tunnel-trusted-client-b");
    await outside.waitFor({state: "visible", timeout: 10_000});
    expect(await outside.isChecked()).toBe(true);
    await page.locator("#tunnel-trusted-not-allowed").waitFor({state: "visible"});
    let posts = 0;
    page.on("request", (request) => { if(request.method() === "POST" && new URL(request.url()).pathname === "/api/tunnelingOption") posts++; });
    // 그대로 저장하면 서버가 422 로 거부하므로 요청 없이 이유를 보인다.
    await page.locator("#tunnel-trusted-client-a").check();
    await button(page, "Apply and Restart").click();
    await page.getByText("Remove the client IDs your group does not allow.", {exact: true}).waitFor({state: "visible"});
    expect(posts).toBe(0);
    await outside.uncheck();
    const saved = nextSave(page);
    await button(page, "Apply and Restart").click();
    expect((await saved).postDataJSON().allowedClientIds).toEqual(["client-a"]);
    await page.getByText("Success to apply tunneling option", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await hashIs(page, "#/tunnels");
}, 2));

// 이슈 365 FR-6·AC-4(설계 반영) — 칩을 누르면 목록의 터널이 쓰지 않는 그 범위의 가장 작은 포트가 외부 포트 칸에 들어간다.
test("alice 가 허용 범위 칩을 누르면 쓰지 않은 가장 작은 포트가 들어가고, 칩 안내가 보인다", () => withTunnels("alice", async ({page}) => {
    await button(page, "Add tunneling service").click();
    await hashIs(page, "#/tunnels/new");
    const chip = page.locator("#tunnel-port-ranges").getByRole("button", {name: "Use a free port in 20000–20099", exact: true});
    await chip.waitFor({state: "visible", timeout: 10_000});
    expect((await chip.textContent())?.trim()).toBe("20000–20099");
    const group = page.getByRole("group", {name: "Choose a port from an allowed range", exact: true});
    expect(await group.count()).toBe(1);
    expect(await group.getByText("Allowed ranges", {exact: true}).count()).toBe(1);
    const note = page.getByText("Choose a range to fill in the first port your tunnels don't use.", {exact: true});
    expect(await note.count()).toBe(1);
    expect(await group.getAttribute("aria-describedby")).toBe(await note.getAttribute("id"));
    // alice 의 목록에는 20001(자기)·20002(bob, 그룹 공유)가 있다. 새 터널의 처음 값은 쓰지 않은 20000 이다.
    expect(await page.locator("#input-external-port").inputValue()).toBe("20000");
    await page.locator("#input-external-port").fill("20050");
    await chip.click();
    expect(await page.locator("#input-external-port").inputValue()).toBe("20000");
    // 설계 ②: 칩은 보이는 높이 36px, 누르는 영역은 위아래로 넓혀 44px 이다.
    const box = await chip.boundingBox();
    expect(Math.round(box!.height)).toBe(36);
    // 누름 영역은 ::before 가 위아래로 4px 씩 넓힌다(36 + 8 = 44px). 칩은 위에 쌓여 아래 글자에 덮이지 않는다.
    const area = await chip.evaluate((element) => {
        const before = getComputedStyle(element, "::before");
        return {position: before.position, top: before.top, bottom: before.bottom, zIndex: getComputedStyle(element).zIndex};
    });
    expect(area).toEqual({position: "absolute", top: "-4px", bottom: "-4px", zIndex: "1"});
    // 허용 범위 밖 포트를 넣으면 포트 오류가 안내 글자를 대신하고, 칩은 그대로 남는다.
    await page.locator("#input-external-port").fill("30000");
    await page.getByText("Port is outside the allowed ranges.", {exact: true}).waitFor({state: "visible"});
    expect(await note.count()).toBe(0);
    expect(await chip.count()).toBe(1);
}, 2));

type Range = {from: number; to: number};

/** alice 의 그룹 범위를 ranges 로 바꾸고, 편집 화면이 읽는 터널 목록에 bob 의 터널을 extraPorts 포트로 더해 새 터널 화면을 연다. */
const openNewWithRanges = async (page: Page, ranges: Range[], extraPorts: number[]) => {
    await page.route("**/api/me", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({response, json: {...body, group: {...body.group, attributes: {...body.group.attributes, allowed_port_range: ranges}}}});
    });
    await page.reload();
    await hashIs(page, "#/tunnels");
    await card(page, 20001).waitFor({state: "visible", timeout: 10_000});
    await page.route("**/api/tunnelingOption", async (route) => {
        if(route.request().method() !== "GET") return route.continue();
        const response = await route.fetch();
        const body = await response.json();
        const bob = body.tunnelingOptions.find((row: {forwardPort: number}) => row.forwardPort === 20002);
        const extra = extraPorts.map((forwardPort) => ({...bob, forwardPort}));
        await route.fulfill({response, json: {...body, tunnelingOptions: [...body.tunnelingOptions, ...extra]}});
    });
    await button(page, "Add tunneling service").click();
    await hashIs(page, "#/tunnels/new");
    await page.locator("#tunnel-port-ranges").waitFor({state: "visible", timeout: 10_000});
};

const chipsOf = (page: Page) => page.locator("#tunnel-port-ranges .port-chip");

// 이슈 365 AC-4(설계 반영) — 허용 범위 20000–20100, 30000–30010 이고 30000 을 이미 쓰면 두 번째 칩은 30001 을 넣는다.
test("AC-4: 두 범위 가운데 두 번째 칩을 누르면 쓰지 않은 30001 이 들어간다", () => withTunnels("alice", async ({page}) => {
    await openNewWithRanges(page, [{from: 20000, to: 20100}, {from: 30000, to: 30010}], [30000]);
    expect(await chipsOf(page).allTextContents()).toEqual(["20000–20100", "30000–30010"]);
    await button(page, "Use a free port in 30000–30010").click();
    expect(await page.locator("#input-external-port").inputValue()).toBe("30001");
}, 2));

// 이슈 365 FR-6·리뷰 L-3 — 모두 쓴 범위의 칩은 aria-disabled 로 잠그고 이유를 title 에 둔다. 초점은 받고 눌러도 값이 바뀌지 않는다.
test("모두 쓴 범위의 칩은 잠기고 이유를 보이며, 초점은 받지만 눌러도 포트가 바뀌지 않는다", () => withTunnels("alice", async ({page}) => {
    await openNewWithRanges(page, [{from: 20001, to: 20002}, {from: 20010, to: 20020}], []);
    const full = button(page, "Use a free port in 20001–20002");
    expect(await full.getAttribute("aria-disabled")).toBe("true");
    expect(await full.getAttribute("title")).toBe("Every port in this range is already in use.");
    // aria-disabled 는 Playwright 의 isDisabled 가 참으로 보므로, 실제 disabled 속성이 없어 초점을 받는지만 본다.
    expect(await full.evaluate((element) => element.hasAttribute("disabled"))).toBe(false);
    const port = page.locator("#input-external-port");
    expect(await port.inputValue()).toBe("20010");
    await full.focus();
    expect(await full.evaluate((element) => element === document.activeElement)).toBe(true);
    // aria-disabled 버튼은 Playwright 가 누를 수 없다고 본다. 사용자가 눌러도 아무 일이 없는지 강제로 눌러 본다.
    await full.click({force: true});
    await page.keyboard.press("Enter");
    expect(await port.inputValue()).toBe("20010");
    expect(await button(page, "Use a free port in 20010–20020").getAttribute("aria-disabled")).toBeNull();
}, 2));

// 이슈 365 리뷰 H-1 — 서버는 같은 범위를 두 번 저장할 수 있다. 칩 목록이 키 중복으로 깨지지 않고 칩 하나만 보인다.
test("같은 허용 범위가 두 번 있어도 편집 화면이 그려지고 칩은 하나다", () => withTunnels("alice", async ({page}) => {
    await openNewWithRanges(page, [{from: 1, to: 65535}, {from: 1, to: 65535}], []);
    expect(await chipsOf(page).allTextContents()).toEqual(["1–65535"]);
    await page.locator("#input-destination-host").waitFor({state: "visible", timeout: 10_000});
}, 2));

// 이슈 367 AC-1·AC-2·AC-8·FR-10 — 슈퍼유저 목록은 소유자별 묶음이고, 순서는 다른 사용자(아이디 순) → 업그레이드 전 터널이며,
// 각 목록은 머리글 이름을 가지고, 줄에는 @소유자가 없으며, 360px 에서 넘치지 않는다.
test("이슈 367 admin 의 목록은 소유자별 묶음과 머리글을 보이고, 각 목록이 머리글 이름을 가진다", () => withTunnels("admin", async ({page}) => {
    await page.setViewportSize({width: 360, height: 800});
    await page.locator(".owner-group").first().waitFor({state: "visible", timeout: 10_000});
    const groups = await page.locator(".owner-group").evaluateAll((sections) => sections.map((section) => {
        const title = section.querySelector(".owner-title") as HTMLElement;
        const list = section.querySelector("ul") as HTMLElement;
        return {
            title: title.textContent?.trim(),
            heading: title.tagName,
            labelled: list.getAttribute("aria-labelledby") === title.id,
            ports: [...section.querySelectorAll("li[data-port]")].map((li) => Number(li.getAttribute("data-port"))),
        };
    }));
    expect(groups).toEqual([
        {title: "alice (Alice)", heading: "H2", labelled: true, ports: [20001]},
        {title: "bob (Bob)", heading: "H2", labelled: true, ports: [20002]},
        {title: "Tunnels from before the upgrade", heading: "H2", labelled: true, ports: [20003]},
    ]);
    expect(await page.locator(".tunnel-status").filter({hasText: "@"}).count()).toBe(0);
    expect(await page.locator(".owner-me").count()).toBe(0);
    // 다른 사람 터널의 스위치 이름에는 소유자를 붙인다(설계 반영).
    expect(await card(page, 20001).getByRole("switch").getAttribute("aria-label")).toMatch(/, alice$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}, 3));

// 이슈 367 AC-4·FR-4 — 공유를 받은 일반 사용자도 소유자가 둘이면 묶고, 내 묶음이 맨 위에 "나" 표시와 함께 온다.
test("이슈 367 alice 는 내 묶음이 맨 위에 '나' 표시와 함께 보이고 bob 묶음이 그 아래다", () => withTunnels("alice", async ({page}) => {
    await page.locator(".owner-group").first().waitFor({state: "visible", timeout: 10_000});
    const titles = await page.locator(".owner-title").allTextContents();
    expect(titles.map((title) => title.trim())).toEqual(["alice (Alice)", "bob (Bob)"]);
    expect((await page.locator(".owner-group").first().locator(".owner-me").textContent())?.trim()).toBe("You");
    expect(await page.locator(".owner-group").nth(1).locator(".owner-me").count()).toBe(0);
}, 2));

// 이슈 366 FR-10~FR-12·AC-9 — 그룹 연결당 버퍼 최댓값. 화면은 상한을 미리 보이고, 넘는 새 값은 그 칸에 오류를 보이며 저장을 잠근다.
// 그룹 속성은 /api/me 응답을 바꿔 준다(서버 판정은 관리 API 테스트가 맡는다).
const withBufferCap = async (page: Page, cap: number) => {
    await page.route("**/api/me", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({response, json: {...body, group: {...body.group, attributes: {...body.group.attributes, max_session_buffer_mib: cap}}}});
    });
    await page.reload();
    await hashIs(page, "#/tunnels");
};

test("이슈 366 상한 8 인 alice 의 새 터널은 버퍼 기본값이 8 이고, 9 를 넣으면 그 칸에 오류가 나며 저장이 잠긴다", () => withTunnels("alice", async ({page}) => {
    await withBufferCap(page, 8);
    await button(page, "Add tunneling service").click();
    await hashIs(page, "#/tunnels/new");
    await page.locator("#tunnel-buffer-cap").waitFor({state: "visible", timeout: 10_000});
    expect((await page.locator("#tunnel-buffer-cap").textContent())?.trim()).toBe("Group maximum 8 MiB");
    expect(await page.locator("#input-buffer-limit-server").inputValue()).toBe("8");
    expect(await page.locator("#input-buffer-limit-client").inputValue()).toBe("8");
    expect(await page.getByText("Client buffer: 1 to 8 MiB.", {exact: true}).count()).toBe(1);
    await page.locator("#input-buffer-limit-server").fill("9");
    await page.getByText("Set 8 MiB or less (group maximum).", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    expect(await button(page, "Start").isDisabled()).toBe(true);
    await page.locator("#input-buffer-limit-server").fill("8");
    // 검토 L: 상한이 있으면 두 칸 모두 max 속성으로 상한을 건다.
    expect(await page.locator("#input-buffer-limit-server").getAttribute("max")).toBe("8");
    expect(await page.locator("#input-buffer-limit-client").getAttribute("max")).toBe("8");
    // 검토 M-1: 클라이언트 버퍼 0(제한 없음)은 상한 초과와 다른 안내를 보인다.
    await page.locator("#input-buffer-limit-client").fill("0");
    await page.getByText("Set 1 to 8 MiB. Unlimited is not allowed while your group has a maximum.", {exact: true})
        .waitFor({state: "visible", timeout: 10_000});
    expect(await button(page, "Start").isDisabled()).toBe(true);
}, 2));

test("이슈 366 상한보다 큰 값이 저장된 기존 터널은 경고만 보이고, 값을 그대로 두면 저장할 수 있다", () => withTunnels("alice", async ({page}) => {
    await withBufferCap(page, 4);
    await openTunnel(page, 20001);
    await page.locator("#tunnel-buffer-stored-over").waitFor({state: "visible", timeout: 10_000});
    // 검토 L: 넘는 칸마다 이름과 값을 넣어 한 줄씩 알린다(fixture 의 20001 은 서버·클라이언트 모두 기본값 8 MiB 다).
    expect((await page.locator("#tunnel-buffer-stored-over-server").textContent())?.trim())
        .toBe("Server buffer 8 MiB is larger than the group maximum (4 MiB). You can keep it, but a new value must be 4 MiB or less.");
    expect((await page.locator("#tunnel-buffer-stored-over-client").textContent())?.trim())
        .toBe("Client buffer 8 MiB is larger than the group maximum (4 MiB). You can keep it, but a new value must be 4 MiB or less.");
    // 저장된 값을 그대로 두는 칸에는 max 를 걸지 않는다.
    expect(await page.locator("#input-buffer-limit-server").getAttribute("max")).toBeNull();
    expect(await button(page, "Apply and Restart").isEnabled()).toBe(true);
}, 2));

// 이슈 367 AC-7 — 묶음 안에서도 한 번 눌러 끄고, Undo 로 되돌리며, 묶음 머리글의 켜진 수가 위 요약과 같은 기준으로 바뀐다.
test("이슈 367 admin 은 alice 묶음 안의 터널을 끄고 Undo 로 다시 켠다", () => withTunnels("admin", async ({page}) => {
    const switchOf = card(page, 20001).getByRole("switch");
    const countOf = page.locator(".owner-group").filter({has: card(page, 20001)}).locator(".owner-count");
    const checked = (value: boolean) => page.waitForFunction((expected) =>
        document.querySelector('li[data-port="20001"] [role="switch"]')?.getAttribute("aria-checked") === String(expected), value, {timeout: 10_000});
    const activeRequest = () => page.waitForRequest((request) => request.method() === "POST"
        && new URL(request.url()).pathname === "/api/tunneling/active/20001", {timeout: 10_000});
    await waitStatus(page, 20001, /^On/);
    expect(await countOf.textContent()).toBe("1 of 1 on");
    const onBefore = Number(/^(\d+) of 3 on$/.exec((await page.locator("#tunnel-summary").textContent()) ?? "")?.[1]);
    expect(onBefore).toBeGreaterThanOrEqual(1);
    // 다른 사람 묶음의 스위치 이름에는 소유자를 붙인다.
    expect(await switchOf.getAttribute("aria-label")).toBe(":20001 → 127.0.0.1:8081, alice");

    const off = activeRequest();
    await switchOf.click();
    expect((await off).postDataJSON()).toEqual({active: false, timeout: 0});
    await checked(false);
    await waitStatus(page, 20001, /^Off/);
    // 위 요약과 묶음 머리글은 같은 기준(isTunnelOn)으로 센다.
    await page.locator("#tunnel-summary").filter({hasText: `${onBefore - 1} of 3 on`}).waitFor({state: "visible", timeout: 10_000});
    await countOf.filter({hasText: "0 of 1 on"}).waitFor({state: "visible", timeout: 10_000});

    const undo = activeRequest();
    await page.locator(".toast").filter({hasText: ":20001 → 127.0.0.1:8081 is off"}).getByRole("button", {name: "Undo", exact: true}).click();
    expect((await undo).postDataJSON()).toMatchObject({active: true});
    await checked(true);
    await waitStatus(page, 20001, /^On/);
    await countOf.filter({hasText: "1 of 1 on"}).waitFor({state: "visible", timeout: 10_000});
}, 3));

// 이슈 367 설계 반영 — 업그레이드 전 터널 묶음의 스위치 이름에는 묶음 이름을 붙인다.
test("이슈 367 업그레이드 전 터널의 스위치 이름에는 묶음 이름이 붙는다", () => withTunnels("admin", async ({page}) => {
    await page.locator(".owner-group").first().waitFor({state: "visible", timeout: 10_000});
    expect(await card(page, 20003).getByRole("switch").getAttribute("aria-label")).toBe(":20003 → 127.0.0.1:8083, Tunnels from before the upgrade");
}, 3));

const LONG_DISPLAY_NAME = "Administrator of the platform infrastructure team for the long running project";

/** 목록 응답의 소유자를 바꿔 내 묶음(긴 표시 이름)과 소유자 없음 묶음을 만든다. 상태 API 는 그대로다. */
const stubOwners = (page: Page, owners: Record<number, {id: string; username?: string; displayName?: string}>) =>
    page.route((url) => url.pathname === "/api/tunnelingOption", async (route) => {
        if(route.request().method() !== "GET") return route.fallback();
        const response = await route.fetch();
        const json = await response.json();
        json.tunnelingOptions = json.tunnelingOptions.map((option: {forwardPort: number}) =>
            owners[option.forwardPort] ? {...option, owner: owners[option.forwardPort], ownerId: owners[option.forwardPort].id} : option);
        await route.fulfill({response, json});
    });

const openStubbed = async (name: Name, owners: Record<number, {id: string; username?: string; displayName?: string}>,
                           check: (page: Page) => Promise<void>): Promise<void> => {
    const app = await startAdminApp({fixture: "rbac", ...(name === "admin" ? {} : {login: {username: name, password: RBAC_PASSWORDS[name]}})});
    try {
        await stubOwners(app.page, owners);
        // 로그인 직후 이미 #/tunnels 일 수 있다. 다른 화면을 거쳐 다시 열어 바꾼 응답으로 목록을 읽게 한다.
        await app.page.goto(`${app.url}#/me`);
        await hashIs(app.page, "#/me");
        await app.page.goto(`${app.url}#/tunnels`);
        await hashIs(app.page, "#/tunnels");
        await app.page.locator(".owner-group").first().waitFor({state: "visible", timeout: 10_000});
        await check(app.page);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

// 이슈 367 FR-3·FR-10·설계 반영 — 슈퍼유저 자신의 묶음이 맨 위에 "You" 표시와 함께 오고, 360px 에서 긴 이름은 줄임표로 줄며
// 전체는 title 에 있고, 내 묶음의 스위치 이름에는 소유자가 없다. 소유자 없음 묶음 아래에는 슈퍼유저에게 정리 방법을 안내한다.
test("이슈 367 admin 의 묶음: 내 묶음이 먼저, 긴 이름 줄임표, 소유자 없음 안내", () => openStubbed("admin", {
    20003: {id: RBAC_USER_IDS.admin, username: "admin", displayName: LONG_DISPLAY_NAME},
    20002: {id: "u_deleted_one"},
}, async (page) => {
    await page.setViewportSize({width: 360, height: 800});
    const groups = await page.locator(".owner-group").evaluateAll((sections) => sections.map((section) => {
        const title = section.querySelector(".owner-title") as HTMLElement;
        return {
            title: title.textContent?.trim(),
            labelled: section.getAttribute("aria-labelledby") === title.id,
            ports: [...section.querySelectorAll("li[data-port]")].map((li) => Number(li.getAttribute("data-port"))),
            hint: section.querySelector(".owner-hint")?.textContent?.trim() ?? null,
        };
    }));
    expect(groups).toEqual([
        {title: `admin (${LONG_DISPLAY_NAME})`, labelled: true, ports: [20003], hint: null},
        {title: "alice (Alice)", labelled: true, ports: [20001], hint: null},
        {title: "No owner", labelled: true, ports: [20002], hint: "Use 'Change owner' in the tunnel edit screen to assign a new owner."},
    ]);

    const mine = page.locator(".owner-group").first();
    const heading = mine.locator(".owner-title");
    expect(await heading.getAttribute("title")).toBe(`admin (${LONG_DISPLAY_NAME})`);
    // 긴 이름은 머리글 안에서 줄임표로 줄어든다(글자가 상자보다 넓고, 넘치는 부분을 감춘다).
    expect(await heading.evaluate((element) => element.scrollWidth > element.clientWidth
        && getComputedStyle(element).textOverflow === "ellipsis")).toBe(true);
    // "You" 표시와 켜진 수는 줄지 않고 화면 안에 보인다.
    const badge = mine.locator(".owner-me");
    expect((await badge.textContent())?.trim()).toBe("You");
    const box = await badge.boundingBox();
    expect(box !== null && box.width > 0 && box.x + box.width <= 360).toBe(true);
    expect(await mine.locator(".owner-count").isVisible()).toBe(true);
    // 내 묶음의 스위치 이름은 터널 이름뿐이다. 소유자 없음 묶음은 묶음 이름을 붙인다.
    expect(await card(page, 20003).getByRole("switch").getAttribute("aria-label")).toBe(":20003 → 127.0.0.1:8083");
    expect(await card(page, 20002).getByRole("switch").getAttribute("aria-label")).toBe(":20002 → 127.0.0.1:8082, No owner");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}));

// 이슈 367 설계 반영 — 소유자를 바꿀 수 없는 일반 사용자에게는 소유자 없음 안내를 보이지 않는다.
test("이슈 367 alice 에게는 소유자 없음 묶음은 보여도 정리 안내는 없다", () => openStubbed("alice", {
    20002: {id: "u_deleted_one"},
}, async (page) => {
    const titles = (await page.locator(".owner-title").allTextContents()).map((title) => title.trim());
    expect(titles).toEqual(["alice (Alice)", "No owner"]);
    expect(await page.locator(".owner-hint").count()).toBe(0);
}));
