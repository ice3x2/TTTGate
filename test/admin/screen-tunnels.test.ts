import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import type {Page, Request, Response} from "playwright";
import {startAdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";

// 앱 기동 예산보다 짧으면 부하에서 helper 의 진단 대신 jest 시간 초과로 끝난다(#273).
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const card = (page: Page, port: number) => page.locator(`li[data-port="${port}"]`);

const isPath = (method: string, pathname: string) => (message: Request | Response) => {
    const request = "request" in message ? message.request() : message;
    return request.method() === method && new URL(request.url()).pathname === pathname;
};

// #338: 로그인하면 이미 #/tunnels 에 있다. 같은 해시를 다시 넣으면 화면이 다시 그려지지 않으므로 내 계정 화면을 거쳐 다시 연다.
// 새로 고침은 쓰지 않는다. 테스트가 미리 기다리던 응답이 옛 문서의 것이 되어 본문을 읽을 수 없게 된다.
const openTunnels = async (page: Page) => {
    if(await page.evaluate(() => location.hash) === "#/tunnels") {
        await page.evaluate(() => { location.hash = "#/me"; });
        await page.waitForFunction(() => document.querySelector("h1")?.textContent === "My account", undefined, {timeout: 10_000});
    }
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

// ── #338 목록: 한 번 눌러 켜고 끄기 ─────────────────────────────────────────────

const row = card;
const statusText = (page: Page, port: number) => row(page, port).locator(".tunnel-status");
const switchOf = (page: Page, port: number) => row(page, port).getByRole("switch");
const waitStatus = (page: Page, port: number, pattern: RegExp) => page.waitForFunction(([target, source]) =>
    new RegExp(source as string).test(document.querySelector(`li[data-port="${target}"] .tunnel-status`)?.textContent ?? ""),
    [port, pattern.source] as const, {timeout: 10_000});
const waitChecked = (page: Page, port: number, checked: boolean) => page.waitForFunction(([target, value]) =>
    document.querySelector(`li[data-port="${target}"] [role="switch"]`)?.getAttribute("aria-checked") === String(value),
    [port, checked] as const, {timeout: 10_000});
const undoToast = (page: Page, text: string) => page.locator(".toast").filter({hasText: text});

test("목록은 터널마다 제목·상태 한 줄·스위치를 그리고, 켜진 수를 위에 보인다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openTunnels(app.page);
        await waitStatus(app.page, 20001, /^On/);
        expect(await app.page.locator("li[data-port]").count()).toBe(2);
        expect(await row(app.page, 20001).locator(".tunnel-title").textContent()).toBe(":20001 → 127.0.0.1:9");
        expect(await row(app.page, 20002).locator(".tunnel-title").textContent()).toBe(":20002 → 127.0.0.1:8080");
        // 스텁은 시작할 때 3600초로 켠다. 소유자가 없는 설정은 migrated 다.
        expect(await statusText(app.page, 20001).textContent()).toMatch(/^On · migrated$/); // #344: 남은 시간은 시계 줄로 옮겼다.
        expect(await app.page.locator("#tunnel-summary").textContent()).toBe("2 of 2 on");
        expect(await switchOf(app.page, 20001).getAttribute("aria-checked")).toBe("true");
        expect(await switchOf(app.page, 20001).getAttribute("aria-label")).toBe(":20001 → 127.0.0.1:9");
        // 목록에는 프로토콜 칩·RX/TX·타이머가 없다(편집 화면으로 옮겼다).
        expect(await row(app.page, 20001).locator(".chip").count()).toBe(0);
        expect(await row(app.page, 20001).locator(".timer-text").count()).toBe(0);
        // 스위치 터치 영역은 44×44 이상이다.
        const box = await row(app.page, 20001).locator(".tunnel-switch").boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);

        await app.tunnelState(20001, {online: false});
        await waitStatus(app.page, 20001, /^Can't open port 20001/);
        expect(await switchOf(app.page, 20001).isDisabled()).toBe(true);
        await app.tunnelState(20001, {online: true, clientConnected: false, sessions: 2});
        await waitStatus(app.page, 20001, /^On · client offline · 2 connections · migrated$/);
        expect(await statusText(app.page, 20001).locator(".warn").first().textContent()).toBe("client offline");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

// ── #344 켜진 터널의 시계 ─────────────────────────────────────────────────────

test("#344 제한 터널은 줄어드는 시계와 남은 시간·종료 시각을, 무제한은 도는 시계만 보이며 꺼지면 시계가 없다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        const {page} = app;
        await openTunnels(page);
        await waitStatus(page, 20001, /^On/);
        // 스텁은 3600초로 켠다(AC-1 의 화면 확인).
        const clock = row(page, 20001).locator(".tunnel-clock");
        await clock.waitFor({state: "visible", timeout: 10_000});
        expect(await row(page, 20001).locator(".tunnel-time").textContent()).toMatch(/^\d+m \d{2}s left · ends (\d{1,2}\/\d{1,2} )?\d{2}:\d{2}$/);
        expect(await clock.getAttribute("class")).not.toContain("unlimited");
        expect(await clock.getAttribute("aria-label")).toMatch(/^\d+m \d{2}s left, ends (\d{1,2}\/\d{1,2} )?\d{2}:\d{2}$/);
        expect(await clock.getAttribute("role")).toBe("img");
        // 끄면 시계가 사라진다(AC-4).
        await switchOf(page, 20001).click();
        await waitChecked(page, 20001, false);
        await waitStatus(page, 20001, /^Off/);
        expect(await row(page, 20001).locator(".tunnel-clock").count()).toBe(0);
        // 목록에서 켜면 무기한이다. 시계는 돌고 숫자는 없다(AC-2).
        await switchOf(page, 20001).click();
        await waitChecked(page, 20001, true);
        await waitStatus(page, 20001, /^On/);
        await page.locator('li[data-port="20001"] .tunnel-clock.unlimited').waitFor({state: "visible", timeout: 10_000});
        expect(await row(page, 20001).locator(".tunnel-time").count()).toBe(0);
        expect(await clock.getAttribute("aria-label")).toBe("No time limit");
        const spinning = () => page.evaluate(() => getComputedStyle(document.querySelector('li[data-port="20001"] .tunnel-clock .hand')!).animationName);
        expect(await spinning()).not.toBe("none");
        // 움직임 줄이기를 켜면 멈춘다(FR-8).
        await page.emulateMedia({reducedMotion: "reduce"});
        await page.waitForFunction(() => getComputedStyle(document.querySelector('li[data-port="20001"] .tunnel-clock .hand')!).animationName === "none", undefined, {timeout: 5_000});
        // 360px 에서 줄이 넘치지 않는다(FR-10). 목록은 넘침을 잘라 숨기므로 줄과 시계 줄을 직접 본다.
        await page.setViewportSize({width: 360, height: 800});
        await page.waitForFunction(() => {
            const fits = (selector: string) => { const element = document.querySelector(selector)!; return element.scrollWidth <= element.clientWidth; };
            return document.documentElement.scrollWidth <= window.innerWidth && fits('li[data-port="20001"]') && fits('li[data-port="20001"] .tunnel-time-row');
        }, undefined, {timeout: 5_000});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

test("연결이 없으면 한 번에 끄고, Undo 는 남은 시간으로 다시 켜며, 꺼진 터널은 한 번에 무기한으로 켠다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openTunnels(app.page);
        await waitStatus(app.page, 20001, /^On/);
        const off = app.page.waitForResponse(isPath("POST", "/api/tunneling/active/20001"), {timeout: 10_000});
        await switchOf(app.page, 20001).click();
        expect((await off).request().postDataJSON()).toEqual({active: false, timeout: 0});
        await waitChecked(app.page, 20001, false);
        await waitStatus(app.page, 20001, /^Off/);
        expect(await app.page.locator("#tunnel-summary").textContent()).toBe("1 of 2 on");

        // 끄기를 되돌리면 끈 순간에 남아 있던 시간으로 켠다(사용 시간이 늘지 않는다).
        const undo = app.page.waitForResponse(isPath("POST", "/api/tunneling/active/20001"), {timeout: 10_000});
        await undoToast(app.page, ":20001 → 127.0.0.1:9 is off").getByRole("button", {name: "Undo", exact: true}).click();
        const undoBody = (await undo).request().postDataJSON();
        expect(undoBody.active).toBe(true);
        expect(undoBody.timeout).toBeGreaterThan(3000);
        expect(undoBody.timeout).toBeLessThanOrEqual(3600);
        await waitChecked(app.page, 20001, true);
        // 되돌리기는 알림을 다시 띄우지 않는다.
        expect(await app.page.locator(".toast").count()).toBe(0);

        // 꺼진 터널을 켜면 확인 없이 timeout 0(무기한, 그룹 상한은 서버가 적용)으로 요청한다.
        await switchOf(app.page, 20002).click();
        await waitChecked(app.page, 20002, false);
        await undoToast(app.page, "is off").waitFor({state: "visible", timeout: 10_000});
        const on = app.page.waitForResponse(isPath("POST", "/api/tunneling/active/20002"), {timeout: 10_000});
        await switchOf(app.page, 20002).click();
        expect((await on).request().postDataJSON()).toEqual({active: true, timeout: 0});
        await waitChecked(app.page, 20002, true);
        // 되돌리기 알림은 하나만 남는다.
        await undoToast(app.page, ":20002 → 127.0.0.1:8080 is on").waitFor({state: "visible", timeout: 10_000});
        expect(await app.page.locator(".toast").count()).toBe(1);
        const undoOn = app.page.waitForResponse(isPath("POST", "/api/tunneling/active/20002"), {timeout: 10_000});
        await undoToast(app.page, "is on").getByRole("button", {name: "Undo", exact: true}).click();
        expect((await undoOn).request().postDataJSON()).toMatchObject({active: false});
        await waitChecked(app.page, 20002, false);

        const calls = (await app.calls()).filter((call) => call.method === "activeExternalPortServer" || call.method === "inactiveExternalPortServer");
        expect(calls.map((call) => call.method)).toEqual(["inactiveExternalPortServer", "activeExternalPortServer", "inactiveExternalPortServer",
            "activeExternalPortServer", "inactiveExternalPortServer"]);
        expect(calls[3].args).toEqual([20002, 0]);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

test("연결이 있으면 끄기 전에 묻고, 실패하면 되돌리며, 처리 중에는 그 행만 잠근다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openTunnels(app.page);
        await app.tunnelState(20001, {sessions: 2});
        await waitStatus(app.page, 20001, /2 connections/);

        await switchOf(app.page, 20001).click();
        const dialog = app.page.getByRole("dialog", {name: "Turn off :20001 → 127.0.0.1:9?"});
        await dialog.waitFor({state: "visible", timeout: 10_000});
        expect(await dialog.getByText("2 connections will be cut.", {exact: true}).isVisible()).toBe(true);
        // 확인 창이 열린 동안과 취소 뒤에는 원래 상태(켜짐)다.
        expect(await switchOf(app.page, 20001).getAttribute("aria-checked")).toBe("true");
        await dialog.getByRole("button", {name: "Cancel", exact: true}).click();
        await dialog.waitFor({state: "hidden", timeout: 10_000});
        expect(await switchOf(app.page, 20001).getAttribute("aria-checked")).toBe("true");
        expect((await app.calls()).filter((call) => call.method === "inactiveExternalPortServer")).toEqual([]);

        await switchOf(app.page, 20001).click();
        await dialog.getByRole("button", {name: "Turn Off", exact: true}).click();
        await waitChecked(app.page, 20001, false);
        expect((await app.calls()).filter((call) => call.method === "inactiveExternalPortServer")).toEqual([{method: "inactiveExternalPortServer", args: [20001]}]);

        // 실패하면 스위치를 원래대로 돌리고 서버 문구를 알린다.
        await app.page.route("**/api/tunneling/active/20002", (route) => route.fulfill({status: 400, contentType: "application/json",
            body: JSON.stringify({success: false, message: "Unable to change listener active state"})}));
        await switchOf(app.page, 20002).click();
        await app.page.locator(".toast.alarm").filter({hasText: "Unable to change listener active state"}).waitFor({state: "visible", timeout: 10_000});
        await waitChecked(app.page, 20002, true);
        await app.page.unroute("**/api/tunneling/active/20002");

        // 처리 중에는 그 행의 스위치만 잠기고 화면 전체를 덮지 않는다.
        let release: () => void = () => {};
        await app.page.route("**/api/tunneling/active/20002", async (route) => {
            await new Promise<void>((resolve) => { release = resolve; });
            await route.continue();
        });
        await switchOf(app.page, 20002).click();
        await app.page.waitForFunction(() => document.querySelector('li[data-port="20002"] [role="switch"]')?.getAttribute("aria-busy") === "true",
            undefined, {timeout: 10_000});
        expect(await switchOf(app.page, 20002).getAttribute("aria-checked")).toBe("false");
        // 처리 중에는 상태 줄도 요청한 쪽을 보인다(폴링 결과가 덮지 않는다).
        expect(await statusText(app.page, 20002).textContent()).toBe("Turning off…");
        expect(await switchOf(app.page, 20002).isDisabled()).toBe(true);
        expect(await switchOf(app.page, 20001).isDisabled()).toBe(false);
        expect(await app.page.locator(".loading").count()).toBe(0);
        release();
        await waitChecked(app.page, 20002, false);
        await app.page.waitForFunction(() => document.querySelector('li[data-port="20002"] [role="switch"]')?.getAttribute("aria-busy") !== "true",
            undefined, {timeout: 10_000});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

test("상태를 읽지 못해도 폴링을 이어 가며, 5초가 넘으면 retrying 을 보이고 다시 읽으면 지운다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openTunnels(app.page);
        await waitStatus(app.page, 20001, /^On/);
        await app.page.route("**/api/externalServerStatuses", (route) => route.abort());
        await app.page.locator("#tunnel-stale").filter({hasText: "Couldn't update · retrying"}).waitFor({state: "visible", timeout: 15_000});
        // 마지막으로 읽은 상태는 그대로 보인다.
        expect(await statusText(app.page, 20001).textContent()).toMatch(/^On/);
        await app.page.unroute("**/api/externalServerStatuses");
        await app.page.locator("#tunnel-stale").waitFor({state: "detached", timeout: 10_000});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

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
}, ADMIN_APP_TEST_TIMEOUT_MS);

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
}, ADMIN_APP_TEST_TIMEOUT_MS);

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
}, ADMIN_APP_TEST_TIMEOUT_MS);

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

        // #338: 상태 폴링은 화면이 열리면 바로 한 번 읽는다(목록 로드와 따로). 그 1회가 나간 뒤부터 센다.
        await openTunnels(app.page);
        await card(app.page, 20001).locator(".tunnel-status").filter({hasText: "On"}).waitFor({state: "visible", timeout: 10_000});
        for(let attempt = 0; requests < 1 && attempt < 100; attempt++) await app.page.waitForTimeout(50);
        await app.page.waitForTimeout(200);
        expect(requests).toBe(1);

        for(let tick = 1; tick <= 2; tick++) {
            const polled = app.page.waitForRequest(isStatus, {timeout: 5_000});
            await app.page.clock.runFor(1_000);
            await polled;
            await app.page.waitForTimeout(200);
            expect([tick, requests]).toEqual([tick, 1 + tick]);
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
}, ADMIN_APP_TEST_TIMEOUT_MS);

