import type {Page} from "playwright";
import {startAdminApp, type AdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {RBAC_PASSWORDS} from "../helpers/rbacFixture";
import {waitUntil} from "../helpers/smokeProcess";

// #213 신뢰 클라이언트 화면과 "등록 명령 복사"
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const withApp = async (options: Parameters<typeof startAdminApp>[0], check: (app: AdminApp) => Promise<void>): Promise<void> => {
    const app = await startAdminApp(options);
    try {
        await check(app);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

const openMenu = async (page: Page) => {
    await page.getByRole("button", {name: "Open menu"}).click();
    const dialog = page.locator('[role=dialog][aria-label="Navigation"]');
    await dialog.waitFor({state: "visible"});
    return dialog;
};

const openClients = async (page: Page) => {
    const dialog = await openMenu(page);
    await dialog.getByText("Trusted clients", {exact: true}).click();
    await page.waitForFunction(() => location.hash === "#/clients", undefined, {timeout: 10_000});
    await page.locator("#clients-list .client-row").first().waitFor({state: "visible", timeout: 10_000});
};

const rowOf = (page: Page, clientId: string) => page.locator(`#clients-list .client-row[data-client-id="${clientId}"]`);

test("REQ-1 the superuser sees the registered clients without any secret", () => withApp({fixture: "rbac"}, async ({page}) => {
    await openClients(page);
    expect(await rowOf(page, "client-a").textContent()).toContain("Client A");
    expect(await rowOf(page, "client-b").count()).toBe(1);
    expect(await page.content()).not.toContain("client-a-secret");
}));

test("REQ-1 a regular user does not get the menu item", () => withApp({fixture: "rbac", login: {username: "alice", password: RBAC_PASSWORDS.alice}}, async ({page}) => {
    const dialog = await openMenu(page);
    expect(await dialog.getByText("Trusted clients", {exact: true}).count()).toBe(0);
}));

test("REQ-5 a plain-text control port shows a notice instead of code buttons", () => withApp({fixture: "rbac"}, async (app) => {
    await app.serverOption({tls: false});
    await openClients(app.page);
    await app.page.locator("#clients-tls-notice").waitFor({state: "visible"});
    expect(await app.page.locator(".client-code").count()).toBe(0);
}));

test("REQ-2/3 creating a client shows the join command with the code and remembers the address", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await page.locator("#clients-address").fill("2001:db8::7");
    await page.locator("#client-new-id").fill("edge-9");
    await page.locator("#client-new-name").fill("Edge 9");
    await page.locator("#client-create button").click();

    const modal = page.locator(".enroll-modal");
    await modal.waitFor({state: "visible"});
    const command = await modal.locator("#enroll-command").textContent();
    expect(command).toMatch(/^TTTGate client join \[2001:db8::7\]:9126 --code [0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(await modal.textContent()).toContain("Expires");
    await rowOf(page, "edge-9").waitFor({state: "visible"});

    // REQ-3: 만료 뒤에는 명령을 흐리게 하고 재발급 버튼을 보인다.
    await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 2 * 3600_000; });
    await modal.locator("#enroll-command.expired").waitFor({state: "visible", timeout: 5000});
    await modal.locator("#enroll-reissue").waitFor({state: "visible"});

    // Esc 로 닫으면 포커스가 화면으로 돌아오고, 다시 열어도 주소가 남아 있다.
    await page.keyboard.press("Escape");
    await modal.waitFor({state: "hidden"});
    await page.reload();
    await page.locator("#clients-address").waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#clients-address").inputValue()).toBe("2001:db8::7");
}));

test("REQ-1 delete is refused while a tunnel or group allows the client, and works otherwise", () => withApp({fixture: "rbac"}, async ({page}) => {
    await openClients(page);
    await rowOf(page, "client-b").locator(".client-delete").click();
    await page.locator(".delete-client-modal").waitFor({state: "visible"});
    await page.locator("#confirm-delete-client").click();
    await page.getByText(/still allowed by tunnels or groups/).waitFor({state: "visible", timeout: 10_000});
    expect(await rowOf(page, "client-b").count()).toBe(1);

    await page.locator("#client-new-id").fill("temp-1");
    await page.locator("#client-create button").click();
    await rowOf(page, "temp-1").waitFor({state: "visible"});
    // REQ-6: 키보드만으로 삭제 확인까지 간다.
    await rowOf(page, "temp-1").locator(".client-delete").focus();
    await page.keyboard.press("Enter");
    await page.locator(".delete-client-modal").waitFor({state: "visible"});
    await page.locator("#confirm-delete-client").focus();
    await page.keyboard.press("Enter");
    await rowOf(page, "temp-1").waitFor({state: "detached", timeout: 10_000});
}));

// #225 화면의 나머지 흐름
/**
 * 등록 코드 발급 응답이 브라우저에 도착한 순서. 그 요청이 보낸 ttlMinutes(만료 없음이면 null)로 적는다.
 * 임시 발급은 고른 기한과 관계없이 15분으로 답하므로 응답 값으로는 요청을 가리지 못한다.
 * 고정 대기 대신 실제 도착을 기다리고, 요청이 겹쳤는지를 도착 순서로 가린다.
 */
const recordEnrollmentResponses = (page: Page) => {
    const arrived: Array<number | null> = [];
    page.on("response", (response) => {
        // 확인 요청(/enrollmentCode/confirm)은 세지 않는다.
        if(!new URL(response.url()).pathname.endsWith("/enrollmentCode")) return;
        arrived.push(response.request().postDataJSON()?.ttlMinutes ?? null);
    });
    return arrived;
};

const commandText = async (page: Page) => (await page.locator(".enroll-modal #enroll-command").textContent())?.trim() ?? "";

test("#225 an existing row issues a code; the command uses the address as typed and Esc returns focus to the button", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await page.locator("#clients-address").fill("");

    await rowOf(page, "client-a").locator(".client-code").click();
    await page.locator(".enroll-modal").waitFor({state: "visible"});
    const first = await commandText(page);
    expect(first).toMatch(/^TTTGate client join <server-address>:9126 --code \S+$/);

    await page.keyboard.press("Escape");
    await page.locator(".enroll-modal").waitFor({state: "hidden"});
    expect(await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return active?.classList.contains("client-code") ? active.closest(".client-row")?.getAttribute("data-client-id") : null;
    })).toBe("client-a");

    await page.locator("#clients-address").fill("gw.example.com");
    await rowOf(page, "client-a").locator(".client-code").click();
    await page.locator(".enroll-modal").waitFor({state: "visible"});
    const second = await commandText(page);
    expect(second).toMatch(/^TTTGate client join gw\.example\.com:9126 --code \S+$/);
    expect(second.split(" ").pop()).not.toBe(first.split(" ").pop());
}));

