import fs from "fs";
import path from "path";
import type {Page, Response} from "playwright";
import {startAdminApp} from "../helpers/adminApp";
import {getFreePort} from "../helpers/network";

const root = path.resolve(__dirname, "../..");

type Loaded = {serverOption: any; revision: number; certInfo: any};

const isGet = (pathname: string) => (response: Response) =>
    response.request().method() === "GET" && new URL(response.url()).pathname === pathname;

// 초기 로드(설정 → 해시 → 관리자 인증서)가 끝나야 값과 Apply 상태가 자리 잡는다.
// 화면이 받은 응답을 그대로 돌려주어, 테스트가 기대값을 서버 실제 값에서 만들게 한다.
const openServerSettings = async (page: Page): Promise<Loaded> => {
    const option = page.waitForResponse(isGet("/api/serverOption"), {timeout: 15_000});
    const cert = page.waitForResponse(isGet("/api/adminCert"), {timeout: 15_000});
    await page.evaluate(() => { location.hash = "#/server"; });
    await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Server settings", undefined, {timeout: 10_000});
    await page.waitForFunction(() => ((document.querySelector("#input-key") as HTMLInputElement | null)?.value ?? "") !== "",
        undefined, {timeout: 15_000});
    const optionJson = await (await option).json();
    const certJson = await (await cert).json();
    return {serverOption: optionJson.serverOption, revision: optionJson.revisionState.currentRevision, certInfo: certJson.certInfo};
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

test("숫자 입력은 입력란의 원문 문자열을 정수부로 범위와 비교해 자른다", async () => {
    const app = await startAdminApp();
    try {
        await openServerSettings(app.page);
        // 기대값은 삭제 전 8b39082 의 ServerSetLayout.svelte 66~76행(_enforceMinMax)을 그대로 실행해 얻었다.
        // 원문 문자열에 parseInt 를 쓰므로 -0.5 는 0 보다 작다고 보지 않아 남고, 0.5 와 0.0000001 은 1 이 된다.
        // 70000e-1·0.5e1·-5e-1 은 원문으로 읽어야 원본과 같은 값이 나오는 입력이다. 숫자로 바꾼 뒤 문자열화하면
        // 7000·5·-0.5 가 되어 각각 잘리지 않거나 다르게 잘린다.
        const SAME_AS_ORIGINAL: ReadonlyArray<readonly [string, string, string]> = [
            ["#input-admin-port", "70000", "65535"],
            ["#input-admin-port", "0", "0"],
            ["#input-admin-port", "-0.5", "-0.5"],
            ["#input-admin-port", "-1", "0"],
            ["#input-admin-port", "100000000000000000000000", "65535"],
            ["#input-admin-port", "", ""],
            ["#input-mem-cache-limit", "0.5", "1"],
            ["#input-mem-cache-limit", "0.0000001", "1"],
            ["#input-mem-cache-limit", "100000", "99999"],
            ["#input-mem-cache-limit", "1.5e3", "1.5e3"],
            ["#input-admin-port", "70000e-1", "65535"],
            ["#input-mem-cache-limit", "0.5e1", "1"],
            ["#input-admin-port", "-5e-1", "0"],
        ];
        // 원본과 의도적으로 다른 입력. 원본이 범위 밖 값을 통과시키던 입력이다. 원본은 원문의 parseInt 만 보므로
        // 1e5 는 100000(최대 99999 초과), 1e-7 은 최소 1 미만이 모델에 남았다. 범위 검사의 목적에 어긋나는
        // 결함이므로 정수부로 한 번 더 비교해 범위 안으로 넣는다.
        const DIFFERENT_FROM_ORIGINAL: ReadonlyArray<readonly [string, string, string]> = [
            ["#input-mem-cache-limit", "1e5", "99999"],
            ["#input-mem-cache-limit", "1e-7", "1"],
        ];
        const CASES = [...SAME_AS_ORIGINAL, ...DIFFERENT_FROM_ORIGINAL];
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
        const {certInfo} = await openServerSettings(app.page);
        // 전제: 이 fixture 의 관리자 인증서에 PEM 본문이 실제로 실려 온다. 전제가 없으면 아래 '드러나지 않는다' 단언이 공회전한다.
        expect(certInfo.key.value).toContain("-----BEGIN");
        expect(certInfo.cert.value).toContain("-----BEGIN");

        const adminTls = app.page.locator("#input-admin-tls");
        const files = app.page.locator('input[type="file"]');

        await adminTls.check();
        await app.page.waitForFunction(() => document.querySelectorAll('input[type="file"]').length === 3, undefined, {timeout: 10_000});
        for(let index = 0; index < 3; index++) expect(await files.nth(index).isVisible()).toBe(true);
        await app.page.getByRole("button", {name: "Remove CA", exact: true}).waitFor({state: "visible", timeout: 10_000});
        // 전제: 그 PEM 이 부품까지 도착해 키·인증서 파일 입력이 채워져 있다.
        await app.page.waitForFunction(() => Array.from(document.querySelectorAll('input[type="file"]'))
            .slice(0, 2).every((input) => (input as HTMLInputElement).files?.length === 1), undefined, {timeout: 10_000});
        // 인증서 파일은 비밀값을 담는다. 파일 입력에 채울 뿐 PEM 본문이 화면 글자로 드러나지 않아야 한다.
        expect(await app.page.locator("body").innerText()).not.toContain("-----BEGIN");

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

test("Apply 는 화면의 모든 설정 필드를 저장 요청에 담고 서버가 바꾼 값을 런타임에 적용한다", async () => {
    const app = await startAdminApp();
    try {
        const {serverOption, revision} = await openServerSettings(app.page);
        await waitForApply(app.page, true);

        const adminPort = await getFreePort();
        let port = await getFreePort();
        while(port === adminPort) port = await getFreePort();
        const changed = {
            key: "changed-key-for-save",
            adminPort,
            port,
            globalMemCacheLimit: serverOption.globalMemCacheLimit === 256 ? 257 : 256,
            keepAlive: serverOption.keepAlive === 5000 ? 5001 : 5000,
        };
        await app.page.locator("#input-key").fill(changed.key);
        await app.page.locator("#input-admin-port").fill(String(changed.adminPort));
        await app.page.locator("#input-tunnel-port").fill(String(changed.port));
        await app.page.locator("#input-mem-cache-limit").fill(String(changed.globalMemCacheLimit));
        await app.page.locator("#input-keep-alive").fill(String(changed.keepAlive));
        await waitForApply(app.page, false);

        const saved = app.page.waitForResponse((response) => response.request().method() === "POST"
            && new URL(response.url()).pathname === "/api/serverOption", {timeout: 10_000});
        await app.page.getByRole("button", {name: "Apply", exact: true}).click();
        const response = await saved;

        // 본문 전체를 비교한다. 화면이 받은 설정의 어느 필드든 빠지거나 바뀌면 여기서 드러난다.
        expect(response.request().postDataJSON()).toEqual({...serverOption, ...changed, expectedRevision: revision});
        expect(response.status()).toBe(200);
        expect((await response.json()).success).toBe(true);

        // 화면만 보고 판단하지 않고, 스텁 TTTServer 가 실제로 받은 적용 인자를 필드마다 확인한다.
        const applied = (await app.calls()).filter((call) => call.method === "applyServerOption");
        expect(applied).toHaveLength(1);
        expect(applied[0].args[0]).toMatchObject({
            key: changed.key,
            adminPort: changed.adminPort,
            adminTls: serverOption.adminTls,
            port: changed.port,
            tls: serverOption.tls,
            globalMemCacheLimit: changed.globalMemCacheLimit,
            keepAlive: changed.keepAlive,
        });

        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("Retry 알림 뒤의 알림은 버튼 문구가 OK 로 돌아온다 (옛 _alert 결함을 의도적으로 고친 차이)", async () => {
    const app = await startAdminApp();
    try {
        await openServerSettings(app.page);
        await waitForApply(app.page, true);
        await app.page.locator("#input-keep-alive").fill("4321");
        await waitForApply(app.page, false);

        // 저장 요청 경로에서 예외를 한 번만 일으킨다. 네트워크 실패는 adminRequest 가 실패 객체로 바꾸므로
        // Retry 알림에 이르려면 요청을 만들기 전에 던져야 한다. 첫 호출에서 원래 생성자를 되돌려 둔다.
        await app.page.evaluate(() => {
            const original = window.Headers;
            (window as any).Headers = class {
                constructor() {
                    (window as any).Headers = original;
                    throw new Error("injected failure before the request");
                }
            };
        });
        // Retry 로 다시 보내는 요청은 서버가 거절한 것처럼 돌려준다. 그 실패 알림은 버튼 인자 없이 뜬다.
        await app.page.route("**/api/serverOption", (route) => route.request().method() === "POST"
            ? route.fulfill({status: 400, contentType: "application/json", body: JSON.stringify({success: false, message: "Invalid server option"})})
            : route.continue());

        const dialog = app.page.getByRole("dialog", {name: "Server settings"});
        await app.page.getByRole("button", {name: "Apply", exact: true}).click();
        await dialog.getByText("Unable to connect to the server.", {exact: true}).waitFor({state: "visible", timeout: 10_000});
        await dialog.getByRole("button", {name: "Retry", exact: true}).click();

        await dialog.getByText("Invalid server option", {exact: true}).waitFor({state: "visible", timeout: 10_000});
        // 옛 _alert 는 버튼 인자가 없으면 문구를 갱신하지 않아 여기서 Retry 가 남았다.
        expect(await dialog.getByRole("button", {name: "OK", exact: true}).count()).toBe(1);
        expect(await dialog.getByRole("button", {name: "Retry", exact: true}).count()).toBe(0);

        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);
