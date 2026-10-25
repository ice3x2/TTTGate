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

test("alice 는 자기·그룹 공유 터널만 보고, 공유 터널은 읽기 전용 표시와 스위치가 없다", () => withTunnels("alice", async ({page}) => {
    expect(await card(page, 20003).count()).toBe(0);
    expect(await card(page, 20001).locator("[data-owner]").textContent()).toBe("@alice");
    expect(await card(page, 20001).locator("[data-readonly]").count()).toBe(0);
    await card(page, 20001).getByText("Activation").waitFor({state: "visible", timeout: 10_000});
    expect(await card(page, 20002).locator("[data-owner]").textContent()).toBe("@bob");
    expect((await card(page, 20002).locator("[data-readonly]").textContent())?.trim()).toBe("read only");
    expect(await card(page, 20002).getByText("Activation").count()).toBe(0);
    expect(await button(page, "Add tunneling service").count()).toBe(1);
    expect(await page.locator("#tunnel-limit-note").count()).toBe(0);
}, 2));

test("alice 의 편집 화면은 인증서를 읽지 않고 그룹 범위·프로토콜·신뢰 클라이언트만 보인다", () => withTunnels("alice", async ({page}) => {
    const certs = certRequests(page);
    await openTunnel(page, 20001);
    expect(certs).toEqual([]);
    expect(await page.getByText("Unable to connect to the server.").count()).toBe(0);
    await page.getByText("Allowed ranges: 20000–20099", {exact: true}).waitFor({state: "visible"});
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
    await openTunnel(page, 20002);
    await page.locator("#tunnel-readonly-note").waitFor({state: "visible"});
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

test("admin 은 모든 터널과 소유자를 보고 읽기 전용 표시가 없다", () => withTunnels("admin", async ({page}) => {
    expect(await card(page, 20003).locator("[data-owner]").textContent()).toBe("migrated");
    expect(await card(page, 20001).locator("[data-owner]").textContent()).toBe("@alice");
    expect(await page.locator("[data-readonly]").count()).toBe(0);
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
    await card(page, 20003).locator("[data-owner]").filter({hasText: "@alice"}).waitFor({state: "visible", timeout: 10_000});

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
    await card(page, 20001).locator("[data-owner]").filter({hasText: "@bob"}).waitFor({state: "visible", timeout: 10_000});
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
    await card(page, 20003).locator("[data-owner]").filter({hasText: "@bob"}).waitFor({state: "visible", timeout: 10_000});
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
