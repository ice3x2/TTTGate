import type {Page, Request} from "playwright";
import {startAdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";

// 이슈 369 — 터널 목록 줄의 가동 정보·허용 클라이언트와 연결 창(끊기·차단·겹친 창 Esc).
// 상태와 연결 목록 응답은 가로채 정한 값으로 준다. 서버의 집계·끊기·차단은 관리 API·실제 소켓 테스트가 맡는다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const PORT = 20001;
const MY_IP = "198.51.100.23";
type Connection = {id: number; remoteAddress: string; remotePort: number; connectedAt: number; rx: number; tx: number};

const row = (page: Page, port: number) => page.locator(`li[data-port="${port}"]`);

/** 상태 응답: 20001 은 켜진 지 2시간 5분, 연결 2, RX 59,535·TX 60,900 바이트, 허용 클라이언트 둘(하나는 연결 안 됨). 20002 는 꺼짐. */
const stubStatus = async (page: Page) => {
    await page.route("**/api/externalServerStatuses", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        const statuses = (body.statuses as Array<Record<string, unknown>>).map((status) => status.port === PORT
            ? {...status, online: true, active: true, sessions: 2, activatedAt: body.serverTime - 7_500_000, activeTimeout: 0, rx: 59_535, tx: 60_900,
                allowedClients: [{clientId: "c1", name: "Office PC", connected: true}, {clientId: "c2", name: "Lab", connected: false}]}
            : {...status, active: false, sessions: 0, allowedClients: []});
        await route.fulfill({response, json: {...body, requesterIp: MY_IP, statuses}});
    });
};

const stubConnections = async (page: Page, sets: Connection[][], truncated = false, total?: number) => {
    let call = 0;
    const requests: Request[] = [];
    await page.route(`**/api/tunneling/${PORT}/connections`, async (route) => {
        requests.push(route.request());
        const connections = sets[Math.min(call++, sets.length - 1)];
        await route.fulfill({json: {success: true, serverTime: Date.now(), countryLookup: false, truncated, total: total ?? connections.length, connections}});
    });
    return requests;
};

/** 지금 초점이 있는 요소의 보조 기술용 이름과 aria-disabled. */
const focused = (page: Page) => page.evaluate(() => ({label: document.activeElement?.getAttribute("aria-label") ?? null,
    disabled: document.activeElement?.getAttribute("aria-disabled") ?? null}));

const conn = (id: number, remoteAddress: string, agoMs: number): Connection =>
    ({id, remoteAddress, remotePort: 50_000 + id, connectedAt: Date.now() - agoMs, rx: 1200, tx: 3400});

// 로그인하면 이미 #/tunnels 에 있어 같은 해시로는 화면을 다시 읽지 않는다(#338). 가로채기 전의 상태 응답으로 그린 줄이
// 먼저 보이므로, 줄이 보이는 것만으로는 부족하다. 가로챈 상태 응답(RX 59,535 바이트)이 그려질 때까지 기다린다.
const openList = async (page: Page, url: string) => {
    await page.goto(`${url}#/tunnels`);
    await page.waitForFunction((port) => document.querySelector(`li[data-port="${port}"] .tunnel-stats-line`)?.textContent?.includes("RX 58.1KiB") === true,
        PORT, {timeout: 10_000});
};

const openDialog = async (page: Page) => {
    await row(page, PORT).getByRole("button", {name: /^Show the 2 connections to /}).click();
    const dialog = page.getByRole("dialog", {name: /^Connections to /});
    await dialog.waitFor({state: "visible", timeout: 10_000});
    return dialog;
};