// #313: 모달에서 만료를 고르면 그 기한으로 새 코드를 받는다. 만료 없음은 "Never expires" 와 안내를 보이고 시간이 지나도 흐려지지 않는다.
test("#313 the code modal chooses the expiry, including no expiry", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await page.locator("#clients-address").fill("gw.example.com");
    await rowOf(page, "client-a").locator(".client-code").click();
    const select = page.locator(".enroll-modal #enroll-ttl");
    await select.waitFor({state: "visible"});
    expect(await select.inputValue()).toBe("15");
    const before = await commandText(page);

    await select.selectOption("never");
    await page.waitForFunction((old) => document.querySelector("#enroll-command")?.textContent?.trim() !== old, before, {timeout: 5000});
    const modal = page.locator(".enroll-modal");
    expect(await modal.textContent()).toContain("Never expires");
    // 임시로 받은 뒤, 코드를 보여 주며 고른 기한을 확인한다.
    const calls = await app.calls();
    expect(calls.filter((call) => call.method === "issueEnrollmentCode").at(-1)!.args[2]).toEqual({provisional: true});
    expect(calls.filter((call) => call.method === "confirmEnrollmentCode").map((call) => call.args[0])).toEqual(["client-a"]);
    await modal.locator("#enroll-never-warning").waitFor({state: "visible"});
    // 경고는 README 와 같이 코드가 무효가 되는 경우를 모두 알린다.
    const warning = await modal.locator("#enroll-never-warning").textContent();
    for(const reason of ["used", "new code is issued", "new secret", "client is deleted", "control port settings change", "server restarts"]) expect(warning).toContain(reason);
    await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 365 * 24 * 3600_000; });
    // 화면은 1초마다 now 를 갱신한다. 그 사이 "Expired" 로 바뀌지 않는지 갱신을 두 번 넘겨 본다.
    await page.waitForFunction(() => { const w = window as any; w.__ticks = (w.__ticks ?? 0) + 1; return w.__ticks > 2; }, undefined, {polling: 1000, timeout: 10_000});
    expect(await page.locator(".enroll-modal #enroll-command.expired").count()).toBe(0);
    expect(await page.locator("#enroll-reissue").count()).toBe(0);
    // 경고는 선택 칸의 설명으로 연결된다.
    expect(await select.getAttribute("aria-describedby")).toBe("enroll-never-warning");
}));

