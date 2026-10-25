import type {Page} from "playwright";
import {startAdminApp, type AdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {RBAC_PASSWORDS} from "../helpers/rbacFixture";
import {generate} from "../../src/server/mfa/Totp";
import {base32Decode} from "../../src/server/mfa/Base32";

// U4-09 / #128 — 내 계정 화면의 MFA 카드(등록 3단계·재발급·해제)와 세션 카드. alice 로 시작한다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const hashIs = (page: Page, expected: string) =>
    page.waitForFunction((value) => location.hash === value, expected, {timeout: 10_000});

const withAlice = async (check: (app: AdminApp) => Promise<void>, extraLogins?: Array<{as: string; userAgent: string}>): Promise<void> => {
    const app = await startAdminApp({fixture: "rbac", login: {username: "alice", password: RBAC_PASSWORDS.alice}, extraLogins});
    try {
        await app.page.goto(`${app.url}#/me`);
        await hashIs(app.page, "#/me");
        await app.page.locator("#mfa-status").waitFor({state: "visible", timeout: 10_000});
        await check(app);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

const modal = (page: Page) => page.locator(".mfa-enroll-modal");
const codeOf = (secret: string) => generate(base32Decode(secret)!, Date.now());

/** 등록 1·2단계를 마치고 복구 코드 단계(3)에 도착한다. 돌려주는 값은 화면에 보인 복구 코드다. */
const enrollToCodes = async (page: Page): Promise<string[]> => {
    await page.locator("#mfa-setup button").click();
    await modal(page).waitFor({state: "visible", timeout: 10_000});
    const secret = (await page.locator("#mfa-secret").textContent())!.trim();
    await page.locator("#mfa-next button").click();
    await page.locator("#mfa-code").fill(codeOf(secret));
    await page.locator("#mfa-confirm button").click();
    await page.locator("#mfa-recovery-codes li").first().waitFor({state: "visible", timeout: 10_000});
    return page.locator("#mfa-recovery-codes li").allTextContents();
};

const finish = async (page: Page) => {
    await page.locator("#mfa-saved").check();
    await page.locator("#mfa-done button").click();
    await modal(page).waitFor({state: "detached", timeout: 10_000});
    await page.locator("#mfa-status").filter({hasText: "Enabled"}).waitFor({state: "visible", timeout: 10_000});
};

test("QR 과 키로 등록하고 복구 코드를 저장했다고 확인해야 끝나며, 카드가 Enabled 가 된다", () => withAlice(async ({page}) => {
    expect((await page.locator("#mfa-status").textContent())?.trim()).toBe("Off");
    await page.locator("#mfa-setup button").click();
    await modal(page).waitFor({state: "visible", timeout: 10_000});
    const qr = page.locator("#mfa-qr");
    await qr.waitFor({state: "visible"});
    expect(await qr.getAttribute("width")).toBe("192");
    await page.waitForFunction(() => {
        const canvas = document.querySelector("#mfa-qr") as HTMLCanvasElement;
        const blank = document.createElement("canvas");
        blank.width = canvas.width;
        blank.height = canvas.height;
        return canvas.toDataURL() !== blank.toDataURL();
    }, undefined, {timeout: 10_000});
    const secret = (await page.locator("#mfa-secret").textContent())!.trim();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await page.locator("#mfa-next button").click();
    await page.locator("#mfa-code").fill(codeOf(secret));
    await page.locator("#mfa-confirm button").click();
    const items = page.locator("#mfa-recovery-codes li");
    await items.first().waitFor({state: "visible", timeout: 10_000});
    const codes = await items.allTextContents();
    expect(codes).toHaveLength(10);
    for(const code of codes) expect(code).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
    expect(await page.locator("#mfa-done button").isDisabled()).toBe(true);
    await page.locator("#mfa-saved").check();
    expect(await page.locator("#mfa-done button").isEnabled()).toBe(true);
    await page.locator("#mfa-done button").click();
    await modal(page).waitFor({state: "detached", timeout: 10_000});
    await page.locator("#mfa-status").filter({hasText: "Enabled"}).waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#mfa-recovery-remaining").textContent()).toBe("10 recovery codes left");
}));

test("틀린 코드는 모달 안에서 오류를 보이고 모달은 열려 있다", () => withAlice(async ({page}) => {
    await page.locator("#mfa-setup button").click();
    await modal(page).waitFor({state: "visible", timeout: 10_000});
    const secret = (await page.locator("#mfa-secret").textContent())!.trim();
    await page.locator("#mfa-next button").click();
    await page.locator("#mfa-code").fill(codeOf(secret) === "000000" ? "111111" : "000000");
    await page.locator("#mfa-confirm button").click();
    await modal(page).getByText("The code is incorrect.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    expect(await modal(page).isVisible()).toBe(true);
}));

test("1단계의 Escape 는 모달을 닫지만 3단계의 Escape 는 닫지 않는다", () => withAlice(async ({page}) => {
    await page.locator("#mfa-setup button").click();
    await modal(page).waitFor({state: "visible", timeout: 10_000});
    await page.keyboard.press("Escape");
    await modal(page).waitFor({state: "detached", timeout: 10_000});

    await enrollToCodes(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    expect(await modal(page).isVisible()).toBe(true);
    await finish(page);
}));

// #173 — 새 코드를 보이는 동안 뒤로가기·주소 변경으로 화면이 사라지면 코드를 잃는다(서버는 이미 옛 코드를 무효화했다).
test("3단계에서 hash 를 바꾸려 하면 이동이 막히고 복구 코드가 그대로 보인다", () => withAlice(async ({page}) => {
    const codes = await enrollToCodes(page);
    await page.evaluate(() => { location.hash = "#/tunnels"; });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => location.hash)).toBe("#/me");
    expect(await modal(page).isVisible()).toBe(true);
    expect(await page.locator("#mfa-recovery-codes li").allTextContents()).toEqual(codes);
    await page.getByText("Save the recovery codes before you leave this page.", {exact: true}).waitFor({state: "visible"});
    await finish(page);
    // 모달을 닫은 뒤에는 다시 이동할 수 있다.
    await page.evaluate(() => { location.hash = "#/tunnels"; });
    await hashIs(page, "#/tunnels");
}));

test("새 복구 코드를 보이는 동안 뒤로가기를 해도 화면과 코드가 남는다", () => withAlice(async ({page}) => {
    await enrollToCodes(page);
    await finish(page);
    // 뒤로 갈 기록을 만든다.
    await page.evaluate(() => { location.hash = "#/tunnels"; });
    await hashIs(page, "#/tunnels");
    await page.evaluate(() => { location.hash = "#/me"; });
    await hashIs(page, "#/me");
    await page.locator("#mfa-status").waitFor({state: "visible", timeout: 10_000});
    const codesModal = page.locator(".mfa-codes-modal");
    await page.locator("#mfa-new-codes button").click();
    await codesModal.waitFor({state: "visible"});
    await page.locator("#mfa-codes-password").fill(RBAC_PASSWORDS.alice);
    await page.locator("#mfa-codes-generate button").click();
    await codesModal.locator("#mfa-recovery-codes li").first().waitFor({state: "visible", timeout: 10_000});
    const codes = await codesModal.locator("#mfa-recovery-codes li").allTextContents();
    await page.goBack();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => location.hash)).toBe("#/me");
    expect(await codesModal.locator("#mfa-recovery-codes li").allTextContents()).toEqual(codes);
    await page.locator("#mfa-codes-saved").check();
    await page.locator("#mfa-codes-done button").click();
    await codesModal.waitFor({state: "detached"});
}));

test("복구 코드를 재발급하면 이전 목록과 모두 다르고, 틀린 비밀번호는 목록 없이 오류를 보인다", () => withAlice(async ({page}) => {
    const first = await enrollToCodes(page);
    await finish(page);

    const codesModal = page.locator(".mfa-codes-modal");
    await page.locator("#mfa-new-codes button").click();
    await codesModal.waitFor({state: "visible"});
    await page.locator("#mfa-codes-password").fill("wrong-password-1");
    await page.locator("#mfa-codes-generate button").click();
    await codesModal.getByText("The password is incorrect.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    expect(await codesModal.locator("#mfa-recovery-codes").count()).toBe(0);

    await page.locator("#mfa-codes-password").fill(RBAC_PASSWORDS.alice);
    await page.locator("#mfa-codes-generate button").click();
    await codesModal.locator("#mfa-recovery-codes li").first().waitFor({state: "visible", timeout: 10_000});
    const second = await codesModal.locator("#mfa-recovery-codes li").allTextContents();
    expect(second).toHaveLength(10);
    for(const code of second) expect(first).not.toContain(code);
    // #156 — 서버는 이미 옛 코드를 무효화했다. 새 코드를 보인 뒤에는 Escape·바깥 클릭으로 닫히지 않고, 저장 확인 뒤에만 닫힌다.
    await page.keyboard.press("Escape");
    await page.locator(".modal-overlay").click({position: {x: 5, y: 5}});
    expect(await codesModal.isVisible()).toBe(true);
    expect(await page.locator("#mfa-codes-done button").isDisabled()).toBe(true);
    await page.locator("#mfa-codes-saved").check();
    await page.locator("#mfa-codes-done button").click();
    await codesModal.waitFor({state: "detached"});
    // 세션은 그대로다(401 이 세션 만료로 처리되지 않았다).
    expect(await page.locator("#login-password").count()).toBe(0);
}));

test("MFA 를 끄면 토스트 뒤 Off 가 된다", () => withAlice(async ({page}) => {
    await enrollToCodes(page);
    await finish(page);
    await page.locator("#mfa-disable button").click();
    await page.locator(".mfa-disable-modal").waitFor({state: "visible"});
    await page.locator("#mfa-disable-password").fill(RBAC_PASSWORDS.alice);
    await page.locator("#mfa-disable-confirm button").click();
    await page.getByText("Two-factor authentication disabled.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await page.locator("#mfa-status").filter({hasText: "Off"}).waitFor({state: "visible", timeout: 10_000});
}));

test("세션 카드는 현재 기기를 표시하고 다른 기기를 로그아웃한다", () => withAlice(async ({page}) => {
    const rows = page.locator("#me-session-list .session-row");
    await page.waitForFunction(() => document.querySelectorAll("#me-session-list .session-row").length === 2, undefined, {timeout: 10_000});
    expect(await page.locator("#me-session-list").getByText("this device", {exact: true}).count()).toBe(1);
    await page.locator("#me-logout-others button").click();
    await page.getByText("Signed out 1 other device(s).", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    await page.waitForFunction(() => document.querySelectorAll("#me-session-list .session-row").length === 1, undefined, {timeout: 10_000});
    expect(await rows.count()).toBe(1);
    expect(await page.locator("#me-logout-others button").isDisabled()).toBe(true);
}, [{as: "alice", userAgent: "UA-ALICE-1"}]));

test("해제 모달에서 비밀번호가 틀리면 오류만 보이고 세션은 유지되며, 진짜 세션 만료는 로그인 화면으로 간다", () => withAlice(async ({page}) => {
    await enrollToCodes(page);
    await finish(page);
    await page.locator("#mfa-disable button").click();
    const disableModal = page.locator(".mfa-disable-modal");
    await disableModal.waitFor({state: "visible"});
    await page.locator("#mfa-disable-password").fill("wrong-password-1");
    await page.locator("#mfa-disable-confirm button").click();
    await disableModal.getByText("The password is incorrect.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
    expect(await page.locator("#login-password").count()).toBe(0);

    // 쿠키를 지우면 같은 요청의 401 은 코드가 없는 세션 만료다.
    await page.context().clearCookies();
    await page.locator("#mfa-disable-password").fill(RBAC_PASSWORDS.alice);
    await page.locator("#mfa-disable-confirm button").click();
    await page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
}));
