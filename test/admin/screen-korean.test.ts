import type {Page, Route} from "playwright";
import {startAdminApp, type AdminApp, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {RBAC_IDENTITY_FIXTURE, RBAC_PASSWORDS, RBAC_TRUSTED_CLIENTS, RBAC_USER_IDS} from "../helpers/rbacFixture";

// 이슈 349 — 브라우저 언어가 ko-KR 이면 관리 화면이 한국어로 보인다(AC-1·AC-4·AC-8, 이슈 344 AC-7).
// 그 밖의 언어와 ['en-US', 'ko-KR'] 은 영어다(AC-2). 영어 화면 테스트는 각 화면 테스트 파일이 맡는다(AC-6).
jest.setTimeout(ADMIN_APP_TEST_TIMEOUT_MS);

const UI_WAIT_MS = 10_000;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const button = (page: Page, name: string) => page.getByRole("button", {name, exact: true});
const visible = (page: Page, name: string) => button(page, name).first().waitFor({state: "visible", timeout: UI_WAIT_MS});
const heading = (page: Page, text: string) =>
    page.locator("header h1").filter({hasText: new RegExp(`^${escapeRegExp(text)}$`)}).waitFor({state: "visible", timeout: UI_WAIT_MS});

/** 두 언어에서 같게 쓰는 고유 이름과 약어. 한국어 화면에 남아도 되는 영어는 이것뿐이다. */
const PROPER_NOUNS = ["TTTGate", "IPv4", "IPv6", "IP", "TLS", "HTTPS", "HTTP", "TCP", "UDP", "CIDR", "ID", "URL", "API", "CSRF", "TOTP", "MFA", "PEM", "JSON",
    "CPU", "RAM", "OS", "QR", "CA", "CORS", "KiB", "MiB", "GiB", "TiB"];

/** 화면에 보이는 데이터(사용자·그룹·클라이언트 이름). 문구가 아니므로 검사에서 뺀다. */
const DATA_NAMES = [
    ...RBAC_IDENTITY_FIXTURE.users.flatMap((user) => [user.username, user.displayName ?? ""]),
    ...(RBAC_IDENTITY_FIXTURE.groups ?? []).map((group) => group.name), "Default",
    ...RBAC_TRUSTED_CLIENTS.flatMap((client) => [client.clientId, client.displayName]),
].filter((name) => name !== "").sort((a, b) => b.length - a.length);

/** 고유 이름과 데이터를 지우고도 남는 세 글자 이상의 영어 낱말. */
const englishLeft = (text: string): string[] => {
    let rest = text;
    for(const name of DATA_NAMES) rest = rest.split(name).join(" ");
    for(const word of PROPER_NOUNS) rest = rest.replace(new RegExp(`\\b${word}\\b`, "g"), " ");
    return rest.match(/[A-Za-z]{3,}/g) ?? [];
};

/** 검토 M-3: 화면에 보이는 제목과 모든 버튼의 이름이 한국어인지 본다. 버튼 이름은 aria-label 이 있으면 그것, 없으면 보이는 글자다. */
const expectKorean = async (page: Page, where: string): Promise<void> => {
    const names = await page.evaluate(() => {
        const shown = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
        return [...document.querySelectorAll("header h1, h2, h3, legend, button, [role=button]")].filter(shown)
            .map((element) => (element.getAttribute("aria-label") ?? (element as HTMLElement).innerText ?? "").trim())
            .filter((name) => name !== "");
    });
    expect({where, english: names.filter((name) => englishLeft(name).length > 0)}).toEqual({where, english: []});
};

/** 해시로 화면을 옮기고 그 화면의 한국어 제목을 기다린 뒤, 보이는 제목과 버튼이 모두 한국어인지 본다. */
const open = async (page: Page, hash: string, title: string): Promise<void> => {
    await page.evaluate((value) => { location.hash = value; }, hash);
    await heading(page, title);
    await expectKorean(page, hash);
};

const withApp = async (options: Parameters<typeof startAdminApp>[0], check: (app: AdminApp) => Promise<void>): Promise<void> => {
    const app = await startAdminApp(options);
    try {
        await check(app);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
};

const signIn = async (page: Page, username: string, password: string): Promise<void> => {
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await button(page, "확인").click();
    await page.waitForFunction(() => !document.querySelector("#login-password") && document.querySelector("header h1"), undefined, {timeout: UI_WAIT_MS});
};

const fulfillJson = (route: Route, status: number, body: unknown) =>
    route.fulfill({status, contentType: "application/json", body: JSON.stringify(body)});

test("AC-1 ko-KR 에서 로그인부터 모든 화면의 제목과 버튼이 한국어다", () => withApp({fixture: "rbac", locale: "ko-KR", login: false}, async ({page}) => {
    // 로그인
    await page.locator("#login-password").waitFor({state: "visible", timeout: UI_WAIT_MS});
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("ko");
    expect(await page.locator(".login-title").textContent()).toBe("로그인");
    expect(await page.locator('label[for="login-username"]').textContent()).toContain("사용자 이름");
    await visible(page, "확인");
    await expectKorean(page, "login");
    await signIn(page, "admin", RBAC_PASSWORDS.admin);

    // 터널 목록. 이슈 344 AC-7: 남은 시간과 종료 시각도 한국어다.
    await heading(page, "터널");
    await visible(page, "터널 추가");
    await expectKorean(page, "#/tunnels");
    const time = page.locator('li[data-port="20001"] .tunnel-time');
    await time.waitFor({state: "visible", timeout: UI_WAIT_MS});
    expect(await time.textContent()).toMatch(/^\d+분 \d{2}초 남음 · (\d+월 \d+일 )?\d{2}:\d{2} 종료$/);

    // 드로어
    await button(page, "메뉴 열기").click();
    const drawer = page.locator('[role=dialog][aria-label="메뉴"]');
    await drawer.waitFor({state: "visible", timeout: UI_WAIT_MS});
    expect(await drawer.locator(".drawer-item").allTextContents())
        .toEqual(["터널", "상태", "서버 설정", "신뢰 클라이언트", "사용자", "그룹", "보안", "감사 로그", "세션", "내 계정"]);
    expect(await drawer.getByRole("button", {name: "로그아웃", exact: true}).count()).toBe(1);
    await expectKorean(page, "drawer");
    await page.keyboard.press("Escape");
    await drawer.waitFor({state: "detached", timeout: UI_WAIT_MS});

    // 상태와 시스템 정보 팝업
    await open(page, "#/status", "상태");
    await button(page, "정보").click();
    const sysinfo = page.getByRole("dialog", {name: "시스템 정보"});
    await sysinfo.waitFor({state: "visible", timeout: UI_WAIT_MS});
    expect(await sysinfo.locator("h3").allTextContents()).toEqual(["하드웨어 정보", "OS 정보", "네트워크"]);
    await expectKorean(page, "sysinfo");
    // 내부 인터페이스 여부는 true·false 대신 예·아니요다.
    expect(await sysinfo.locator("dt", {hasText: /^내부$/}).first().locator("xpath=following-sibling::dd[1]").textContent()).toMatch(/^(예|아니요)$/);
    await sysinfo.getByRole("button", {name: "확인", exact: true}).click();
    await sysinfo.waitFor({state: "detached", timeout: UI_WAIT_MS});

    // 터널 편집
    await open(page, "#/tunnels/20001", "터널 20001");
    await visible(page, "적용하고 다시 시작");
    await visible(page, "멈추고 삭제");
    await visible(page, "소유자 변경");
    await open(page, "#/tunnels/new", "새 터널");
    await visible(page, "시작");

    // 내 계정·비밀번호 변경·세션·감사
    await open(page, "#/me", "내 계정");
    await visible(page, "비밀번호 변경");
    await visible(page, "다른 기기에서 로그아웃");
    await open(page, "#/me/password", "비밀번호 변경");
    await visible(page, "비밀번호 변경");
    await open(page, "#/sessions", "세션");
    await visible(page, "이 사용자의 세션 모두 끝내기");
    await open(page, "#/audit", "감사 로그");
    expect(await page.locator('label[for="audit-filter-type"]').textContent()).toContain("종류");

    // 사용자 목록·편집, 그룹 목록·편집
    await open(page, "#/users", "사용자");
    await visible(page, "사용자 추가");
    await open(page, `#/users/${RBAC_USER_IDS.alice}`, "사용자");
    await visible(page, "비밀번호 초기화");
    await visible(page, "삭제");
    await visible(page, "저장");
    await open(page, "#/users/new", "새 사용자");
    await visible(page, "사용자 만들기");
    await open(page, "#/groups", "그룹");
    await visible(page, "그룹 추가");
    await open(page, "#/groups/default", "그룹");
    await visible(page, "저장");
    await open(page, "#/groups/new", "새 그룹");
    await visible(page, "그룹 만들기");

    // 보안·신뢰 클라이언트·서버 설정
    await open(page, "#/security", "보안");
    await visible(page, "차단");
    await open(page, "#/clients", "신뢰 클라이언트");
    await visible(page, "클라이언트 추가");
    await open(page, "#/server", "서버 설정");
    await visible(page, "적용");
    await visible(page, "원래대로");
}));

test("AC-1 ko-KR 에서 접근 거부 화면이 한국어다", () => withApp({fixture: "rbac", locale: "ko-KR", login: false}, async ({page}) => {
    await page.locator("#login-password").waitFor({state: "visible", timeout: UI_WAIT_MS});
    await signIn(page, "carol", RBAC_PASSWORDS.carol);
    await page.evaluate(() => { location.hash = "#/users"; });
    await page.waitForFunction(() => location.hash === "#/denied", undefined, {timeout: UI_WAIT_MS});
    await heading(page, "접근 권한 없음");
    await expectKorean(page, "#/denied");
    expect(await page.locator("#denied-message").textContent()).toBe("이 페이지에 접근할 권한이 없습니다.");
    await visible(page, "내 터널로 가기");
}));

test("AC-1 ko-KR 에서 임시 비밀번호로 들어온 사용자의 비밀번호 변경 화면이 한국어다", () => withApp({fixture: "rbac", locale: "ko-KR", login: false}, async ({page}) => {
    await page.locator("#login-password").waitFor({state: "visible", timeout: UI_WAIT_MS});
    await signIn(page, "dave", RBAC_PASSWORDS.dave);
    await heading(page, "비밀번호 변경");
    await expectKorean(page, "forced password change");
    expect(await page.locator("#pw-forced-note").textContent()).toBe("계속하려면 새 비밀번호를 정하세요.");
    await visible(page, "비밀번호 변경");
    await visible(page, "로그아웃");
}));

test("AC-4 ko-KR 에서 port_not_allowed 는 한국어 문구, 번역 맵에 없는 code 는 서버 문구다", () => withApp({fixture: "rbac", locale: "ko-KR", login: false}, async ({page}) => {
    await page.locator("#login-password").waitFor({state: "visible", timeout: UI_WAIT_MS});
    await signIn(page, "carol", RBAC_PASSWORDS.carol);
    await open(page, "#/tunnels/new", "새 터널");
    await page.locator("#input-external-port").fill("25000");
    await page.locator("#input-destination-host").fill("127.0.0.1");
    await page.locator("#input-destination-port").fill("9000");
    await button(page, "시작").click();
    await page.getByText("터널 설정을 적용하지 못했습니다: 이 포트는 그룹에 허용된 범위 밖에 있습니다.", {exact: true})
        .waitFor({state: "visible", timeout: UI_WAIT_MS});

    // 서버가 화면보다 새 버전이라 화면이 모르는 code 를 보낸 경우다.
    await page.route((url) => url.pathname === "/api/tunnelingOption", async (route) => {
        if(route.request().method() !== "POST") return route.fallback();
        await fulfillJson(route, 422, {success: false, code: "brand_new_code", message: "The server said no."});
    });
    await button(page, "시작").click();
    await page.getByText("터널 설정을 적용하지 못했습니다: The server said no.", {exact: true}).waitFor({state: "visible", timeout: UI_WAIT_MS});
}));

test("AC-8 ko-KR 감사 화면은 이벤트 이름을 한국어로, 코드 값을 함께 보이고 모르는 코드는 코드 값만 보인다", () =>
    withApp({fixture: "rbac", locale: "ko-KR", login: false}, async ({page}) => {
        const at = Date.now();
        const event = (type: string) => ({at, actor: {userId: RBAC_USER_IDS.admin, username: "admin"}, type, outcome: "success", summary: `${type} summary`});
        await page.route((url) => url.pathname === "/api/audit/types", (route) => fulfillJson(route, 200, {success: true, types: ["tunnel_activated", "brand_new_event"]}));
        await page.route((url) => url.pathname === "/api/audit", (route) =>
            fulfillJson(route, 200, {success: true, events: [event("tunnel_activated"), event("brand_new_event")]}));
        await page.locator("#login-password").waitFor({state: "visible", timeout: UI_WAIT_MS});
        await signIn(page, "admin", RBAC_PASSWORDS.admin);
        await open(page, "#/audit", "감사 로그");

        const known = page.locator('#audit-list .audit-event[data-type="tunnel_activated"]');
        await known.waitFor({state: "visible", timeout: UI_WAIT_MS});
        expect(await known.locator(".audit-type-name").textContent()).toBe("터널 켜짐");
        expect(await known.locator(".audit-type-code").textContent()).toBe("tunnel_activated");
        expect((await known.locator(".badge").textContent())?.trim()).toBe("성공");
        // 저장된 요약은 번역하지 않는다.
        expect(await known.locator(".audit-summary").textContent()).toBe("tunnel_activated summary");

        const unknown = page.locator('#audit-list .audit-event[data-type="brand_new_event"]');
        expect(await unknown.locator(".audit-type-name").count()).toBe(0);
        expect(await unknown.locator(".audit-type-code").textContent()).toBe("brand_new_event");

        const options = await page.locator("#audit-filter-type option").evaluateAll((items) =>
            items.map((item) => ({value: (item as HTMLOptionElement).value, label: item.textContent?.trim()})));
        expect(options).toEqual([
            {value: "", label: "모든 종류"},
            {value: "tunnel_activated", label: "터널 켜짐 (tunnel_activated)"},
            {value: "brand_new_event", label: "brand_new_event"},
        ]);
    }));

test("AC-2 en-US·ja-JP·fr 과 ['en-US', 'ko-KR'] 은 영어이고, ['ko-KR'] 만 한국어다", () => withApp({fixture: "rbac", login: false}, async ({page}) => {
    // 브라우저 문맥의 언어는 하나만 정할 수 있으므로 navigator.languages 를 페이지 스크립트보다 먼저 덮는다.
    await page.addInitScript(() => {
        const raw = sessionStorage.getItem("test.languages");
        if(!raw) return;
        const languages = JSON.parse(raw) as string[];
        Object.defineProperty(Navigator.prototype, "languages", {get: () => languages, configurable: true});
        Object.defineProperty(Navigator.prototype, "language", {get: () => languages[0], configurable: true});
    });
    const signInTitle = async (languages: string[]): Promise<{lang: string; title: string | null}> => {
        await page.evaluate((value) => sessionStorage.setItem("test.languages", JSON.stringify(value)), languages);
        await page.reload();
        await page.locator(".login-title").waitFor({state: "visible", timeout: UI_WAIT_MS});
        return {lang: await page.evaluate(() => document.documentElement.lang), title: await page.locator(".login-title").textContent()};
    };
    for(const languages of [["en-US"], ["ja-JP"], ["fr"], ["en-US", "ko-KR"]]) {
        expect({languages, ...(await signInTitle(languages))}).toEqual({languages, lang: "en", title: "Sign in"});
    }
    // 덮어쓰기가 실제로 먹는지 확인한다. 한국어가 첫 값이면 한국어다.
    expect(await signInTitle(["ko-KR", "en-US"])).toEqual({lang: "ko", title: "로그인"});
}));