// #313: 숫자 기한은 그 분 수로 요청하고, 키보드로 바꿔도 선택 칸이 포커스를 잃지 않는다.
// 다른 클라이언트의 창을 새로 열면 고른 값이 넘어가지 않고 15분으로 돌아간다.
test("#313 the chosen expiry is sent, keeps focus, and does not carry over to another client", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await rowOf(page, "client-a").locator(".client-code").click();
    const select = page.locator(".enroll-modal #enroll-ttl");
    await select.waitFor({state: "visible"});
    const issuedTtls = async () => (await app.calls()).filter((call) => call.method === "issueEnrollmentCode").map((call) => call.args[1]);
    await select.selectOption("10080");
    await waitUntil(async () => (await issuedTtls()).includes(10080 * 60_000), {timeoutMs: 5000, label: "7 days requested"});

    await select.focus();
    await page.keyboard.press("ArrowDown");
    await waitUntil(async () => (await issuedTtls()).includes(43200 * 60_000), {timeoutMs: 5000, label: "30 days requested"});
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("enroll-ttl");

    await select.selectOption("never");
    // 선택지 이름에도 "Never expires" 가 있으므로, 응답이 왔는지는 안내 문단으로 본다.
    await page.locator(".enroll-modal #enroll-never-warning").waitFor({state: "visible", timeout: 5000});
    await page.keyboard.press("Escape");
    await page.locator(".enroll-modal").waitFor({state: "hidden"});

    const issuedBefore = (await app.calls()).filter((call) => call.method === "issueEnrollmentCode").length;
    await rowOf(page, "client-b").locator(".client-code").click();
    await page.locator(".enroll-modal").waitFor({state: "visible"});
    await waitUntil(async () => (await issuedTtls()).length > issuedBefore, {timeoutMs: 5000, label: "client-b code issued"});
    const last = (await app.calls()).filter((call) => call.method === "issueEnrollmentCode").pop()!;
    expect(last.args).toEqual(["client-b", 15 * 60_000, {provisional: true}]);
    expect(await page.locator(".enroll-modal #enroll-ttl").inputValue()).toBe("15");
    // 선택지 이름에도 "Never expires" 가 있으므로, 만료 없음 안내가 없고 만료 시각이 보이는지로 판정한다.
    expect(await page.locator(".enroll-modal #enroll-never-warning").count()).toBe(0);
    expect(await page.locator(".enroll-modal").textContent()).toMatch(/Expires \d{4}-\d{2}-\d{2}/);
}));

