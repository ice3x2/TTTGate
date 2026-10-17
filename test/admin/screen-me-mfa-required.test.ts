import type {Page} from "playwright";
import {startAdminApp} from "../helpers/adminApp";
import {RBAC_PASSWORDS} from "../helpers/rbacFixture";
import {generate} from "../../src/server/mfa/Totp";
import {base32Decode} from "../../src/server/mfa/Base32";

// U4-09 / #128 — 슈퍼유저 MFA 강제. 서버 옵션을 켠 뒤 admin 으로 로그인하면 #/me 에 고정되고, 등록을 마치면 풀린다.
jest.setTimeout(120_000);

const hashIs = (page: Page, expected: string) =>
    page.waitForFunction((value) => location.hash === value, expected, {timeout: 10_000});

test("강제 등록 중에는 #/me 에 고정되고, 등록을 마치면 풀리며, 해제는 거부된다", async () => {
    const app = await startAdminApp({fixture: "rbac", login: false});
    try {
        const {page} = app;
        await app.serverOption({mfaRequiredForSuperusers: true});
        await page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
        await page.locator("#login-username").fill("admin");
        await page.locator("#login-password").fill(RBAC_PASSWORDS.admin);
        await page.getByRole("button", {name: "OK", exact: true}).click();
        await hashIs(page, "#/me");
        // 고정 중에는 가드가 되돌리기 전에도 다른 화면을 마운트하지 않는다(서버는 403 으로 막고 감사를 남긴다).
        const denied: string[] = [];
        page.on("response", (response) => { if(response.status() === 403) denied.push(new URL(response.url()).pathname); });
        const banner = page.locator("#mfa-required-banner");
        await banner.waitFor({state: "visible", timeout: 10_000});
        expect((await banner.textContent())?.trim()).toBe("Superusers must enable two-factor authentication.");
        expect(await page.locator('[aria-label="Open menu"]').count()).toBe(0);
        await page.evaluate(() => { window.location.hash = "#/users"; });
        await hashIs(page, "#/me");
        await page.evaluate(() => { window.location.hash = "#/me/password"; });
        await hashIs(page, "#/me/password");
        await page.locator("#pw-current").waitFor({state: "visible", timeout: 10_000});
        await page.evaluate(() => { window.location.hash = "#/me"; });
        await hashIs(page, "#/me");
        expect(denied).toEqual([]);

        await page.locator("#mfa-setup button").click();
        const modal = page.locator(".mfa-enroll-modal");
        await modal.waitFor({state: "visible", timeout: 10_000});
        const secret = (await page.locator("#mfa-secret").textContent())!.trim();
        await page.locator("#mfa-next button").click();
        await page.locator("#mfa-code").fill(generate(base32Decode(secret)!, Date.now()));
        await page.locator("#mfa-confirm button").click();
        await page.locator("#mfa-saved").check();
        await page.locator("#mfa-done button").click();
        await modal.waitFor({state: "detached", timeout: 10_000});
        await banner.waitFor({state: "detached", timeout: 10_000});
        await page.locator('[aria-label="Open menu"]').waitFor({state: "visible", timeout: 10_000});
        await page.evaluate(() => { window.location.hash = "#/users"; });
        await hashIs(page, "#/users");
        await page.locator("li[data-user-id]").first().waitFor({state: "visible", timeout: 10_000});

        await page.evaluate(() => { window.location.hash = "#/me"; });
        await page.locator("#mfa-disable button").click();
        await page.locator("#mfa-disable-password").fill(RBAC_PASSWORDS.admin);
        await page.locator("#mfa-disable-confirm button").click();
        await page.locator(".mfa-disable-modal").getByText("Superusers must keep two-factor authentication enabled.", {exact: true})
            .waitFor({state: "visible", timeout: 10_000});
        expect((await page.locator("#mfa-status").textContent())?.trim()).toBe("Enabled");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
});
