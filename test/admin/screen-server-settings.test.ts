import fs from "fs";
import path from "path";
import type {Page} from "playwright";
import {startAdminApp} from "../helpers/adminApp";

const root = path.resolve(__dirname, "../..");

// 초기 로드(설정 → 해시 → 관리자 인증서)가 끝나야 값과 Apply 상태가 자리 잡는다.
const openServerSettings = async (page: Page) => {
    await page.evaluate(() => { location.hash = "#/server"; });
    await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Server settings", undefined, {timeout: 10_000});
    await page.waitForFunction(() => ((document.querySelector("#input-key") as HTMLInputElement | null)?.value ?? "") !== "",
        undefined, {timeout: 15_000});
};

const waitForApply = (page: Page, disabled: boolean) =>
    page.waitForFunction((want) => {
        const button = Array.from(document.querySelectorAll("button")).find((element) => element.textContent?.trim() === "Apply");
        return !!button && button.disabled === want;
    }, disabled, {timeout: 10_000});

const nextFrame = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

test("옛 ServerSetLayout 과 InputCertFile 이 layout 에 남아 있지 않다", () => {
    expect(fs.existsSync(path.join(root, "admin/src/layout/ServerSetLayout.svelte"))).toBe(false);
    expect(fs.existsSync(path.join(root, "admin/src/layout/InputCertFile.svelte"))).toBe(false);
});

test("변경이 없으면 Apply 가 잠기고, 값을 바꾸면 풀리며, Reset 이 원래 값으로 되돌린다", async () => {
    const app = await startAdminApp();
    try {
        await openServerSettings(app.page);
        await waitForApply(app.page, true);

        const key = app.page.locator("#input-key");
        const original = await key.inputValue();
        await key.fill("changed-key");
        await waitForApply(app.page, false);

        await app.page.getByRole("button", {name: "Reset", exact: true}).click();
        await app.page.waitForFunction((value) => (document.querySelector("#input-key") as HTMLInputElement).value === value,
            original, {timeout: 10_000});
        await waitForApply(app.page, true);

        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("숫자 입력은 옛 _enforceMinMax 와 같이 정수부로 범위를 비교해 자른다", async () => {
    const app = await startAdminApp();
    try {
        await openServerSettings(app.page);
        // 기대값은 삭제 전 ServerSetLayout.svelte 66~76행을 그대로 실행해 얻었다.
        // parseInt 로 비교하므로 -0.5 는 0 보다 작다고 보지 않아 그대로 남고, 0.5 는 1 보다 작다고 보아 1 이 된다.
        const CASES: ReadonlyArray<readonly [string, string, string]> = [
            ["#input-admin-port", "70000", "65535"],
            ["#input-admin-port", "0", "0"],
            ["#input-admin-port", "-0.5", "-0.5"],
            ["#input-mem-cache-limit", "0.5", "1"],
            ["#input-mem-cache-limit", "100000", "99999"],
        ];
        for(const [selector, typed, expected] of CASES) {
            await app.page.locator(selector).fill(typed);
            await nextFrame(app.page);
            expect([selector, typed, await app.page.locator(selector).inputValue()]).toEqual([selector, typed, expected]);
        }
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("관리자 TLS 를 켜면 인증서 파일 입력 3개와 Remove CA 가 나타나고, 끄면 사라진다", async () => {
    const app = await startAdminApp();
    try {
        await openServerSettings(app.page);
        const adminTls = app.page.locator("#input-admin-tls");
        const files = app.page.locator('input[type="file"]');

        await adminTls.check();
        await app.page.waitForFunction(() => document.querySelectorAll('input[type="file"]').length === 3, undefined, {timeout: 10_000});
        for(let index = 0; index < 3; index++) expect(await files.nth(index).isVisible()).toBe(true);
        await app.page.getByRole("button", {name: "Remove CA", exact: true}).waitFor({state: "visible", timeout: 10_000});
        // 인증서 파일은 비밀값을 담는다. 파일 입력에 채울 뿐 PEM 본문이 화면 글자로 드러나지 않아야 한다.
        expect(await app.page.locator("body").innerText()).not.toMatch(/-----BEGIN/);

        await adminTls.uncheck();
        await app.page.waitForFunction(() => document.querySelectorAll('input[type="file"]').length === 0, undefined, {timeout: 10_000});

        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("터널 TLS·메모리 캐시 한도·Keep-Alive 입력이 id 와 라벨로 연결되어 있다", async () => {
    const app = await startAdminApp();
    try {
        await openServerSettings(app.page);
        for(const id of ["#input-tunnel-tls", "#input-mem-cache-limit", "#input-keep-alive"]) {
            expect([id, await app.page.locator(id).count()]).toEqual([id, 1]);
        }
        expect(await app.page.getByLabel("Memory cache limit (MiB)", {exact: true}).getAttribute("id")).toBe("input-mem-cache-limit");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("Apply 는 바꾼 값을 담은 저장 요청을 보내고 서버가 그 값을 런타임에 적용한다", async () => {
    const app = await startAdminApp();
    try {
        await openServerSettings(app.page);
        await waitForApply(app.page, true);

        const limit = app.page.locator("#input-mem-cache-limit");
        const next = Number(await limit.inputValue()) + 1;
        await limit.fill(String(next));
        await waitForApply(app.page, false);

        const saved = app.page.waitForResponse((response) => response.request().method() === "POST"
            && new URL(response.url()).pathname === "/api/serverOption", {timeout: 10_000});
        await app.page.getByRole("button", {name: "Apply", exact: true}).click();
        const response = await saved;
        expect(response.status()).toBe(200);
        expect(response.request().postDataJSON().globalMemCacheLimit).toBe(next);
        expect((await response.json()).success).toBe(true);

        // 화면만 보고 판단하지 않고, 스텁 TTTServer 가 실제로 적용 요청을 받았는지 호출 기록으로 확인한다.
        const applied = (await app.calls()).filter((call) => call.method === "applyServerOption");
        expect(applied).toHaveLength(1);
        expect(applied[0].args[0].globalMemCacheLimit).toBe(next);

        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);
