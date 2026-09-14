import type {Page, Request, Response} from "playwright";
import {startAdminApp} from "../helpers/adminApp";

const card = (page: Page, port: number) => page.locator(`li[data-port="${port}"]`);

const isPath = (method: string, pathname: string) => (message: Request | Response) => {
    const request = "request" in message ? message.request() : message;
    return request.method() === method && new URL(request.url()).pathname === pathname;
};

const openTunnels = async (page: Page) => {
    await page.evaluate(() => { location.hash = "#/tunnels"; });
    await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Tunnels", undefined, {timeout: 10_000});
};

// 화면이 아니라 스텁 TTTServer 가 들고 있는 상태를 직접 읽는다. 상태 API 는 스텁의 활성 맵으로 응답한다.
// 남은 시간 기대값을 만들려면 서버 시각도 필요하므로 함께 돌려준다.
const statusSnapshot = (page: Page, port: number) => page.evaluate(async (target) => {
    const response = await fetch("/api/externalServerStatuses", {credentials: "same-origin"});
    const json = await response.json();
    return {serverTime: json.serverTime as number,
        status: json.statuses.find((status: {port: number}) => status.port === target)};
}, port);

const stubStatus = async (page: Page, port: number) => (await statusSnapshot(page, port)).status;

const shownSeconds = (text: string | null): number => {
    const parsed = /^(\d+)m (\d+)s$/.exec(text ?? "");
    if(!parsed) throw new Error(`Unexpected timer text: ${text}`);
    return Number(parsed[1]) * 60 + Number(parsed[2]);
};

// 요청 직후 한 번 더 도착한 상태 응답까지 기다린다. 스위치는 클릭 즉시 자기 표시를 바꾸므로,
// 폴링이 서버 값으로 되돌리지 않는지 보려면 그 다음 응답 뒤에 확인해야 한다.
const nextStatusResponse = async (page: Page) => {
    await page.waitForResponse(isPath("GET", "/api/externalServerStatuses"), {timeout: 5_000});
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
};

