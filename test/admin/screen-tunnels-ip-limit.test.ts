import type {Page, Request} from "playwright";
import {startAdminApp, type AdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {RBAC_LONG_IPV6, RBAC_PASSWORDS} from "../helpers/rbacFixture";

// 이슈 348 — 터널 목록 줄의 IP 제한 토글과 내 IP 갱신 버튼, 편집 화면의 같은 설정.
// 'rbac-toggle': alice 의 20001 은 carol(toggle)에게 공유되어 있고, IP 제한은 꺼져 있으며 alice 의 허용 IP(203.0.113.5)가 남아 있다.
// admin 만 보는 20003 은 IP 제한이 켜져 있고 admin 의 허용 IP 가 긴 IPv6 다. 브라우저는 127.0.0.1 에서 요청한다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

type Name = keyof typeof RBAC_PASSWORDS;

const hashIs = (page: Page, expected: string) =>
    page.waitForFunction((value) => location.hash === value, expected, {timeout: 10_000});
const card = (page: Page, port: number) => page.locator(`li[data-port="${port}"]`);
const ipToggle = (page: Page, port: number) => card(page, port).locator(".tunnel-ip-toggle");
const ipRefresh = (page: Page, port: number) => card(page, port).locator(".tunnel-ip-refresh");
const isRequest = (method: string, pathname: string) => (request: Request) =>
    request.method() === method && new URL(request.url()).pathname === pathname;
/** 토글 버튼 글자가 기대값이 될 때까지 기다린다(상태는 1초마다 다시 읽는다). */
const waitToggleText = (page: Page, port: number, expected: string) => page.waitForFunction(([target, text]) =>
    document.querySelector(`li[data-port="${target}"] .tunnel-ip-toggle`)?.textContent?.replace(/\s+/g, " ").trim() === text,
    [port, expected] as const, {timeout: 10_000});

const withApp = async (name: Name, hash: string, check: (app: AdminApp) => Promise<void>): Promise<void> => {
    const app = await startAdminApp({fixture: "rbac-toggle", ...(name === "admin" ? {} : {login: {username: name, password: RBAC_PASSWORDS[name]}})});
    try {
        await app.page.goto(`${app.url}${hash}`);
        await hashIs(app.page, hash);
        await check(app);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

test("고칠 수 있는 사용자는 줄의 토글로 IP 제한을 켜고 끄며, 버튼은 줄 링크 밖에 있다 (FR-16·FR-17·FR-17b)", () => withApp("admin", "#/tunnels", async ({page}) => {
    await waitToggleText(page, 20001, "IP limit off");
    // 버튼은 편집 화면으로 가는 링크 안에 있지 않다.
    expect(await card(page, 20001).locator("a.tunnel-link .tunnel-ip-toggle, a.tunnel-link .tunnel-ip-refresh").count()).toBe(0);
    expect(await ipToggle(page, 20001).getAttribute("aria-label")).toBe("IP limit, off");
    // IP 제한이 꺼져 있으면 갱신 버튼은 누를 수 없다.
    expect(await ipRefresh(page, 20001).isDisabled()).toBe(true);
    expect(await ipRefresh(page, 20001).getAttribute("aria-label")).toBe("Update to my IP");

    const turnOn = page.waitForRequest(isRequest("PUT", "/api/tunneling/20001/activatorIpOnly"), {timeout: 10_000});
    await ipToggle(page, 20001).click();
    expect((await turnOn).postDataJSON()).toEqual({enabled: true});
    // 켤 때 내 IP 가 들어가고, alice 의 항목이 하나 더 있다.
    await waitToggleText(page, 20001, "127.0.0.1 +1");
    expect(await ipToggle(page, 20001).getAttribute("aria-label")).toBe("IP limit, on, allowed IP 127.0.0.1, and 1 more");
    expect(await ipToggle(page, 20001).getAttribute("class")).toContain("on");
    expect(await ipRefresh(page, 20001).isDisabled()).toBe(false);
    // 버튼을 눌러도 편집 화면으로 가지 않는다.
    expect(await page.evaluate(() => location.hash)).toBe("#/tunnels");

    const turnOff = page.waitForRequest(isRequest("PUT", "/api/tunneling/20001/activatorIpOnly"), {timeout: 10_000});
    await ipToggle(page, 20001).click();
    expect((await turnOff).postDataJSON()).toEqual({enabled: false});
    await waitToggleText(page, 20001, "IP limit off");
}));

test("터널을 꺼도 IP 제한 토글과 갱신 버튼은 비활성이 되지 않는다 (AC-10·FR-2a)", () => withApp("admin", "#/tunnels", async ({page}) => {
    await waitToggleText(page, 20003, RBAC_LONG_IPV6);
    const off = page.waitForResponse((response) => isRequest("POST", "/api/tunneling/active/20003")(response.request()), {timeout: 10_000});
    await card(page, 20003).getByRole("switch").click();
    expect((await off).status()).toBe(200);
    await page.waitForFunction(() => document.querySelector('li[data-port="20003"] [role="switch"]')?.getAttribute("aria-checked") === "false",
        undefined, {timeout: 10_000});
    expect(await ipToggle(page, 20003).isDisabled()).toBe(false);
    expect(await ipToggle(page, 20003).getAttribute("aria-disabled")).not.toBe("true");
    expect(await ipRefresh(page, 20003).isDisabled()).toBe(false);

    // 꺼진 터널에서도 갱신한다. 결과 IP 를 바로 보인다.
    const refreshed = page.waitForResponse((response) => isRequest("POST", "/api/tunneling/20003/activatorIp")(response.request()), {timeout: 10_000});
    await ipRefresh(page, 20003).click();
    expect((await refreshed).status()).toBe(200);
    await waitToggleText(page, 20003, "127.0.0.1");
}));

test("켜기 권한만 있으면 꺼진 토글은 눌러 켜고, 켜진 토글은 잠긴 켜짐이라 눌러도 요청이 없으며 갱신은 된다 (AC-14)", () => withApp("carol", "#/tunnels", async ({page}) => {
    await waitToggleText(page, 20001, "IP limit off");
    const puts: unknown[] = [];
    page.on("request", (request) => { if(isRequest("PUT", "/api/tunneling/20001/activatorIpOnly")(request)) puts.push(request.postDataJSON()); });

    await ipToggle(page, 20001).click();
    await waitToggleText(page, 20001, "127.0.0.1 +1");
    expect(puts).toEqual([{enabled: true}]);

    // 잠긴 켜짐: 초록색과 IP 는 그대로 보이고, 작은 자물쇠가 있으며 이름에 끌 수 없다고 적는다. 흐리게 하지 않는다.
    const toggle = ipToggle(page, 20001);
    expect(await toggle.getAttribute("aria-disabled")).toBe("true");
    expect(await toggle.getAttribute("aria-label")).toBe("IP limit, on, allowed IP 127.0.0.1, and 1 more, can't turn off");
    expect(await toggle.locator(".tunnel-ip-lock").count()).toBe(1);
    expect(await toggle.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
    // aria-disabled 버튼은 Playwright 가 누를 수 없는 요소로 보고 기다리므로, 사용자가 누르는 것과 같은 클릭을 강제로 보낸다.
    await toggle.click({force: true});
    await page.waitForTimeout(500);
    expect(puts).toEqual([{enabled: true}]);
    expect(await toggle.getAttribute("aria-disabled")).toBe("true");
    await waitToggleText(page, 20001, "127.0.0.1 +1");

    const refreshed = page.waitForResponse((response) => isRequest("POST", "/api/tunneling/20001/activatorIp")(response.request()), {timeout: 10_000});
    await ipRefresh(page, 20001).click();
    expect((await refreshed).status()).toBe(200);
}));

test("폭 360px 에서 긴 IPv6 허용 IP 가 있는 줄이 가로 스크롤을 만들지 않고, 전체 주소는 title 에 있다 (AC-17·FR-17a)", () => withApp("admin", "#/tunnels", async ({page}) => {
    await waitToggleText(page, 20003, RBAC_LONG_IPV6);
    // 지금 요청자 IP(127.0.0.1)와 내 허용 IP 가 다르므로 갱신 버튼을 강조한다(FR-17).
    expect(await ipRefresh(page, 20003).getAttribute("class")).toContain("emphasized");
    expect(await ipToggle(page, 20003).getAttribute("title")).toContain(RBAC_LONG_IPV6);
    await page.setViewportSize({width: 360, height: 800});
    await page.waitForFunction(() => {
        const fits = (selector: string) => { const element = document.querySelector(selector)!; return element.scrollWidth <= element.clientWidth; };
        return document.documentElement.scrollWidth <= window.innerWidth && fits('li[data-port="20003"]')
            && fits('li[data-port="20003"] .tunnel-ip-row');
    }, undefined, {timeout: 5_000});
    // 토글과 갱신 버튼은 44px 이상 높이의 누르기 쉬운 크기다.
    const box = await ipRefresh(page, 20003).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
}));

test("편집 화면에도 IP 제한이 있다. 새 터널은 켜져 있고 기존 터널은 저장된 값이며, 저장 본문에 실린다 (FR-19)", () => withApp("alice", "#/tunnels", async ({page}) => {
    await page.getByRole("button", {name: "Add tunneling service", exact: true}).click();
    await hashIs(page, "#/tunnels/new");
    const checkbox = page.locator("#input-activator-ip-only");
    await checkbox.waitFor({state: "visible", timeout: 10_000});
    expect(await checkbox.isChecked()).toBe(true);

    await page.evaluate(() => { location.hash = "#/tunnels"; });
    await card(page, 20001).locator("a.tunnel-link").click();
    await hashIs(page, "#/tunnels/20001");
    await page.locator("#input-destination-host").waitFor({state: "visible", timeout: 10_000});
    expect(await checkbox.isChecked()).toBe(false);
    await checkbox.check();
    await page.locator("#tunnel-trusted-client-a").check();
    const saved = page.waitForRequest(isRequest("POST", "/api/tunnelingOption"), {timeout: 10_000});
    await page.getByRole("button", {name: "Apply and Restart", exact: true}).click();
    expect((await saved).postDataJSON().activatorIpOnly).toBe(true);
    await hashIs(page, "#/tunnels");
}));