// #313: 응답이 거꾸로 도착해도 마지막으로 고른 기한의 코드가 남고, 발급이 실패하면 선택이 마지막 성공 값으로 돌아간다.
test("#313 the last choice wins over a late response, and a failed issue restores the choice", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await rowOf(page, "client-a").locator(".client-code").click();
    const select = page.locator(".enroll-modal #enroll-ttl");
    await select.waitFor({state: "visible"});
    const issued = async () => (await app.calls()).filter((call) => call.method === "issueEnrollmentCode").map((call) => call.args[1]);
    const arrived = recordEnrollmentResponses(page);
    const start = (await issued()).length;

    // 앞 요청(만료 없음)이 늦게 끝나는 동안 60분을 고른다. 앞 요청이 끝나기 전에는 다음 요청을 보내지 않고,
    // 끝난 뒤 마지막 선택(60분)으로 보낸다. 그래서 서버가 받는 순서와 화면의 최신이 늘 같다.
    await app.enrollmentDelays([1500, 0]);
    await select.selectOption("never");
    await waitUntil(async () => (await issued()).length === start + 1, {timeoutMs: 5000, label: "first request sent"});
    await select.selectOption("60");
    await waitUntil(async () => arrived.length >= 2, {timeoutMs: 10_000, label: "both responses arrived"});
    // 응답이 도착한 뒤 화면이 처리를 마칠 때(버튼이 다시 켜짐)까지 기다린 다음 확인한다.
    await waitUntil(() => rowOf(page, "client-a").locator(".client-code").isEnabled(), {timeoutMs: 5000, label: "screen idle"});
    // 직렬이면 늦은 첫 요청(만료 없음)의 응답이 먼저 온다. 겹쳐 보냈다면 지연 없는 60분 응답이 먼저 온다.
    expect(arrived.slice(0, 2)).toEqual([null, 60]);
    expect((await issued()).slice(start)).toEqual([null, 60 * 60_000]);
    expect(await select.inputValue()).toBe("60");
    expect(await page.locator(".enroll-modal #enroll-never-warning").count()).toBe(0);
    expect(await page.locator(".enroll-modal").textContent()).toMatch(/Expires \d{4}-\d{2}-\d{2}/);

    await app.serverOption({tls: false});
    await select.selectOption("1440");
    await waitUntil(async () => (await select.inputValue()) === "60", {timeoutMs: 5000, label: "choice restored after a failed issue"});

    // 요청 자체가 실패해도(네트워크 오류) 선택을 되돌린다.
    await app.serverOption({tls: true});
    await page.route("**/enrollmentCode", (route) => route.abort());
    await select.selectOption("10080");
    await waitUntil(async () => (await select.inputValue()) === "60", {timeoutMs: 5000, label: "choice restored after a network error"});
    await page.unroute("**/enrollmentCode");
}));

/** 발급(issueEnrollmentCode)이 받은 기한(ms, null 은 만료 없음)과 확인(confirmEnrollmentCode) 호출을 읽는다. */
const enrollmentCalls = async (app: {calls: () => Promise<Array<{method: string, args: any[]}>>}) => {
    const calls = await app.calls();
    return {
        ttls: calls.filter((call) => call.method === "issueEnrollmentCode").map((call) => call.args[1]),
        confirms: calls.filter((call) => call.method === "confirmEnrollmentCode").map((call) => call.args)
    };
};

// #313: 창에서 기한을 바꾼 뒤 응답이 오기 전에 창을 닫으면, 늦게 온 응답이 창을 다시 열지 않고 고른 기한을 확인하지도 않는다.
// 확인하지 않은 코드는 기본 15분 뒤 사라지므로, 아무도 보지 못한 만료 없는 코드가 남지 않는다.
test("#313 a late response neither reopens a closed code window nor confirms the long expiry", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await rowOf(page, "client-a").locator(".client-code").click();
    const select = page.locator(".enroll-modal #enroll-ttl");
    await select.waitFor({state: "visible"});
    const start = (await enrollmentCalls(app)).ttls.length;
    await app.enrollmentDelays([1500]);
    await select.selectOption("never");
    await waitUntil(async () => (await enrollmentCalls(app)).ttls.length > start, {timeoutMs: 5000, label: "request sent"});
    const arrived = recordEnrollmentResponses(page);
    await page.keyboard.press("Escape");
    await page.locator(".enroll-modal").waitFor({state: "hidden"});
    await waitUntil(async () => arrived.length >= 1, {timeoutMs: 10_000, label: "late response arrived"});
    await waitUntil(() => rowOf(page, "client-a").locator(".client-code").isEnabled(), {timeoutMs: 5000, label: "screen idle"});
    await page.waitForTimeout(500);
    expect(await page.locator(".enroll-modal").isVisible()).toBe(false);
    const {ttls, confirms} = await enrollmentCalls(app);
    expect(ttls.slice(start)).toEqual([null]);
    expect(confirms).toEqual([]);
}));