test("with-tunnels 목록이 터널마다 카드 하나에 포트·목적지·프로토콜·상태를 그린다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openTunnels(app.page);
        await app.page.waitForFunction(() => document.querySelectorAll("li[data-port]").length === 2, undefined, {timeout: 10_000});
        expect(await app.page.locator("li[data-port]").count()).toBe(2);
        expect(await card(app.page, 20001).isVisible()).toBe(true);
        expect(await card(app.page, 20002).isVisible()).toBe(true);

        const head = await card(app.page, 20001).locator(".tunnel-head").textContent();
        expect(head).toContain("20001");
        expect(head).toContain("127.0.0.1:9");
        expect(await card(app.page, 20001).locator(".chip").textContent()).toBe("TCP");
        expect(await card(app.page, 20002).locator(".tunnel-head").textContent()).toContain("127.0.0.1:8080");
        expect(await card(app.page, 20002).locator(".chip").textContent()).toBe("HTTP");

        for(const port of [20001, 20002]) {
            await card(app.page, port).locator(".badge").filter({hasText: "Online"}).waitFor({state: "visible", timeout: 10_000});
            expect(await card(app.page, port).locator(".badge").textContent()).toBe("Online");
            // 스텁의 sessions·rx·tx 는 0 이다. 가동 시간 표기는 startupTime 이 내는 네 형태 중 하나다.
            expect(await card(app.page, port).locator(".tunnel-stats").textContent())
                .toMatch(/^Uptime (\d+s|\d+m|\d+h, \d+m|\d+d, \d+h) · Sessions 0 · RX 0B · TX 0B$/);
        }
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("활성 터널은 켜진 스위치와 남은 시간 타이머를 보여준다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openTunnels(app.page);
        const tunnel = card(app.page, 20001);
        const toggle = app.page.getByRole("switch", {name: "Activation 20001", exact: true});
        await toggle.waitFor({state: "visible", timeout: 10_000});
        expect(await toggle.getAttribute("aria-checked")).toBe("true");
        expect(await tunnel.getByText("Timeout", {exact: true}).isVisible()).toBe(true);
        // 남은 초 = activeStart + activeTimeout·1000 − serverTime 이다. 분 값은 드라이버가 뜬 뒤 흐른 시간에 따라
        // 달라지므로 상수로 두지 않고 서버가 준 값에서 계산해 비교한다. 시가 0 인 동안은 {m}m {s}s 로 찍힌다.
        const text = await tunnel.locator(".timer-text").textContent();
        expect(text).toMatch(/^\d+m \d+s$/);
        const {serverTime, status} = await statusSnapshot(app.page, 20001);
        const remaining = Math.floor((status.activeStart + status.activeTimeout * 1000 - serverTime) / 1000);
        expect(Math.abs(shownSeconds(text) - remaining)).toBeLessThanOrEqual(3);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("스위치를 끄면 불리언 active=false 요청이 나가고 스텁과 화면이 함께 비활성으로 바뀐다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openTunnels(app.page);
        const tunnel = card(app.page, 20001);
        const toggle = app.page.getByRole("switch", {name: "Activation 20001", exact: true});
        await toggle.waitFor({state: "visible", timeout: 10_000});

        const posted = app.page.waitForResponse(isPath("POST", "/api/tunneling/active/20001"), {timeout: 10_000});
        await toggle.click();
        const response = await posted;
        // 본문 전체를 비교한다. active 가 문자열 "false" 이거나 timeout 이 빠지면 여기서 드러난다.
        expect(response.request().postDataJSON()).toEqual({active: false, timeout: 3600});
        expect(response.status()).toBe(200);

        await app.page.waitForFunction(() => document.querySelector('[aria-label="Activation 20001"]')?.getAttribute("aria-checked") === "false",
            undefined, {timeout: 2_000});
        await tunnel.getByText("Timeout", {exact: true}).waitFor({state: "detached", timeout: 2_000});
        await nextStatusResponse(app.page);
        expect(await toggle.getAttribute("aria-checked")).toBe("false");
        expect(await tunnel.getByText("Timeout", {exact: true}).count()).toBe(0);

        const calls = await app.calls();
        expect(calls.filter((call) => call.method === "inactiveExternalPortServer")).toEqual([{method: "inactiveExternalPortServer", args: [20001]}]);
        expect(calls.filter((call) => call.method === "activeExternalPortServer")).toEqual([]);
        expect(await stubStatus(app.page, 20001)).toMatchObject({port: 20001, active: false});
        expect(await stubStatus(app.page, 20002)).toMatchObject({port: 20002, active: true});

        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("타이머에서 10분을 고르면 active=true·timeout=600 요청이 나가고 남은 시간이 그 값에서 다시 센다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        // 시계를 멈춰 폴링 틱을 없앤다. 그러면 아래 표기 갱신은 활성 변경 직후의 상태 재조회에서만 올 수 있다.
        await app.page.clock.install();
        await app.page.clock.pauseAt(Date.now() + 1_000);
        await openTunnels(app.page);
        const tunnel = card(app.page, 20002);
        await tunnel.locator(".timer-text").waitFor({state: "visible", timeout: 10_000});
        await tunnel.locator(".timer-text").click();

        const dialog = app.page.getByRole("dialog", {name: "Tunneling activity restriction time"});
        await dialog.waitFor({state: "visible", timeout: 10_000});
        await dialog.getByLabel("Days", {exact: true}).fill("0");
        await dialog.getByLabel("Hours", {exact: true}).fill("0");
        await dialog.getByLabel("Minutes", {exact: true}).fill("10");

        const posted = app.page.waitForResponse(isPath("POST", "/api/tunneling/active/20002"), {timeout: 10_000});
        await dialog.getByRole("button", {name: "OK", exact: true}).click();
        const response = await posted;
        expect(response.request().postDataJSON()).toEqual({active: true, timeout: 600});
        expect(response.status()).toBe(200);

        await app.page.waitForFunction(() => /^(10m 0s|9m \d+s)$/.test(document.querySelector('li[data-port="20002"] .timer-text')?.textContent ?? ""),
            undefined, {timeout: 2_000});

        const calls = await app.calls();
        expect(calls.filter((call) => call.method === "activeExternalPortServer")).toEqual([{method: "activeExternalPortServer", args: [20002, 600]}]);
        expect(calls.filter((call) => call.method === "inactiveExternalPortServer")).toEqual([]);
        expect(await stubStatus(app.page, 20002)).toMatchObject({port: 20002, active: true, activeTimeout: 600});

        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("카드를 누르면 그 터널의 편집 화면으로, Add tunneling service 는 새 터널 화면으로 이동한다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openTunnels(app.page);
        await card(app.page, 20001).locator("a.tunnel-link").click();
        await app.page.waitForFunction(() => location.hash === "#/tunnels/20001", undefined, {timeout: 10_000});
        await app.page.waitForFunction(() => document.querySelector("h1")?.textContent === "Tunnel 20001", undefined, {timeout: 10_000});

        await openTunnels(app.page);
        await app.page.getByRole("button", {name: "Add tunneling service", exact: true}).click();
        await app.page.waitForFunction(() => location.hash === "#/tunnels/new", undefined, {timeout: 10_000});
        await app.page.waitForFunction(() => document.querySelector("h1")?.textContent === "New tunnel", undefined, {timeout: 10_000});

        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("터널이 없는 fixture 는 목록을 받은 뒤 No tunnels yet. 을 보여준다", async () => {
    const app = await startAdminApp({fixture: "password"});
    try {
        // 빈 목록 문구는 로드 전에도 보이므로, 목록 응답을 받은 뒤에 판정한다.
        const loaded = app.page.waitForResponse(isPath("GET", "/api/tunnelingOption"), {timeout: 10_000});
        await openTunnels(app.page);
        expect((await (await loaded).json()).tunnelingOptions).toEqual([]);
        await app.page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

        expect(await app.page.getByText("No tunnels yet.", {exact: true}).isVisible()).toBe(true);
        expect(await app.page.locator("li[data-port]").count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("목록 로드가 실패하면 Retry 알림을 띄우고 Retry 로 다시 불러온다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await app.page.route("**/api/tunnelingOption", (route) => route.abort());
        await openTunnels(app.page);

        const dialog = app.page.getByRole("dialog", {name: "Tunnels"});
        await dialog.getByText("Unable to connect to the server.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
        expect(await app.page.locator("li[data-port]").count()).toBe(0);

        await app.page.unroute("**/api/tunnelingOption");
        const reloaded = app.page.waitForResponse(isPath("GET", "/api/tunnelingOption"), {timeout: 10_000});
        await dialog.getByRole("button", {name: "Retry", exact: true}).click();
        expect((await reloaded).status()).toBe(200);
        await app.page.waitForFunction(() => document.querySelectorAll("li[data-port]").length === 2, undefined, {timeout: 10_000});

        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("터널 화면은 1초마다 상태를 다시 읽고 화면을 떠나면 폴링을 멈춘다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        // 실제 시계를 기다리면 1초 주기의 두 번째 틱이 2초 창의 경계에 걸려 흔들린다.
        // 터널 화면의 setInterval 이 만들어지기 전에 페이지 시계를 멈춰 두고, 시간을 직접 흘려 틱을 센다.
        await app.page.clock.install();
        await app.page.clock.pauseAt(Date.now() + 1_000);

        let requests = 0;
        app.page.on("request", (request) => {
            if(new URL(request.url()).pathname === "/api/externalServerStatuses") requests++;
        });
        const isStatus = isPath("GET", "/api/externalServerStatuses");

        // 목록 로드 안의 1회와 폴링 시작 직후의 1회가 나간 뒤부터 센다.
        await openTunnels(app.page);
        await card(app.page, 20001).locator(".badge").filter({hasText: "Online"}).waitFor({state: "visible", timeout: 10_000});
        for(let attempt = 0; requests < 2 && attempt < 100; attempt++) await app.page.waitForTimeout(50);
        expect(requests).toBe(2);

        for(let tick = 1; tick <= 2; tick++) {
            const polled = app.page.waitForRequest(isStatus, {timeout: 5_000});
            await app.page.clock.runFor(1_000);
            await polled;
            await app.page.waitForTimeout(200);
            expect([tick, requests]).toEqual([tick, 2 + tick]);
        }

        await app.page.evaluate(() => { location.hash = "#/status"; });
        await app.page.waitForFunction(() => location.hash === "#/status", undefined, {timeout: 10_000});
        const afterLeaving = requests;
        await app.page.clock.runFor(1_500);
        await app.page.waitForTimeout(300);
        expect(requests - afterLeaving).toBe(0);

        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);
