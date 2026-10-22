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