// #313: 요청 중에 다른 화면으로 가도 창을 닫은 것과 같다. 기억해 둔 선택은 보내지 않고, 늦게 온 코드는 확인하지 않는다.
test("#313 leaving the screen during a request sends nothing more", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await rowOf(page, "client-a").locator(".client-code").click();
    const select = page.locator(".enroll-modal #enroll-ttl");
    await select.waitFor({state: "visible"});
    const start = (await enrollmentCalls(app)).ttls.length;
    await app.enrollmentDelays([1500]);
    await select.selectOption("60");
    await waitUntil(async () => (await enrollmentCalls(app)).ttls.length > start, {timeoutMs: 5000, label: "request sent"});
    const arrived = recordEnrollmentResponses(page);
    await select.selectOption("never");
    await page.evaluate(() => { location.hash = "#/status"; });
    await waitUntil(async () => arrived.length >= 1, {timeoutMs: 10_000, label: "late response arrived"});
    await page.waitForTimeout(1000);
    const {ttls, confirms} = await enrollmentCalls(app);
    expect(ttls.slice(start)).toEqual([60 * 60_000]);
    expect(confirms).toEqual([]);
}));

// #313: 발급이 실패하면 서버에서는 화면의 코드도 이미 무효일 수 있다(다른 발급, 설정 변경, 삭제). 복사하지 못하게 하고 다시 받게 한다.
test("#313 a failed issue marks the shown command as no longer valid", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await rowOf(page, "client-a").locator(".client-code").click();
    const select = page.locator(".enroll-modal #enroll-ttl");
    await select.waitFor({state: "visible"});
    await select.selectOption("never");
    await page.locator(".enroll-modal #enroll-never-warning").waitFor({state: "visible", timeout: 5000});
    await app.serverOption({tls: false});
    await select.selectOption("60");
    await page.locator("#enroll-reissue button").waitFor({state: "visible", timeout: 5000});
    expect(await page.locator("#enroll-copy").count()).toBe(0);
    expect(await page.locator(".enroll-modal #enroll-command.expired").count()).toBe(1);
    expect(await page.locator(".enroll-modal").textContent()).toContain("This code no longer works");
    // 선택 칸의 설명은 화면에 있는 요소만 가리킨다.
    const describedby = await select.getAttribute("aria-describedby");
    if(describedby) expect(await page.locator(`#${describedby}`).count()).toBe(1);

    await app.serverOption({tls: true});
    await page.locator("#enroll-reissue button").click();
    await page.locator("#enroll-copy button").waitFor({state: "visible", timeout: 5000});
    expect(await page.locator(".enroll-modal #enroll-command.expired").count()).toBe(0);
}));

// #313: 화면은 임시로 받고, 코드를 보여 줄 때 고른 기한을 확인한다. 응답을 잃은 코드는 확인하지 않으므로 기본 15분 뒤 사라진다.
test("#313 a long-expiry code whose response was lost is never confirmed", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await rowOf(page, "client-a").locator(".client-code").click();
    const select = page.locator(".enroll-modal #enroll-ttl");
    await select.waitFor({state: "visible"});
    // 서버는 처리하지만 응답은 프록시 오류로 바뀐다.
    await page.route("**/enrollmentCode", async (route) => {
        await route.fetch();
        await route.fulfill({status: 502, contentType: "text/html", body: "<html>Bad Gateway</html>"});
    });
    await select.selectOption("never");
    await page.locator("#enroll-reissue button").waitFor({state: "visible", timeout: 5000});
    await page.unroute("**/enrollmentCode");
    await page.keyboard.press("Escape");
    await page.locator(".enroll-modal").waitFor({state: "hidden"});
    await page.waitForTimeout(1000);
    expect((await enrollmentCalls(app)).confirms).toEqual([]);
}));

// #313: 본 코드는 고른 기한으로 확인하고, 창을 닫아도 그대로 둔다. 사용자가 복사해 둔 명령이 무효가 되면 안 된다.
test("#313 a shown long-expiry code is confirmed and kept when the window closes", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await rowOf(page, "client-a").locator(".client-code").click();
    const select = page.locator(".enroll-modal #enroll-ttl");
    await select.waitFor({state: "visible"});
    const start = (await enrollmentCalls(app)).ttls.length;
    await select.selectOption("never");
    await page.locator(".enroll-modal #enroll-never-warning").waitFor({state: "visible", timeout: 5000});
    expect((await enrollmentCalls(app)).confirms).toEqual([["client-a", expect.any(Number)]]);
    await page.keyboard.press("Escape");
    await page.locator(".enroll-modal").waitFor({state: "hidden"});
    await page.waitForTimeout(1000);
    const {ttls, confirms} = await enrollmentCalls(app);
    expect(ttls.slice(start)).toEqual([null]);
    expect(confirms).toHaveLength(1);
}));

