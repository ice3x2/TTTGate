import type {Page} from "playwright";
import {startAdminApp, type AdminApp} from "../helpers/adminApp";
import {RBAC_PASSWORDS} from "../helpers/rbacFixture";

// #213 신뢰 클라이언트 화면과 "등록 명령 복사"
jest.setTimeout(120_000);

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