// ── #91 (U1-09) TunnelEditScreen ──────────────────────────────────────────────

const EMPTY_HTTP_OPTION = {
    rewriteHostInTextBody: true, replaceAccessControlAllowOrigin: false,
    customRequestHeaders: [], customResponseHeaders: [], bodyRewriteRules: [],
};

const apiGet = (page: Page, path: string) => page.evaluate(async (target) =>
    await (await fetch(target, {credentials: "same-origin"})).json(), path);

// 편집 화면으로 간 뒤 그 포트의 값이 실제로 채워질 때까지 기다린다. 제목만 보면 로드 전에도 참이 된다.
const openEdit = async (page: Page, port: number) => {
    await page.evaluate((target) => { location.hash = `#/tunnels/${target}`; }, port);
    await page.waitForFunction(() => document.querySelector("h1")?.textContent?.startsWith("Tunnel "), undefined, {timeout: 10_000});
    await page.waitForFunction((target) => (document.querySelector("#input-external-port") as HTMLInputElement)?.value === String(target),
        port, {timeout: 10_000});
};

const openNew = async (page: Page) => {
    await page.evaluate(() => { location.hash = "#/tunnels/new"; });
    await page.waitForFunction(() => document.querySelector("h1")?.textContent === "New tunnel", undefined, {timeout: 10_000});
    await page.waitForFunction(() => (document.querySelector("#input-destination-port") as HTMLInputElement)?.value === "8080",
        undefined, {timeout: 10_000});
};

