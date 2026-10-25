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
}, ADMIN_APP_TEST_TIMEOUT_MS);

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
}, ADMIN_APP_TEST_TIMEOUT_MS);

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
}, ADMIN_APP_TEST_TIMEOUT_MS);

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
        const {ownerId: _ownerId, owner: _owner, editable: _editable, ...storedBody} = stored;
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

test("http 터널은 HTTP 옵션 절을 펼쳐 보이고 tcp 로 바꾸면 그 절이 사라지고 TLS 가 풀린다", async () => {
    const app = await startAdminApp({fixture: "with-tunnels"});
    try {
        await openEdit(app.page, 20002);
        await app.page.getByRole("heading", {name: "HTTP options", exact: true}).waitFor({state: "visible", timeout: 10_000});
        expect(await app.page.locator("#select-change-host-in-body").inputValue()).toBe("true");
        expect(await app.page.locator("#select-change-acao").inputValue()).toBe("false");

        const requestHeaders = app.page.locator(".field").filter({hasText: "Inject request header"});
        expect(await requestHeaders.locator(".rule").count()).toBe(1);
        const bodyRules = app.page.locator(".field").filter({hasText: "Replace text in body"});
        expect(await bodyRules.getByRole("button", {name: "Add", exact: true}).count()).toBe(1);

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

describe("U5-06 레이트 리밋 카드와 Blocked 표시", () => {
    const openEdit = async (app: Awaited<ReturnType<typeof startAdminApp>>, port: number | "new") => {
        await app.page.goto(`${app.url}#/tunnels/${port}`);
        await app.page.locator("#input-rate-window").waitFor({state: "visible", timeout: 10_000});
    };
    const values = (page: Page) => Promise.all(["#input-rate-window", "#input-rate-max", "#input-rate-ban"].map((id) => page.locator(id).inputValue()));

    test("거절이 있는 online 카드에만 Blocked 합계를 보인다", async () => {
        const app = await startAdminApp({fixture: "with-tunnels"});
        try {
            await openTunnels(app.page);
            await card(app.page, 20002).locator("[data-blocked]").waitFor({state: "visible", timeout: 10_000});
            expect(await card(app.page, 20002).locator("[data-blocked]").textContent()).toBe("Blocked 7");
            expect(await card(app.page, 20001).locator("[data-blocked]").count()).toBe(0);
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