// #313: 고른 기한은 코드를 창에 보여 준 다음에 확인한다. 보여 주기 전에 확인하면, 그 사이 창을 닫았을 때 아무도 못 본 긴 기한의 코드가 남는다.
test("#313 the new code is shown before its long expiry is confirmed", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await rowOf(page, "client-a").locator(".client-code").click();
    const select = page.locator(".enroll-modal #enroll-ttl");
    await select.waitFor({state: "visible"});
    const before = await commandText(page);
    await app.confirmOutcomes([{delayMs: 2000}]);
    await select.selectOption("never");
    await waitUntil(async () => (await enrollmentCalls(app)).confirms.length === 1, {timeoutMs: 5000, label: "confirm sent"});
    // 확인 응답은 아직 오지 않았다. 새 코드는 이미 보여야 한다.
    expect(await commandText(page)).not.toBe(before);
    await page.locator(".enroll-modal #enroll-never-warning").waitFor({state: "visible", timeout: 10_000});
}));

// #313: 확인이 실패하면 그 코드는 대체되었거나 무효다(또는 응답만 잃었다). 복사하지 못하게 하고 다시 받게 하며, 선택을 되돌린다.
test("#313 a failed confirmation marks the code as no longer valid", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await rowOf(page, "client-a").locator(".client-code").click();
    const select = page.locator(".enroll-modal #enroll-ttl");
    await select.waitFor({state: "visible"});
    await app.confirmOutcomes([{fail: true}]);
    await select.selectOption("never");
    await page.locator("#enroll-reissue button").waitFor({state: "visible", timeout: 5000});
    expect(await page.locator("#enroll-copy").count()).toBe(0);
    expect(await page.locator(".enroll-modal").textContent()).toContain("This code no longer works");
    expect(await select.inputValue()).toBe("15");
}));

// #313: 확인은 같은 요청을 다시 보내도 결과가 같다. 응답만 잃었으면 한 번 더 보내 실제 결과를 받는다.
test("#313 a lost confirmation response is retried once", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await rowOf(page, "client-a").locator(".client-code").click();
    const select = page.locator(".enroll-modal #enroll-ttl");
    await select.waitFor({state: "visible"});
    const start = (await enrollmentCalls(app)).ttls.length;
    await page.route("**/enrollmentCode/confirm", async (route) => {
        await route.fetch();
        await route.fulfill({status: 502, contentType: "text/html", body: "<html>Bad Gateway</html>"});
    }, {times: 1});
    await select.selectOption("never");
    await page.locator(".enroll-modal #enroll-never-warning").waitFor({state: "visible", timeout: 10_000});
    const {ttls, confirms} = await enrollmentCalls(app);
    expect(ttls.slice(start)).toEqual([null]);
    expect(confirms).toHaveLength(2);
    expect(await page.locator("#enroll-copy button").isEnabled()).toBe(true);
}));

// #313: 확인 결과를 끝내 모르면 서버에는 만료 없는 코드가 있을 수 있다. 기본 15분 코드로 다시 받아 그 코드를 대체한다.
test("#313 an unknown confirmation result is replaced by a default-expiry code", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await rowOf(page, "client-a").locator(".client-code").click();
    const select = page.locator(".enroll-modal #enroll-ttl");
    await select.waitFor({state: "visible"});
    const start = (await enrollmentCalls(app)).ttls.length;
    await page.route("**/enrollmentCode/confirm", async (route) => {
        await route.fetch();
        await route.fulfill({status: 502, contentType: "text/html", body: "<html>Bad Gateway</html>"});
    });
    await select.selectOption("never");
    await waitUntil(async () => (await enrollmentCalls(app)).ttls.length >= start + 2, {timeoutMs: 10_000, label: "replacement issued"});
    await waitUntil(() => rowOf(page, "client-a").locator(".client-code").isEnabled(), {timeoutMs: 5000, label: "screen idle"});
    expect((await enrollmentCalls(app)).ttls.slice(start)).toEqual([null, 15 * 60_000]);
    expect(await select.inputValue()).toBe("15");
    expect(await page.locator(".enroll-modal #enroll-never-warning").count()).toBe(0);
    expect(await page.locator("#enroll-copy button").isEnabled()).toBe(true);
    await page.unroute("**/enrollmentCode/confirm");
}));

