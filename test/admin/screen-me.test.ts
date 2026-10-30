import type {Page} from "playwright";
import {startAdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {RBAC_PASSWORDS} from "../helpers/rbacFixture";

// U3-02 / #104 — 비밀번호 변경 화면과 강제 변경 고정. 테스트마다 rbac fixture 로 앱을 새로 띄운다
// (앞 케이스가 바꾼 비밀번호가 뒤 케이스로 새지 않는다). 계정 카드 케이스는 U3-05 가 더한다.
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

type Name = keyof typeof RBAC_PASSWORDS;

const open = (name: Name) => startAdminApp({fixture: "rbac", login: {username: name, password: RBAC_PASSWORDS[name]}});

const hashIs = (page: Page, expected: string) =>
    page.waitForFunction((value) => location.hash === value, expected, {timeout: 10_000});

const goPassword = async (page: Page, url: string) => {
    await page.goto(`${url}#/me/password`);
    await hashIs(page, "#/me/password");
    await page.locator("#pw-current").waitFor({state: "visible", timeout: 10_000});
};

const fill = async (page: Page, values: {current?: string; next?: string; confirm?: string}) => {
    await page.locator("#pw-current").fill(values.current ?? "");
    await page.locator("#pw-new").fill(values.next ?? "");
    await page.locator("#pw-confirm").fill(values.confirm ?? "");
    await page.getByRole("button", {name: "Change password", exact: true}).click();
};

const labelOf = (page: Page, id: string) => page.locator(`label[for="${id}"]`).textContent();

describe("screen-me 비밀번호 변경", () => {
    test("alice 의 비강제 화면은 Current password 라벨과 Back 이 있고 강제 안내·Sign out 버튼이 없다", async () => {
        const app = await open("alice");
        try {
            await goPassword(app.page, app.url);
            expect(await labelOf(app.page, "pw-current")).toBe("Current password");
            expect(await app.page.locator("#pw-forced-note").count()).toBe(0);
            expect(await app.page.getByRole("button", {name: "Sign out", exact: true}).count()).toBe(0);
            expect(await app.page.locator('header [aria-label="Back"]').count()).toBe(1);
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });

    test("클라이언트 검증은 순서대로 첫 오류만 보이고 요청하지 않는다", async () => {
        const app = await open("alice");
        try {
            await goPassword(app.page, app.url);
            const requests: string[] = [];
            app.page.on("request", (request) => { if(new URL(request.url()).pathname === "/api/me/password") requests.push(request.method()); });

            await fill(app.page, {current: RBAC_PASSWORDS.alice, next: "short"});
            await app.page.getByText("Use at least 8 characters.", {exact: true}).waitFor({state: "visible"});

            await fill(app.page, {current: RBAC_PASSWORDS.alice, next: "new-password-5678", confirm: "different-5678"});
            await app.page.getByText("Passwords do not match.", {exact: true}).waitFor({state: "visible"});

            // 정확히 8자는 길이 검사를 통과해 다음 검사(확인 불일치)로 간다.
            await fill(app.page, {current: RBAC_PASSWORDS.alice, next: "abcdefgh", confirm: "abcdefgX"});
            await app.page.getByText("Passwords do not match.", {exact: true}).waitFor({state: "visible"});
            expect(await app.page.getByText("Use at least 8 characters.", {exact: true}).count()).toBe(0);

            await fill(app.page, {current: RBAC_PASSWORDS.alice, next: RBAC_PASSWORDS.alice, confirm: RBAC_PASSWORDS.alice});
            await app.page.getByText("Choose a password different from the current one.", {exact: true}).waitFor({state: "visible"});

            await fill(app.page, {current: "", next: "new-password-5678", confirm: "new-password-5678"});
            await app.page.getByText("Enter your current password.", {exact: true}).waitFor({state: "visible"});
            // 첫 오류만 보인다.
            expect(await app.page.locator(".err-msg").count()).toBe(1);

            expect(requests).toEqual([]);
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });

    test("현재 비밀번호가 틀리면 서버 문구를 보이고 세션과 화면을 유지한다", async () => {
        const app = await open("alice");
        try {
            await goPassword(app.page, app.url);
            await fill(app.page, {current: "wrong-password-1", next: "new-password-5678", confirm: "new-password-5678"});
            const message = app.page.locator("#pw-message[role=alert]");
            await message.waitFor({state: "visible", timeout: 10_000});
            // 코드로 분기하지 않고 서버 문구를 그대로 보인다.
            expect((await message.textContent())?.trim()).toBe("The current password does not match");
            expect(await app.page.evaluate(() => location.hash)).toBe("#/me/password");
            expect(await app.page.locator("#login-username").count()).toBe(0);
            // 필드 값은 유지한다.
            expect(await app.page.locator("#pw-new").inputValue()).toBe("new-password-5678");
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });

    test("alice 가 비밀번호를 바꾸면 토스트 뒤 #/me 로 가고, 다음 로그인은 새 비밀번호만 받는다", async () => {
        const app = await open("alice");
        try {
            await goPassword(app.page, app.url);
            await fill(app.page, {current: RBAC_PASSWORDS.alice, next: "new-password-5678", confirm: "new-password-5678"});
            await app.page.getByText("Password changed.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
            await hashIs(app.page, "#/me");
            // U3-05: 돌아온 #/me 는 계정 카드다.
            await app.page.locator("#me-username").filter({hasText: "@alice"}).waitFor({state: "visible", timeout: 10_000});

            await app.page.locator('[aria-label="Open menu"]').click();
            await app.page.locator("#nav-sign-out").click();
            await app.page.locator("#login-username").waitFor({state: "visible", timeout: 10_000});
            await app.page.locator("#login-username").fill("alice");
            await app.page.locator("#login-password").fill(RBAC_PASSWORDS.alice);
            await app.page.getByRole("button", {name: "OK", exact: true}).click();
            const loginMessage = app.page.locator("#login-message");
            await loginMessage.filter({hasText: "The password is incorrect."}).waitFor({state: "visible", timeout: 10_000});

            await app.page.locator("#login-password").fill("new-password-5678");
            await app.page.getByRole("button", {name: "OK", exact: true}).click();
            await hashIs(app.page, "#/tunnels");
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });
});

describe("screen-me 강제 변경", () => {
    test("dave 는 #/me/password 에 도착하고 강제 안내·Temporary password·Sign out 만 있으며 메뉴와 Back 이 없다", async () => {
        const app = await open("dave");
        try {
            await hashIs(app.page, "#/me/password");
            const note = app.page.locator("#pw-forced-note");
            await note.waitFor({state: "visible", timeout: 10_000});
            expect(await note.textContent()).toBe("Set a new password before continuing.");
            expect(await labelOf(app.page, "pw-current")).toBe("Temporary password");
            expect(await app.page.locator('[aria-label="Open menu"]').count()).toBe(0);
            expect(await app.page.locator('[aria-label="Back"]').count()).toBe(0);
            expect(await app.page.getByRole("button", {name: "Sign out", exact: true}).count()).toBe(1);
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });

    test("dave 가 #/tunnels 로 가면 다시 #/me/password 다", async () => {
        const app = await open("dave");
        try {
            await hashIs(app.page, "#/me/password");
            await app.page.locator("#pw-current").waitFor({state: "visible", timeout: 10_000});
            // 강제 변경 중에는 가드가 되돌리기 전에도 다른 화면을 마운트하지 않는다(서버는 403 으로 막고 감사를 남긴다).
            const denied: string[] = [];
            app.page.on("response", (response) => {
                if(response.status() === 403) denied.push(new URL(response.url()).pathname);
            });
            for(const hash of ["#/tunnels", "#/status"]) {
                await app.page.evaluate((value) => { window.location.hash = value; }, hash);
                await hashIs(app.page, "#/me/password");
                await app.page.locator("#pw-current").waitFor({state: "visible", timeout: 10_000});
            }
            await app.page.goto(`${app.url}#/server`);
            await hashIs(app.page, "#/me/password");
            await app.page.locator("#pw-current").waitFor({state: "visible", timeout: 10_000});
            expect(denied).toEqual([]);
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });

    test("dave 가 비밀번호를 바꾸면 기본 화면(#/tunnels)으로 가고 메뉴가 생긴다", async () => {
        const app = await open("dave");
        try {
            await hashIs(app.page, "#/me/password");
            await app.page.locator("#pw-current").waitFor({state: "visible", timeout: 10_000});
            await fill(app.page, {current: RBAC_PASSWORDS.dave, next: "dave-new-password-1", confirm: "dave-new-password-1"});
            await hashIs(app.page, "#/tunnels");
            await app.page.locator('[aria-label="Open menu"]').waitFor({state: "visible", timeout: 10_000});
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });

    test("dave 가 Sign out 을 누르면 로그인 화면이다", async () => {
        const app = await open("dave");
        try {
            await hashIs(app.page, "#/me/password");
            await app.page.getByRole("button", {name: "Sign out", exact: true}).click();
            await app.page.locator("#login-password").waitFor({state: "visible", timeout: 10_000});
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });
});

describe("screen-me 다시 읽기 실패", () => {
    test("비밀번호를 바꾼 뒤 /api/me 를 다시 읽지 못해도 빈 화면이 아니라 안내를 보인다", async () => {
        const app = await open("alice");
        try {
            await goPassword(app.page, app.url);
            await app.page.route("**/api/me", (route) => route.abort());
            await fill(app.page, {current: RBAC_PASSWORDS.alice, next: "new-password-5678", confirm: "new-password-5678"});
            const message = app.page.locator("#pw-message[role=alert]");
            await message.filter({hasText: "Password changed, but the account could not be reloaded."}).waitFor({state: "visible", timeout: 10_000});
            expect(await app.page.locator("header h1").textContent()).toBe("Change password");
            expect(await app.page.evaluate(() => location.hash)).toBe("#/me/password");
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });
});

describe("screen-me 계정 카드", () => {
    const goMe = async (page: Page, url: string) => {
        await page.goto(`${url}#/me`);
        await hashIs(page, "#/me");
        await page.locator("#me-username").waitFor({state: "visible", timeout: 10_000});
    };

    test("alice 의 #/me 는 사용자명·표시 이름·역할·그룹을 보이고 /api/me 를 다시 부르지 않는다", async () => {
        const app = await open("alice");
        try {
            await hashIs(app.page, "#/tunnels");
            const meRequests: string[] = [];
            app.page.on("request", (request) => { if(new URL(request.url()).pathname === "/api/me") meRequests.push(request.method()); });
            // 같은 문서 안에서 해시만 바꾼다(새로 읽으면 App 이 /api/me 를 부른다).
            await app.page.evaluate(() => { window.location.hash = "#/me"; });
            await hashIs(app.page, "#/me");
            await app.page.locator("#me-username").waitFor({state: "visible", timeout: 10_000});
            expect(meRequests).toEqual([]);
            expect(await app.page.locator("#me-username").textContent()).toBe("@alice");
            expect(await app.page.locator("#me-display-name").textContent()).toBe("Alice");
            expect((await app.page.locator("#me-role").textContent())?.trim()).toBe("regular");
            expect(await app.page.locator("#me-group").textContent()).toBe("Field team");
            expect(await app.page.locator("#screen-placeholder").count()).toBe(0);
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });

    test("Change password 는 #/me/password 로 가고 Back 으로 #/me 에 돌아온다", async () => {
        const app = await open("alice");
        try {
            await goMe(app.page, app.url);
            await app.page.getByRole("button", {name: "Change password", exact: true}).click();
            await hashIs(app.page, "#/me/password");
            await app.page.locator('[aria-label="Back"]').click();
            await hashIs(app.page, "#/me");
            await app.page.locator("#me-username").waitFor({state: "visible", timeout: 10_000});
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });

    test("드로어의 My account 는 #/me 로 간다", async () => {
        const app = await open("alice");
        try {
            await hashIs(app.page, "#/tunnels");
            await app.page.locator('[aria-label="Open menu"]').click();
            const dialog = app.page.locator('[role=dialog][aria-label="Navigation"]');
            await dialog.waitFor({state: "visible"});
            await dialog.getByText("My account", {exact: true}).click();
            await hashIs(app.page, "#/me");
            await app.page.locator("#me-username").waitFor({state: "visible", timeout: 10_000});
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });

    test("admin 의 #/me 는 superuser 와 Superusers 를 보인다", async () => {
        const app = await open("admin");
        try {
            await goMe(app.page, app.url);
            expect((await app.page.locator("#me-role").textContent())?.trim()).toBe("superuser");
            expect(await app.page.locator("#me-group").textContent()).toBe("Superusers");
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });
});
