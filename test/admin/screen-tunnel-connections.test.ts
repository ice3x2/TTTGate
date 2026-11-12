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

const stubConnections = async (page: Page, sets: Connection[][]) => {
    let call = 0;
    const requests: Request[] = [];
    await page.route(`**/api/tunneling/${PORT}/connections`, async (route) => {
        requests.push(route.request());
        const connections = sets[Math.min(call++, sets.length - 1)];
        await route.fulfill({json: {success: true, serverTime: Date.now(), connections}});
    });
    return requests;
};

const conn = (id: number, remoteAddress: string, agoMs: number): Connection =>
    ({id, remoteAddress, remotePort: 50_000 + id, connectedAt: Date.now() - agoMs, rx: 1200, tx: 3400});

const openList = async (page: Page, url: string) => {
    await page.goto(`${url}#/tunnels`);
    await row(page, PORT).locator(".tunnel-meta-row").waitFor({state: "visible", timeout: 10_000});
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
        expect(await clients.locator(".client").allTextContents()).toEqual(["●Office PC", "○Lab"]);
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
        const close = dialog.getByRole("button", {name: "Disconnect 203.0.113.7", exact: true});
        const box = await close.boundingBox();
        expect([Math.round(box!.width), Math.round(box!.height)]).toEqual([32, 32]);
        expect(await close.getAttribute("title")).toBe("Disconnect");
        expect(await dialog.getByRole("button", {name: "Block 203.0.113.7", exact: true}).count()).toBe(1);
        // 2초마다 다시 읽는다. 새 연결은 순서를 흔들지 않고 맨 아래에 "New" 로 붙는다.
        await app.page.waitForFunction(() => document.querySelectorAll("[role=dialog] li.conn").length === 3, undefined, {timeout: 5_000});
        expect(await dialog.locator(".conn-addr").first().textContent()).toBe("203.0.113.7");
        expect(await dialog.locator("li.conn").last().locator(".new-tag").textContent()).toBe("New");
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
        expect(await confirm.getByRole("alert").textContent()).toContain("This is the address you are using for this console.");
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