// 새 터널 저장은 AdminServer 의 UsablePortChecker 가 실제로 바인딩을 시도한다. 비어 있지 않으면 건너뛰지 않고 실패시킨다.
const requireFreePort = (port: number) => new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => reject(new Error(`Port ${port} is busy: ${error.message}`)));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
});

const bodiesOf = (page: Page, method: string, pathname: string): Array<any> => {
    const bodies: Array<any> = [];
    page.on("request", (request) => {
        if(request.method() === method && new URL(request.url()).pathname === pathname) bodies.push(request.postDataJSON());
    });
    return bodies;
};

test("편집 화면은 그 포트의 저장된 값을 채우고 옛 터널 레이아웃은 남아 있지 않다", async () => {
    // 옛 화면을 지운 것이 이 이슈의 범위다. 디렉터리가 남아 있으면 이식이 끝나지 않은 것이다.
    expect(fs.existsSync(path.resolve(__dirname, "../../admin/src/layout"))).toBe(false);

    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openEdit(app.page, 20001);
        expect(await app.page.locator("h1").textContent()).toBe("Tunnel 20001");
        expect(await app.page.locator("#input-external-port").inputValue()).toBe("20001");
        expect(await app.page.locator("#select-protocol").inputValue()).toBe("tcp");
        expect(await app.page.locator("#input-tls").isChecked()).toBe(false);
        expect(await app.page.locator("#input-tls").isDisabled()).toBe(false);
        expect(await app.page.locator("#input-destination-host").inputValue()).toBe("127.0.0.1");
        expect(await app.page.locator("#input-buffer-limit-client").inputValue()).toBe("8");
        expect(await app.page.getByRole("button", {name: "Stop and Remove", exact: true}).isVisible()).toBe(true);
        expect(await app.page.getByRole("button", {name: "Apply and Restart", exact: true}).isEnabled()).toBe(true);
        expect(await app.page.getByRole("heading", {name: "HTTP options", exact: true}).count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

test("목적지 호스트를 바꿔 저장하면 본문 전체가 그대로 나가고 토스트 뒤 목록으로 돌아간다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openEdit(app.page, 20001);
        // 기대 본문은 저장 직전의 서버 상태에서 만든다. 구현을 보고 역산하지 않는다.
        const list = await apiGet(app.page, "/api/tunnelingOption");
        const stored = list.tunnelingOptions.find((option: any) => option.forwardPort === 20001);
        expect(stored).toBeDefined();
        const cert = await apiGet(app.page, "/api/externalCert/20001");
        const sent = bodiesOf(app.page, "POST", "/api/tunnelingOption");

        await app.page.locator("#input-destination-host").fill("10.0.0.9");
        await app.page.getByRole("button", {name: "Apply and Restart", exact: true}).click();

        await app.page.waitForFunction(() => document.querySelector(".toast.pulse .msg")?.textContent === "Success to apply tunneling option",
            undefined, {timeout: 10_000});
        await app.page.waitForFunction(() => location.hash === "#/tunnels", undefined, {timeout: 10_000});
        await app.page.waitForFunction(() => document.querySelectorAll("li[data-port]").length === 2, undefined, {timeout: 10_000});
        expect(await app.page.locator("li[data-port]").count()).toBe(2);

        // 목록 응답의 소유 정보(ownerId·owner·editable)는 저장 본문에 싣지 않는다. 소유자 변경은 전용 API 만 한다.
        // #347: 화면용 toggleable·sharedUsers 도 싣지 않는다. 공유 목록은 sharedUserIds 로만 보낸다.
        const {ownerId: _ownerId, owner: _owner, editable: _editable, toggleable: _toggleable, sharedUsers: _sharedUsers, ...storedBody} = stored;
        expect(sent).toEqual([{
            ...storedBody,
            httpOption: stored.httpOption ?? EMPTY_HTTP_OPTION,
            destinationAddress: "10.0.0.9",
            allowedClientNames: [],
            expectedCertificateRevision: cert.revisionState.currentRevision,
            previousForwardPort: 20001,
            expectedRevision: list.revisionState.currentRevision,
        }]);

        const calls = await app.calls();
        const applied = calls.filter((call) => call.method === "applyTunnelingOption");
        expect(applied).toHaveLength(1);
        expect(applied[0].args[0]).toMatchObject({forwardPort: 20001, destinationAddress: "10.0.0.9"});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

// #280: TLS 를 켜면 대상 서버의 자체 서명 인증서 허용 체크 상자가 나오고, 체크하면 저장 본문에 실린다.
test("TLS 를 켜면 자체 서명 인증서 허용 체크 상자가 보이고 체크한 값이 저장 본문에 실린다 (AC-3)", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openEdit(app.page, 20001);
        const allow = app.page.locator("#input-allow-self-signed");
        expect(await allow.count()).toBe(0);
        await app.page.locator("#input-tls").check();
        await allow.waitFor({state: "visible", timeout: 10_000});
        expect(await allow.isChecked()).toBe(false);
        // 체크 상자 옆에 인증서 검증을 건너뛴다는 설명이 있다(REQ-4).
        expect(await app.page.locator(".field").filter({has: allow}).locator(".hint").textContent()).toContain("accepts any certificate");
        await allow.check();

        const sent = bodiesOf(app.page, "POST", "/api/tunnelingOption");
        await app.page.getByRole("button", {name: "Apply and Restart", exact: true}).click();
        await app.page.waitForFunction(() => location.hash === "#/tunnels", undefined, {timeout: 10_000});
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({forwardPort: 20001, tls: true, allowSelfSignedDestinationCert: true});

        // TLS 를 끄면 체크 상자도 사라진다.
        await openEdit(app.page, 20001);
        await app.page.locator("#input-tls").uncheck();
        await allow.waitFor({state: "detached", timeout: 10_000});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

// #282: 인증서 검증을 끈 터널은 목록 카드에 표시가 붙고, 다른 터널에는 없다.
test("인증서 검증을 끈 터널은 목록의 상태 줄에 경고가 붙는다 (AC-1, AC-2)", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openEdit(app.page, 20001);
        await app.page.locator("#input-tls").check();
        await app.page.locator("#input-allow-self-signed").check();
        await app.page.getByRole("button", {name: "Apply and Restart", exact: true}).click();
        await app.page.waitForFunction(() => location.hash === "#/tunnels", undefined, {timeout: 10_000});

        // #338: 상태 줄 끝에 경고색으로 붙는다.
        const cert = card(app.page, 20001).locator(".tunnel-status .warn").filter({hasText: "cert not verified"});
        await cert.waitFor({state: "visible", timeout: 10_000});
        expect(await cert.getAttribute("title")).toBe("The client does not verify the destination server certificate.");
        expect(await card(app.page, 20002).locator(".tunnel-status").filter({hasText: "cert not verified"}).count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

// #338 REQ-18: 사용 시간 Timer 는 편집 화면의 Status 영역에 있다. 시간을 바꾸면 폼 저장과 관계없이 바로 요청한다.
test("편집 화면의 Timer 에서 10분을 고르면 active=true·timeout=600 요청이 나가고 남은 시간이 그 값에서 다시 센다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await app.page.goto(`${app.url}#/tunnels/20002`);
        const timer = app.page.locator("#tunnel-status-area .timer-text");
        await timer.waitFor({state: "visible", timeout: 10_000});
        await timer.click();
        const dialog = app.page.getByRole("dialog", {name: "Tunneling activity restriction time"});
        await dialog.waitFor({state: "visible", timeout: 10_000});
        await dialog.getByLabel("Days", {exact: true}).fill("0");
        await dialog.getByLabel("Hours", {exact: true}).fill("0");
        await dialog.getByLabel("Minutes", {exact: true}).fill("10");
        const posted = app.page.waitForResponse(isPath("POST", "/api/tunneling/active/20002"), {timeout: 10_000});
        await dialog.getByRole("button", {name: "OK", exact: true}).click();
        expect((await posted).request().postDataJSON()).toEqual({active: true, timeout: 600});
        await app.page.waitForFunction(() => /^(10m 0s|9m \d+s)$/.test(document.querySelector("#tunnel-status-area .timer-text")?.textContent ?? ""),
            undefined, {timeout: 5_000});
        expect(await app.page.evaluate(() => location.hash)).toBe("#/tunnels/20002");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

// #338 REQ-4·REQ-5: 이름(선택)을 저장하면 목록 제목이 이름이 된다. 41자 이상은 요청 없이 칸 아래 오류다.
test("이름을 넣어 저장하면 본문에 실리고 목록 제목이 이름이 되며, 41자면 저장하지 않는다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openEdit(app.page, 20001);
        const bodies = bodiesOf(app.page, "POST", "/api/tunnelingOption");
        await app.page.locator("#input-name").fill("x".repeat(41));
        await app.page.getByRole("button", {name: "Apply and Restart", exact: true}).click();
        await app.page.getByText("Use up to 40 characters.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
        expect(bodies).toEqual([]);

        await app.page.locator("#input-name").fill("  office ssh ");
        await app.page.getByRole("button", {name: "Apply and Restart", exact: true}).click();
        await app.page.waitForFunction(() => location.hash === "#/tunnels", undefined, {timeout: 10_000});
        expect(bodies.at(-1).name).toBe("office ssh");
        await card(app.page, 20001).locator(".tunnel-title").filter({hasText: "office ssh"}).waitFor({state: "visible", timeout: 10_000});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

test("http 터널은 HTTP 옵션 절을 펼쳐 보이고 tcp 로 바꾸면 그 절이 사라지고 TLS 가 풀린다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openEdit(app.page, 20002);
        await app.page.getByRole("heading", {name: "HTTP options", exact: true}).waitFor({state: "visible", timeout: 10_000});
        expect(await app.page.locator("#select-change-host-in-body").inputValue()).toBe("true");
        expect(await app.page.locator("#select-change-acao").inputValue()).toBe("false");

        const requestHeaders = app.page.locator(".field").filter({hasText: "Inject request header"});
        expect(await requestHeaders.locator(".rule").count()).toBe(1);
        // 이슈 365 FR-5: 헤더 추가·삭제는 글자 "+"·"-" 대신 이름이 있는 44px 버튼이다.
        const addHeader = requestHeaders.getByRole("button", {name: "Add header", exact: true});
        expect(await addHeader.count()).toBe(1);
        const box = await addHeader.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
        // 이슈 365 AC-2: 헤더 줄의 입력 칸은 44px 버튼과 높이가 같다.
        const nameInput = requestHeaders.locator(".rule input").first();
        expect(Math.round((await nameInput.boundingBox())!.height)).toBe(Math.round(box!.height));
        // 줄이 둘이면 앞 줄 버튼은 이름이 "Remove header" 인 삭제 버튼이다(title 은 이름과 겹치지 않게 두지 않는다).
        await addHeader.click();
        expect(await requestHeaders.locator(".rule").count()).toBe(2);
        const removeHeader = requestHeaders.getByRole("button", {name: "Remove header", exact: true});
        expect(await removeHeader.count()).toBe(1);
        expect(await removeHeader.getAttribute("title")).toBeNull();
        await removeHeader.click();
        expect(await requestHeaders.locator(".rule").count()).toBe(1);

        // 이슈 365 FR-5: 본문 바꾸기 규칙의 추가·삭제도 테두리가 보이는 44px secondary 버튼이다.
        const bodyRules = app.page.locator(".field").filter({hasText: "Replace text in body"});
        const addRule = bodyRules.getByRole("button", {name: "Add", exact: true});
        expect(await addRule.count()).toBe(1);
        const secondaryOf = (locator: typeof addRule) => locator.evaluate((element) => ({
            secondary: element.classList.contains("secondary"),
            border: parseFloat(getComputedStyle(element).borderTopWidth),
            height: element.getBoundingClientRect().height,
        }));
        expect(await secondaryOf(addRule)).toEqual(expect.objectContaining({secondary: true}));
        expect((await secondaryOf(addRule)).border).toBeGreaterThanOrEqual(1);
        expect((await secondaryOf(addRule)).height).toBeGreaterThanOrEqual(44);
        await addRule.click();
        const removeRule = bodyRules.getByRole("button", {name: "Remove", exact: true});
        expect(await removeRule.count()).toBe(1);
        expect((await secondaryOf(removeRule)).secondary).toBe(true);
        expect((await secondaryOf(removeRule)).height).toBeGreaterThanOrEqual(44);
        await removeRule.click();
        expect(await bodyRules.getByRole("button", {name: "Remove", exact: true}).count()).toBe(0);

        expect(await app.page.locator("#input-tls").isDisabled()).toBe(true);
        await app.page.locator("#select-protocol").selectOption("tcp");
        await app.page.getByRole("heading", {name: "HTTP options", exact: true}).waitFor({state: "detached", timeout: 10_000});
        expect(await app.page.getByRole("heading", {name: "HTTP options", exact: true}).count()).toBe(0);
        expect(await app.page.locator("#input-tls").isDisabled()).toBe(false);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

test("Stop and Remove 는 확인 대화상자를 거쳐 터널을 지우고 목록에서 사라진다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openEdit(app.page, 20002);
        const list = await apiGet(app.page, "/api/tunnelingOption");
        const stored = list.tunnelingOptions.find((option: any) => option.forwardPort === 20002);
        expect(stored).toBeDefined();
        const cert = await apiGet(app.page, "/api/externalCert/20002");
        const sent = bodiesOf(app.page, "DELETE", "/api/tunnelingOption");

        await app.page.getByRole("button", {name: "Stop and Remove", exact: true}).click();
        const dialog = app.page.getByRole("dialog", {name: "Remove tunnel"});
        await dialog.waitFor({state: "visible", timeout: 10_000});
        expect(await dialog.textContent()).toContain("Remove tunnel 20002?");
        await dialog.getByRole("button", {name: "Remove", exact: true}).click();

        await app.page.waitForFunction(() => document.querySelector(".toast.pulse .msg")?.textContent
            === "Tunneling option has been removed. The external server has been shut down.", undefined, {timeout: 10_000});
        await app.page.waitForFunction(() => location.hash === "#/tunnels", undefined, {timeout: 10_000});
        await app.page.waitForFunction(() => document.querySelectorAll("li[data-port]").length === 1, undefined, {timeout: 10_000});
        expect(await app.page.locator("li[data-port]").count()).toBe(1);
        expect(await card(app.page, 20001).isVisible()).toBe(true);

        // 빈 행 하나는 HeaderAppender·BodyReplaceAppender 가 편집용으로 넣은 것이며 옛 화면과 같이 본문에 그대로 실린다(D14).
        expect(sent).toEqual([{
            ...stored,
            httpOption: {
                ...stored.httpOption,
                customRequestHeaders: [{name: "", value: "", replace: false}],
                customResponseHeaders: [{name: "", value: "", replace: false}],
                bodyRewriteRules: [{from: "", to: ""}],
            },
            isSync: true,
            originalForwardPort: 20002,
            allowedClientNamesQuery: "",
            certInfo: cert.certInfo,
            certificateRevision: cert.revisionState.currentRevision,
            originalCertificateRevision: cert.revisionState.currentRevision,
            expectedRevision: list.revisionState.currentRevision,
        }]);

        // AdminServer.onRemoveTunnelingOption 은 설정을 먼저 commit(905행)한 뒤 externalServerStatus(917행)로 가동 여부를 본다.
        // 스텁의 externalServerStatus 는 설정에 남은 포트만 online 으로 돌려주므로, 삭제 경로에서는 늘 offline 으로 읽혀
        // stopExternalPortServer(919행)에 닿지 않는다. 그래서 이슈 본문이 적은 stopExternalPortServer 호출은 성립하지 않는다.
        const calls = await app.calls();
        expect(calls.filter((call) => call.method === "externalServerStatus"))
            .toEqual([{method: "externalServerStatus", args: [20002]}]);
        expect(calls.filter((call) => call.method === "stopExternalPortServer")).toEqual([]);
        // 화면만 보면 요청이 안 나가도 통과하므로 서버가 들고 있는 설정에서도 사라졌는지 본다.
        const after = await apiGet(app.page, "/api/tunnelingOption");
        expect(after.tunnelingOptions.map((option: any) => option.forwardPort)).toEqual([20001]);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

test("새 터널 화면은 삭제 버튼 없이 기본값을 채우고 Start 로 터널을 추가한다", async () => {
    await requireFreePort(20003);
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openNew(app.page);
        expect(await app.page.locator("h1").textContent()).toBe("New tunnel");
        expect(await app.page.getByRole("button", {name: "Stop and Remove", exact: true}).count()).toBe(0);
        expect(await app.page.getByRole("button", {name: "Start", exact: true}).count()).toBe(1);
        expect(await app.page.locator("#input-destination-host").inputValue()).toBe("127.0.0.1");
        expect(await app.page.locator("#input-destination-port").inputValue()).toBe("8080");

        const list = await apiGet(app.page, "/api/tunnelingOption");
        const sent = bodiesOf(app.page, "POST", "/api/tunnelingOption");
        await app.page.locator("#input-external-port").fill("20003");
        await app.page.getByRole("button", {name: "Start", exact: true}).click();

        await app.page.waitForFunction(() => document.querySelector(".toast.pulse .msg")?.textContent === "Success to apply tunneling option",
            undefined, {timeout: 10_000});
        await app.page.waitForFunction(() => location.hash === "#/tunnels", undefined, {timeout: 10_000});
        await app.page.waitForFunction(() => document.querySelectorAll("li[data-port]").length === 3, undefined, {timeout: 10_000});
        expect(await app.page.locator("li[data-port]").count()).toBe(3);
        expect(await card(app.page, 20003).isVisible()).toBe(true);

        expect(sent).toEqual([{
            forwardPort: 20003,
            tls: false,
            protocol: "tcp",
            httpOption: EMPTY_HTTP_OPTION,
            destinationAddress: "127.0.0.1",
            destinationPort: 8080,
            inactiveOnStartup: false,
            bufferLimitOnClient: 10,
            bufferLimitOnServer: 10,
            allowedClientNames: [],
            // U5-06: 새 터널은 TCP 기본 레이트 리밋으로 시작한다.
            rateLimit: {enabled: true, windowMs: 60000, maxConnections: 30, banMs: 600000, customized: false},
            // #347: 새 터널은 공유 사용자 없이 만든다.
            sharedUserIds: [],
            // 이슈 348: 새 터널은 켠 사람의 IP 만 받는 설정이 켜진 채 만든다.
            activatorIpOnly: true,
            expectedRevision: list.revisionState.currentRevision,
        }]);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

test("포트와 클라이언트 버퍼는 범위 안으로 잘리고, 서버 버퍼가 범위 밖이면 저장이 막히며 없는 포트는 목록으로 돌아간다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openEdit(app.page, 20001);
        await app.page.locator("#input-external-port").fill("70000");
        await app.page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        expect(await app.page.locator("#input-external-port").inputValue()).toBe("65535");
        await app.page.locator("#input-buffer-limit-client").fill("-5");
        await app.page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        expect(await app.page.locator("#input-buffer-limit-client").inputValue()).toBe("-1");

        await openNew(app.page);
        const start = app.page.getByRole("button", {name: "Start", exact: true});
        expect(await start.isEnabled()).toBe(true);
        await app.page.locator("#input-buffer-limit-server").fill("0");
        await app.page.locator(".err-msg").waitFor({state: "visible", timeout: 10_000});
        expect(await app.page.locator(".err-msg").textContent()).toBe("Server buffer must be a finite number of at least 1 MiB.");
        expect(await start.isDisabled()).toBe(true);

        await app.page.evaluate(() => { location.hash = "#/tunnels/65534"; });
        await app.page.waitForFunction(() => location.hash === "#/tunnels", undefined, {timeout: 10_000});
        expect(await app.page.evaluate(() => location.hash)).toBe("#/tunnels");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

describe("U5-06 레이트 리밋 카드와 Rejected 표시", () => {
    const openEdit = async (app: Awaited<ReturnType<typeof startAdminApp>>, port: number | "new") => {
        await app.page.goto(`${app.url}#/tunnels/${port}`);
        await app.page.locator("#input-rate-window").waitFor({state: "visible", timeout: 10_000});
    };
    const values = (page: Page) => Promise.all(["#input-rate-window", "#input-rate-max", "#input-rate-ban"].map((id) => page.locator(id).inputValue()));

    test("편집 화면의 Status 영역은 가동 정보와, 거절이 있을 때만 Rejected 합계를 보인다(#338 REQ-18, 이슈 370 tunnelStatus.blocked)", async () => {
        const app = await startAdminApp({fixture: "with-tunnels"});
        try {
            await app.page.goto(`${app.url}#/tunnels/20002`);
            await app.page.locator("#tunnel-status-area [data-blocked]").waitFor({state: "visible", timeout: 10_000});
            expect(await app.page.locator("#tunnel-status-area [data-blocked]").textContent()).toBe("Rejected 7");
            expect(await app.page.locator("#tunnel-status-area .tunnel-stats").textContent())
                .toMatch(/^Uptime (\d+s|\d+m|\d+h, \d+m|\d+d, \d+h) · Sessions 0 · RX 0B · TX 0B$/);
            await app.page.goto(`${app.url}#/tunnels/20001`);
            await app.page.locator("#tunnel-status-area .tunnel-stats").waitFor({state: "visible", timeout: 10_000});
            expect(await app.page.locator("#tunnel-status-area [data-blocked]").count()).toBe(0);
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    }, ADMIN_APP_TEST_TIMEOUT_MS);

    test("TCP 터널은 30/60초/10분이고, 고치지 않았으면 HTTP 로 바꿀 때 300 이 되며 고친 값은 유지되어 저장된다", async () => {
        const app = await startAdminApp({fixture: "with-tunnels"});
        try {
            await openEdit(app, 20001);
            expect(await values(app.page)).toEqual(["60", "30", "10"]);
            expect(await app.page.locator('[aria-label="Rate limit enabled"]').getAttribute("aria-checked")).toBe("true");
            await app.page.locator("#select-protocol").selectOption("http");
            await app.page.waitForFunction(() => (document.querySelector("#input-rate-max") as HTMLInputElement).value === "300");
            await app.page.locator("#input-rate-max").fill("50");
            await app.page.locator("#select-protocol").selectOption("tcp");
            expect(await app.page.locator("#input-rate-max").inputValue()).toBe("50");
            await app.page.getByRole("button", {name: "Apply and Restart", exact: true}).click();
            await app.page.waitForFunction(() => location.hash === "#/tunnels", undefined, {timeout: 10_000});
            const applied = (await app.calls()).filter((call) => call.method === "applyTunnelingOption");
            // 첫 인자가 저장된 터널 옵션이다.
            expect(applied[applied.length - 1].args[0].rateLimit).toEqual({enabled: true, windowMs: 60000, maxConnections: 50, banMs: 600000, customized: true});
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    }, ADMIN_APP_TEST_TIMEOUT_MS);

    test("새 터널은 TCP 기본값이고 범위 밖 값이면 오류를 보이고 저장을 막는다", async () => {
        const app = await startAdminApp({fixture: "with-tunnels"});
        try {
            await openEdit(app, "new");
            expect(await values(app.page)).toEqual(["60", "30", "10"]);
            await app.page.locator("#input-rate-window").fill("0");
            await app.page.getByText("1..3600", {exact: true}).waitFor({state: "visible"});
            expect(await app.page.getByRole("button", {name: "Start", exact: true}).isDisabled()).toBe(true);
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    }, ADMIN_APP_TEST_TIMEOUT_MS);
});

test("U5-06 레이트 리밋 스위치를 끈 뒤 프로토콜을 바꿔도 꺼진 채로 남는다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await app.page.goto(`${app.url}#/tunnels/20001`);
        const toggle = app.page.locator('[aria-label="Rate limit enabled"]');
        await toggle.waitFor({state: "visible", timeout: 10_000});
        await toggle.click();
        expect(await toggle.getAttribute("aria-checked")).toBe("false");
        await app.page.locator("#select-protocol").selectOption("http");
        expect(await toggle.getAttribute("aria-checked")).toBe("false");
        // 스위치만 고쳤어도 사용자가 고친 것이므로 다른 값도 기본값으로 갈아끼우지 않는다.
        expect(await app.page.locator("#input-rate-max").inputValue()).toBe("30");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);

// #182 — 이전 버전에서 넘어와 꺼진 채 보존된 레이트 리밋(customized:false)은 프로토콜만 바꿔도 켜지면 안 된다.
test("#182 이전 버전에서 넘어와 꺼져 있던 레이트 리밋은 프로토콜을 바꿔도 꺼진 채로 남고 값만 새 기본값이 된다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await app.serverOption({tunnelingOptions: [{
            forwardPort: 20001, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9,
            tls: false, keepAlive: 0, inactiveOnStartup: false, bufferLimitOnServer: 8, bufferLimitOnClient: 8, allowedClientNames: [],
            rateLimit: {enabled: false, windowMs: 60000, maxConnections: 30, banMs: 600000, customized: false},
        }]});
        await app.page.goto(`${app.url}#/tunnels/20001`);
        const toggle = app.page.locator('[aria-label="Rate limit enabled"]');
        await toggle.waitFor({state: "visible", timeout: 10_000});
        expect(await toggle.getAttribute("aria-checked")).toBe("false");
        await app.page.locator("#select-protocol").selectOption("http");
        expect(await toggle.getAttribute("aria-checked")).toBe("false");
        expect(await app.page.locator("#input-rate-max").inputValue()).toBe("300");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, ADMIN_APP_TEST_TIMEOUT_MS);