// #313: 새 코드를 받는 동안에는 곧 무효가 될 옛 명령을 복사하지 못하게 한다.
test("#313 Copy command is off while a new code is on its way", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await rowOf(page, "client-a").locator(".client-code").click();
    const select = page.locator(".enroll-modal #enroll-ttl");
    await select.waitFor({state: "visible"});
    const copy = page.locator("#enroll-copy button");
    expect(await copy.isEnabled()).toBe(true);
    const issued = async () => (await app.calls()).filter((call) => call.method === "issueEnrollmentCode").length;
    const start = await issued();
    await app.enrollmentDelays([1500]);
    await select.selectOption("60");
    await waitUntil(async () => (await issued()) > start, {timeoutMs: 5000, label: "request sent"});
    expect(await copy.isDisabled()).toBe(true);
    await waitUntil(() => copy.isEnabled(), {timeoutMs: 10_000, label: "copy back on"});
}));

// #313: 요청 중에 고른 기한은 창을 닫으면 버린다. 닫힌 창에 온 코드는 확인하지 않는다.
test("#313 a choice queued during a request is dropped when the code window closes", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await rowOf(page, "client-a").locator(".client-code").click();
    const select = page.locator(".enroll-modal #enroll-ttl");
    await select.waitFor({state: "visible"});
    const start = (await enrollmentCalls(app)).ttls.length;
    await app.enrollmentDelays([1500]);
    await select.selectOption("60");
    await waitUntil(async () => (await enrollmentCalls(app)).ttls.length > start, {timeoutMs: 5000, label: "request sent"});
    const arrived = recordEnrollmentResponses(page);
    await select.selectOption("never");
    await page.keyboard.press("Escape");
    await page.locator(".enroll-modal").waitFor({state: "hidden"});
    await waitUntil(async () => arrived.length >= 1, {timeoutMs: 10_000, label: "late response arrived"});
    await waitUntil(() => rowOf(page, "client-a").locator(".client-code").isEnabled(), {timeoutMs: 5000, label: "screen idle"});
    await page.waitForTimeout(1000);
    const {ttls, confirms} = await enrollmentCalls(app);
    expect(ttls.slice(start)).toEqual([60 * 60_000]);
    expect(confirms).toEqual([]);
}));

test("#225 after expiry, Issue new code shows a new, live command", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await page.locator("#clients-address").fill("gw.example.com");
    await rowOf(page, "client-a").locator(".client-code").click();
    const before = await commandText(page);
    await page.evaluate(() => { const real = Date.now; (window as any).__realNow = real; Date.now = () => real() + 2 * 3600_000; });
    await page.locator("#enroll-reissue button").waitFor({state: "visible", timeout: 5000});
    // 재발급 응답의 만료 시각은 진짜 시계 기준이다. 화면 시계를 되돌린 뒤 누른다.
    await page.evaluate(() => { Date.now = (window as any).__realNow; });
    await page.locator("#enroll-reissue button").click();
    await page.waitForFunction((old) => document.querySelector("#enroll-command")?.textContent?.trim() !== old, before, {timeout: 5000});
    expect(await page.locator(".enroll-modal #enroll-command.expired").count()).toBe(0);
    expect(await page.locator("#enroll-copy").count()).toBe(1);
}));

test("#225 New secret asks for confirmation, then shows a fresh enrollment command", () => withApp({fixture: "rbac"}, async (app) => {
    const {page} = app;
    await app.serverOption({tls: true, port: 9126});
    await openClients(page);
    await rowOf(page, "client-b").locator(".client-rotate").click();
    const confirm = page.locator(".rotate-client-modal");
    await confirm.waitFor({state: "visible"});
    expect(await confirm.textContent()).toContain("client-b");
    await page.locator("#confirm-rotate-client button").click();
    await page.getByText(/New secret for client-b/).waitFor({state: "visible", timeout: 10_000});
    await page.locator(".enroll-modal").waitFor({state: "visible"});
    expect(await commandText(page)).toMatch(/--code \S+$/);
    const calls = await app.calls();
    expect(calls.filter((call) => call.method === "issueEnrollmentCode").length).toBeGreaterThanOrEqual(1);
}));