test("AC-1·AC-2·AC-3·AC-14 켜진 줄은 '켜진 지'·KiB 가동 정보와 연결 버튼을, 상태 글자에는 연결 수를 두 번 보이지 않고, 허용 클라이언트를 보인다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await stubStatus(app.page);
        await openList(app.page, app.url);
        const meta = row(app.page, PORT).locator(".tunnel-meta-row");
        expect((await meta.locator(".tunnel-stats-line").textContent())?.trim()).toBe("On for 2h, 5m · RX 58.1KiB · TX 59.5KiB");
        expect((await meta.locator(".tunnel-conn").textContent())?.trim()).toBe("Connections 2›");
        expect(await row(app.page, PORT).locator(".tunnel-status").textContent()).not.toContain("connection");
        expect(await row(app.page, PORT).locator(".tunnel-status").textContent()).not.toContain("Uptime");
        const clients = meta.locator(".tunnel-clients");
        // 설계 "● NAS, ○ 집 PC 외 1": 이름 사이를 쉼표로 나눈다.
        expect(await clients.locator(".client").allTextContents()).toEqual(["●Office PC,", "○Lab"]);
        expect(await clients.locator(".client.offline").count()).toBe(1);
        expect(await clients.getAttribute("title")).toBe("Office PC, Lab (not connected)");
        // 꺼진 터널에는 가동 정보가 없고, 허용 클라이언트("Any")는 보인다.
        expect(await row(app.page, 20002).locator(".tunnel-stats").count()).toBe(0);
        expect((await row(app.page, 20002).locator(".tunnel-clients .client").allTextContents())).toEqual(["Any"]);
        // 연결 버튼은 줄 링크 밖이다(누르면 편집 화면으로 가지 않는다).
        expect(await row(app.page, PORT).locator("a.tunnel-link .tunnel-conn").count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-5·AC-10·AC-13 연결 창은 주소·RX·TX 와 32px 아이콘 버튼을 보이고, 새 연결은 2초 안에 맨 아래에 붙으며, 닫으면 요청을 멈춘다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await stubStatus(app.page);
        const requests = await stubConnections(app.page, [[conn(2, "203.0.113.7", 60_000), conn(1, MY_IP, 3_600_000)],
            [conn(3, "192.0.2.44", 1_000), conn(2, "203.0.113.7", 60_000), conn(1, MY_IP, 3_600_000)]]);
        await openList(app.page, app.url);
        const dialog = await openDialog(app.page);
        await dialog.locator("li.conn").first().waitFor({state: "visible", timeout: 10_000});
        expect(await dialog.locator(".conn-addr").allTextContents()).toEqual(["203.0.113.7", `${MY_IP}Your IP`]);
        // M6: 맨 위 요약과, 데스크톱에서 640px 로 넓힌 창.
        expect(await dialog.locator(".conn-summary").textContent()).toBe("2 connections · Refreshes every 2 seconds");
        const close = dialog.getByRole("button", {name: "Disconnect 203.0.113.7", exact: true});
        const box = await close.boundingBox();
        expect([Math.round(box!.width), Math.round(box!.height)]).toEqual([32, 32]);
        expect(await close.getAttribute("title")).toBe("Disconnect");
        expect(await dialog.getByRole("button", {name: "Block 203.0.113.7", exact: true}).count()).toBe(1);
        // 2초마다 다시 읽는다. 새 연결은 순서를 흔들지 않고 맨 아래에 "New" 로 붙는다.
        await app.page.waitForFunction(() => document.querySelectorAll("[role=dialog] li.conn").length === 3, undefined, {timeout: 5_000});
        expect(await dialog.locator(".conn-addr").first().textContent()).toBe("203.0.113.7");
        expect(await dialog.locator("li.conn").last().locator(".new-tag").textContent()).toBe("New");
        expect(await dialog.locator(".conn-summary").textContent()).toBe("3 connections · Refreshes every 2 seconds");
        // M6: 새 연결은 화면 낭독기에 조용히(polite) 알린다.
        expect(await dialog.locator("[aria-live=polite]").textContent()).toBe("1 new connection");
        await dialog.getByRole("button", {name: "Dismiss", exact: true}).click();
        await dialog.waitFor({state: "hidden"});
        const count = requests.length;
        await app.page.waitForTimeout(4_500);
        expect(requests.length).toBe(count);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("M-2 빈 목록으로 연 창에 연결이 들어오면 '새'로 붙고 화면 낭독기에 알린다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await stubStatus(app.page);
        await stubConnections(app.page, [[], [conn(1, "192.0.2.44", 1_000)]]);
        await openList(app.page, app.url);
        const dialog = await openDialog(app.page);
        await dialog.getByText("No connections right now.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
        await dialog.locator('li[data-connection="1"]').waitFor({state: "visible", timeout: 5_000});
        expect(await dialog.locator('li[data-connection="1"] .new-tag').textContent()).toBe("New");
        expect(await dialog.locator("[aria-live=polite]").textContent()).toBe("1 new connection");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("M6 데스크톱에서는 연결 창 폭이 640px 이다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await app.page.setViewportSize({width: 1280, height: 900});
        await stubStatus(app.page);
        await stubConnections(app.page, [[conn(2, "203.0.113.7", 60_000)]]);
        await openList(app.page, app.url);
        const dialog = await openDialog(app.page);
        await dialog.locator("li.conn").first().waitFor({state: "visible", timeout: 10_000});
        expect(Math.round((await dialog.boundingBox())!.width)).toBe(640);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-6(화면) 끊기는 묻지 않고 DELETE 를 보내며, 그 줄을 '끊음'으로 흐리게 남긴다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await stubStatus(app.page);
        await stubConnections(app.page, [[conn(2, "203.0.113.7", 60_000), conn(1, MY_IP, 3_600_000)]]);
        const deletes: string[] = [];
        await app.page.route(`**/api/tunneling/${PORT}/connections/*`, async (route) => {
            deletes.push(new URL(route.request().url()).pathname);
            await route.fulfill({json: {success: true, closed: true}});
        });
        await openList(app.page, app.url);
        const dialog = await openDialog(app.page);
        await dialog.getByRole("button", {name: "Disconnect 203.0.113.7", exact: true}).click();
        await dialog.locator('li[data-connection="2"].ended').waitFor({state: "visible", timeout: 10_000});
        expect(deletes).toEqual([`/api/tunneling/${PORT}/connections/2`]);
        expect(await dialog.locator('li[data-connection="2"] .tag').first().textContent()).toBe("Disconnected");
        expect(await app.page.getByRole("dialog").count()).toBe(1);
        await app.page.getByText("Disconnected.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
        // M5: 버튼은 사라지지 않고 aria-disabled 로 남아 키보드 초점이 그 버튼에 머문다.
        expect(await focused(app.page)).toEqual({label: "Disconnect 203.0.113.7", disabled: "true"});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("M3 이미 끝난 연결(closed:false)을 끊으면 줄을 '끝남'으로 바꾸고 알림을 띄우지 않는다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await stubStatus(app.page);
        await stubConnections(app.page, [[conn(2, "203.0.113.7", 60_000), conn(1, MY_IP, 3_600_000)]]);
        await app.page.route(`**/api/tunneling/${PORT}/connections/*`, (route) => route.fulfill({json: {success: true, closed: false}}));
        await openList(app.page, app.url);
        const dialog = await openDialog(app.page);
        await dialog.getByRole("button", {name: "Disconnect 203.0.113.7", exact: true}).click();
        await dialog.locator('li[data-connection="2"].ended').waitFor({state: "visible", timeout: 10_000});
        expect(await dialog.locator('li[data-connection="2"] .tag').first().textContent()).toBe("Ended");
        await app.page.waitForTimeout(500);
        expect(await app.page.getByText("Disconnected.", {exact: true}).count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("M4·M-1 잘린 응답이면 '최근 500개' 안내와 서버의 전체 연결 수를 보이고, 받은 목록보다 오래된 줄은 끝남으로 바꾸지 않고 숨긴다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await stubStatus(app.page);
        const requests = await stubConnections(app.page, [[conn(2, "203.0.113.7", 60_000), conn(1, MY_IP, 3_600_000)],
            [conn(3, "192.0.2.44", 1_000), conn(2, "203.0.113.7", 60_000)]], true, 812);
        await openList(app.page, app.url);
        const dialog = await openDialog(app.page);
        await dialog.getByText("Showing the latest 500.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
        expect(await dialog.locator(".conn-summary").textContent()).toBe("812 connections · Refreshes every 2 seconds");
        await dialog.locator('li[data-connection="3"]').waitFor({state: "visible", timeout: 5_000});
        expect(requests.length).toBeGreaterThanOrEqual(2);
        // 1 은 받은 목록의 가장 오래된 연결(2)보다 오래되어 살아 있는지 알 수 없다. 끝남으로 남기지 않고 숨긴다.
        expect(await dialog.locator('li[data-connection="1"]').count()).toBe(0);
        expect(await dialog.locator("li.conn").count()).toBe(2);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("M-3 옛 서버(상태 응답에 allowedClients 없음)면 연결 수를 처음부터 글자로 둔다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await app.page.route("**/api/externalServerStatuses", async (route) => {
            const response = await route.fetch();
            const body = await response.json();
            const statuses = (body.statuses as Array<Record<string, unknown>>).map(({allowedClients: _clients, ...status}) => status.port === PORT
                ? {...status, online: true, active: true, sessions: 2, activeTimeout: 0, rx: 59_535, tx: 60_900} : {...status, active: false, sessions: 0});
            await route.fulfill({response, json: {...body, requesterIp: MY_IP, statuses}});
        });
        await openList(app.page, app.url);
        expect(await row(app.page, PORT).locator(".tunnel-conn").count()).toBe(0);
        expect((await row(app.page, PORT).locator(".tunnel-conn-text").textContent())?.trim()).toBe("Connections 2");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("M-3 새 서버가 연결 목록에 404 를 주면 더 볼 수 없다고 알리고 창만 닫는다. 다른 터널의 연결 버튼은 그대로다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await stubStatus(app.page);
        await app.page.route(`**/api/tunneling/${PORT}/connections`, (route) =>
            route.fulfill({status: 404, json: {success: false, code: "not_found", message: "Not Found"}}));
        await openList(app.page, app.url);
        const dialog = await openDialog(app.page);
        await app.page.getByText("You can no longer see the connections to this tunnel.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
        await dialog.waitFor({state: "hidden", timeout: 5_000});
        expect(await row(app.page, PORT).locator(".tunnel-conn").count()).toBe(1);
        expect(await row(app.page, PORT).locator(".tunnel-conn-text").count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("M-B 이미 읽은 창에서 연결 목록이 403(볼 수만 있음)이 되면 알리고 창을 닫는다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await stubStatus(app.page);
        let call = 0;
        await app.page.route(`**/api/tunneling/${PORT}/connections`, (route) => call++ === 0
            ? route.fulfill({json: {success: true, serverTime: Date.now(), countryLookup: false, truncated: false, total: 1, connections: [conn(2, "203.0.113.7", 60_000)]}})
            : route.fulfill({status: 403, json: {success: false, code: "read_only", message: "read only"}}));
        await openList(app.page, app.url);
        const dialog = await openDialog(app.page);
        await dialog.locator('li[data-connection="2"]').waitFor({state: "visible", timeout: 10_000});
        await app.page.getByText("You can now only view this tunnel, so its connection list was closed.", {exact: true})
            .waitFor({state: "visible", timeout: 10_000});
        await dialog.waitFor({state: "hidden", timeout: 5_000});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("M-B 이미 읽은 뒤 다시 읽기가 실패하면 옛 목록을 두고 새로 고치지 못했다고 알리며, 다음 읽기가 되면 그 안내가 사라진다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await stubStatus(app.page);
        let call = 0;
        const ok = {success: true, serverTime: Date.now(), countryLookup: false, truncated: false, total: 1, connections: [conn(2, "203.0.113.7", 60_000)]};
        await app.page.route(`**/api/tunneling/${PORT}/connections`, (route) => call++ === 1
            ? route.fulfill({status: 500, json: {success: false, code: "internal", message: "boom"}})
            : route.fulfill({json: ok}));
        await openList(app.page, app.url);
        const dialog = await openDialog(app.page);
        const note = dialog.getByText("Unable to refresh the connection list. Trying again.", {exact: true});
        await note.waitFor({state: "visible", timeout: 10_000});
        expect(await dialog.locator('li[data-connection="2"]').isVisible()).toBe(true);
        await note.waitFor({state: "hidden", timeout: 10_000});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("L-2 이미 이 터널에 걸린 차단(409 duplicate)이면 알리고 그 주소의 줄을 '차단됨'으로 바꾼다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await stubStatus(app.page);
        await stubConnections(app.page, [[conn(2, "203.0.113.7", 60_000), conn(1, MY_IP, 3_600_000)]]);
        await app.page.route("**/api/security/blocklist", async (route) => {
            if(route.request().method() !== "POST") return route.fallback();
            await route.fulfill({status: 409, json: {success: false, code: "duplicate", message: "203.0.113.7 is already blocked on all tunnels",
                address: "203.0.113.7", port: null, closedConnections: 1}});
        });
        await openList(app.page, app.url);
        const dialog = await openDialog(app.page);
        await dialog.getByRole("button", {name: "Block 203.0.113.7", exact: true}).click();
        const confirm = app.page.getByRole("dialog", {name: "Block 203.0.113.7?"});
        await confirm.waitFor({state: "visible", timeout: 10_000});
        await confirm.getByRole("button", {name: "Block", exact: true}).click();
        await confirm.waitFor({state: "hidden", timeout: 10_000});
        await app.page.getByText("This address is already blocked.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
        expect(await dialog.locator('li[data-connection="2"] .tag').first().textContent()).toBe("Blocked");
        expect(await dialog.locator('li[data-connection="1"] .tag').count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("M-1 이미 있는 차단이 다른 포트 하나에만 걸리면(409 duplicate) 그 포트를 밝혀 알리고 줄은 바꾸지 않는다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await stubStatus(app.page);
        await stubConnections(app.page, [[conn(2, "203.0.113.7", 60_000), conn(1, MY_IP, 3_600_000)]]);
        await app.page.route("**/api/security/blocklist", async (route) => {
            if(route.request().method() !== "POST") return route.fallback();
            await route.fulfill({status: 409, json: {success: false, code: "duplicate", message: "203.0.113.7 is already blocked on port 3333",
                address: "203.0.113.7", port: 3333, closedConnections: 0}});
        });
        await openList(app.page, app.url);
        const dialog = await openDialog(app.page);
        await dialog.getByRole("button", {name: "Block 203.0.113.7", exact: true}).click();
        const confirm = app.page.getByRole("dialog", {name: "Block 203.0.113.7?"});
        await confirm.waitFor({state: "visible", timeout: 10_000});
        await confirm.getByRole("button", {name: "Block", exact: true}).click();
        await confirm.waitFor({state: "hidden", timeout: 10_000});
        await app.page.getByText("This address is already blocked on port 3333 only. To change that, unblock it under Blocked addresses on the Security screen, then block it again.", {exact: true})
            .waitFor({state: "visible", timeout: 10_000});
        expect(await app.page.getByText("This address is already blocked.", {exact: true}).count()).toBe(0);
        expect(await dialog.locator('li[data-connection="2"] .tag').count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-7·AC-8·AC-12 차단은 확인 창을 먼저 띄우고, Esc 는 확인 창만 닫으며, 내 IP 면 경고하고, '이 터널만'이 기본이다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await stubStatus(app.page);
        await stubConnections(app.page, [[conn(2, "203.0.113.7", 60_000), conn(1, MY_IP, 3_600_000)]]);
        const posted: Array<Record<string, unknown>> = [];
        await app.page.route("**/api/security/blocklist", async (route) => {
            if(route.request().method() !== "POST") return route.fallback();
            posted.push(route.request().postDataJSON());
            await route.fulfill({status: 201, json: {success: true, entry: {}, unbanned: false, closedConnections: 1}});
        });
        await openList(app.page, app.url);
        const dialog = await openDialog(app.page);

        // 내 IP 를 차단하려 하면 경고가 보인다. Esc 는 확인 창만 닫고 연결 창은 남는다.
        await dialog.getByRole("button", {name: `Block ${MY_IP}`, exact: true}).click();
        const confirm = app.page.getByRole("dialog", {name: `Block ${MY_IP}?`});
        await confirm.waitFor({state: "visible", timeout: 10_000});
        expect(await confirm.getByRole("alert").textContent()).toBe("This is the address you're using now. Tunnels won't be reachable from it; the admin screen is not affected.");
        expect(await confirm.locator(".block-body").textContent()).toBe("Its 1 connection ends now, and new ones will be refused.");
        await app.page.keyboard.press("Escape");
        await confirm.waitFor({state: "hidden", timeout: 5_000});
        expect(await dialog.isVisible()).toBe(true);
        expect(posted).toEqual([]);

        // 다른 주소: 취소는 아무 요청도 보내지 않는다. 차단은 "이 터널만"과 기본 메모로 보낸다.
        await dialog.getByRole("button", {name: "Block 203.0.113.7", exact: true}).click();
        const other = app.page.getByRole("dialog", {name: "Block 203.0.113.7?"});
        await other.waitFor({state: "visible", timeout: 10_000});
        expect(await other.getByRole("alert").count()).toBe(0);
        expect(await other.getByRole("radio", {name: "This tunnel only"}).isChecked()).toBe(true);
        // 설계 목업 "이 터널만 <small>ssh-office</small>": 고르는 범위가 어느 터널인지 이름을 곁에 보인다.
        const tunnelName = (await row(app.page, PORT).locator(".tunnel-title").textContent())?.trim() ?? "";
        expect(tunnelName.length).toBeGreaterThan(0);
        expect((await other.locator("label:has(input[value=tunnel]) small").textContent())?.trim()).toBe(tunnelName);
        // L5: "모든 터널"을 고르면 다른 터널의 연결도 끊긴다는 문장으로 바뀐다.
        await other.getByRole("radio", {name: "All tunnels"}).check();
        expect(await other.locator(".block-body").textContent())
            .toBe("Its 1 connection to this tunnel ends now, as do its connections to other tunnels, if any, and new ones to every tunnel will be refused.");
        await other.getByRole("button", {name: "Cancel", exact: true}).click();
        await other.waitFor({state: "hidden"});
        expect(posted).toEqual([]);
        await dialog.getByRole("button", {name: "Block 203.0.113.7", exact: true}).click();
        await other.waitFor({state: "visible", timeout: 10_000});
        await other.getByRole("button", {name: "Block", exact: true}).click();
        await other.waitFor({state: "hidden", timeout: 10_000});
        expect(posted).toHaveLength(1);
        expect(posted[0]).toMatchObject({address: "203.0.113.7", port: PORT});
        expect(String(posted[0].note)).toMatch(/^Blocked from the connection list of /);
        await app.page.getByText("Blocked 203.0.113.7 and ended 1 connection.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
        expect(await dialog.locator('li[data-connection="2"] .tag').first().textContent()).toBe("Blocked");
        // M5: 확인 창이 닫히면 초점은 그 창을 연 차단 버튼으로 돌아가고, 그 버튼은 aria-disabled 로 남는다.
        expect(await focused(app.page)).toEqual({label: "Block 203.0.113.7", disabled: "true"});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

test("AC-11 폭 360px 에서 목록 줄과 연결 창에 가로 스크롤이 없다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await app.page.setViewportSize({width: 360, height: 800});
        await stubStatus(app.page);
        await stubConnections(app.page, [[conn(2, "2001:db8:85a3:0000:0000:8a2e:0370:7334", 60_000), conn(1, MY_IP, 3_600_000)]]);
        await openList(app.page, app.url);
        expect(await app.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        const dialog = await openDialog(app.page);
        await dialog.locator("li.conn").first().waitFor({state: "visible", timeout: 10_000});
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await app.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

// 설계 ④ .tmeta { flex:1 0 100%; padding-left:var(--s-4) }: 가동 정보·클라이언트 줄은 스위치 오른쪽에 붙지 않고 그 아래 자기 줄을 쓰며,
// 글자 왼쪽이 터널 이름과 맞는다. 켜진 터널(가동 정보+클라이언트)과 꺼진 터널(클라이언트만) 모두 같다.
test.each([[1280, 900], [360, 800]])("설계 ④ 폭 %ipx 에서 가동 정보 줄은 스위치 아래 줄에 있고 왼쪽이 터널 이름과 맞는다", async (width, height) => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await app.page.setViewportSize({width, height});
        await stubStatus(app.page);
        await openList(app.page, app.url);
        for(const port of [PORT, 20002]) {
            const line = row(app.page, port);
            const meta = (await line.locator(".tunnel-meta-row").boundingBox())!;
            const control = (await line.locator(".tunnel-switch, .tunnel-lock").first().boundingBox())!;
            expect({port, below: Math.round(meta.y) >= Math.round(control.y + control.height)}).toEqual({port, below: true});
            const title = (await line.locator(".tunnel-title").boundingBox())!;
            const first = (await line.locator(".tunnel-meta-row > :first-child").boundingBox())!;
            expect({port, left: Math.round(first.x)}).toEqual({port, left: Math.round(title.x)});
        }
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});

// 설계 ④ .pill: 연결 버튼은 IP 제한 토글과 같은 모양으로 보이는 높이 32px, 글자 fs-sm 이고, 누르는 영역은 위아래로 넓혀 44px 이다.
test("설계 ④ 연결 버튼은 보이는 높이 32px·글자 fs-sm 이고, 누르는 영역은 44px 이다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await stubStatus(app.page);
        await openList(app.page, app.url);
        const button = row(app.page, PORT).locator(".tunnel-conn");
        const box = (await button.boundingBox())!;
        expect(Math.round(box.height)).toBe(32);
        expect(await button.evaluate((element) => getComputedStyle(element).fontSize
            === getComputedStyle(document.documentElement).getPropertyValue("--fs-sm").trim())).toBe(true);
        // 보이는 테두리보다 5px 위·아래를 눌러도 이 버튼이 받는다(누르는 영역 44px).
        const hits = await button.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            return [rect.top - 5, rect.bottom + 5].map((y) => element.contains(document.elementFromPoint(x, y)));
        });
        expect(hits).toEqual([true, true]);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});
