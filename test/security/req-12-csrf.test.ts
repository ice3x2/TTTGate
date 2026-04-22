/**
 * P5-T4 / REQ-12 — 상태 변경 API CSRF + Origin 검증.
 *
 * Mock 금지: 실 http.request + 실 AdminServer.
 *
 * 2 케이스(+ 보강):
 *  (a) 크로스 오리진 Origin 헤더 + CSRF 토큰 없음 → 403.
 *  (b) 동일 오리진(또는 Origin 없음) + 정상 CSRF double-submit → 허용.
 *  (+) CSRF 쿠키는 있지만 헤더 누락 → 403.
 *  (+) Origin 화이트리스트 외이면 토큰 있어도 403.
 */
import fs from "fs/promises";
import Path from "path";
import AdminServer from "../../src/server/admin/AdminServer";
import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from "../../src/server/admin/SessionStore";
import ServerOptionStore from "../../src/server/ServerOptionStore";
import {AdminSecurityPolicyRegistry} from "../../src/server/AdminSecurityPolicy";
import {httpRequest} from "../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../helpers/runtime";

jest.setTimeout(30_000);

describe("REQ-12 CSRF + Origin guard for state-changing APIs", () => {
    let testRoot: TestRoot;
    let adminServer: AdminServer;
    let port: number;
    let bootstrapToken: string;

    beforeEach(async () => {
        testRoot = await createTestRoot("req-12-csrf");
        applyTestRoot(testRoot.rootDir);
        ServerOptionStore.instance;
        SessionStore.instance;
        adminServer = new AdminServer({} as any, false);
        port = await adminServer.listen(0, "127.0.0.1");
        bootstrapToken = (await fs.readFile(
            Path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME),
            {encoding: "utf-8"}
        )).trim();
    });

    afterEach(async () => {
        await adminServer.close();
        await cleanupTestRoot(testRoot);
    });

    async function bootstrapLogin(): Promise<{ sessionCookie: string, csrfCookie: string, csrfToken: string }> {
        const r = await httpRequest({
            port, path: "/api/login", method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({key: "supersecret1", bootstrapToken})
        });
        expect(r.statusCode).toBe(200);
        const setCookies = r.headers["set-cookie"] as string[];
        expect(Array.isArray(setCookies)).toBe(true);
        const sessionCookie = setCookies.find(c => c.startsWith("sessionKey="))!.split(";")[0];
        const csrfCookie = setCookies.find(c => c.startsWith("csrfToken="))!.split(";")[0];
        const csrfToken = csrfCookie.split("=")[1];
        return {sessionCookie, csrfCookie, csrfToken};
    }

    it("(a) 크로스 오리진 Origin 헤더 + CSRF 토큰 없음 → 403", async () => {
        const {sessionCookie} = await bootstrapLogin();
        const option = ServerOptionStore.instance.serverOption;
        const r = await httpRequest({
            port, path: "/api/serverOption", method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Origin": "http://evil.example.com",
                "cookie": sessionCookie
            },
            body: JSON.stringify(option)
        });
        expect(r.statusCode).toBe(403);
    });

    it("(b) 동일 오리진 + 정상 CSRF double-submit → 200/400 (허용)", async () => {
        const {sessionCookie, csrfCookie, csrfToken} = await bootstrapLogin();
        const option = ServerOptionStore.instance.serverOption;
        const r = await httpRequest({
            port, path: "/api/serverOption", method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Origin": `http://127.0.0.1:${port}`,
                "cookie": `${sessionCookie}; ${csrfCookie}`,
                "x-csrf-token": csrfToken
            },
            body: JSON.stringify(option)
        });
        // 옵션 내용이 동일(변경 없음)일 수도 있고 업데이트 될 수도 있으나, 어쨌든 CSRF 게이트는 통과 — 403 이면 안 됨.
        expect(r.statusCode).not.toBe(403);
        expect([200, 400]).toContain(r.statusCode);
    });

    it("(e) 세션 쿠키 O + CSRF 쿠키/헤더 모두 없음 → 403 (쿠키 탈취 + Origin 생략 우회 차단)", async () => {
        const {sessionCookie} = await bootstrapLogin();
        const option = ServerOptionStore.instance.serverOption;
        const r = await httpRequest({
            port, path: "/api/serverOption", method: "POST",
            headers: {
                "Content-Type": "application/json",
                // Origin 헤더 의도적으로 생략 — 과거엔 non-browser 경로로 위장해 우회 가능.
                "cookie": sessionCookie
                // CSRF 쿠키/헤더 모두 생략.
            },
            body: JSON.stringify(option)
        });
        expect(r.statusCode).toBe(403);
    });

    it("(f) 세션 O + CSRF 쿠키만 있고 헤더 누락 → 403", async () => {
        const {sessionCookie, csrfCookie} = await bootstrapLogin();
        const option = ServerOptionStore.instance.serverOption;
        const r = await httpRequest({
            port, path: "/api/serverOption", method: "POST",
            headers: {
                "Content-Type": "application/json",
                // Origin 없음 + 세션 O + cookieToken 만 존재.
                "cookie": `${sessionCookie}; ${csrfCookie}`
            },
            body: JSON.stringify(option)
        });
        expect(r.statusCode).toBe(403);
    });

    it("(g) allowLegacyAdminHttp + requireCsrfHeader 설정 시 세션 없이 헤더 없음 → 403", async () => {
        AdminSecurityPolicyRegistry.configure({
            allowLegacyAdminHttp: true,
            requireCsrfHeader: true
        });
        // /api/login 은 skipCsrfHeader 라 관계 없으니 다른 상태변경 엔드포인트를 사용.
        // 세션이 없어 최종적으로 401 이 나올 수도 있지만, allowLegacyAdminHttp 경로에서
        // CSRF 헤더를 요구하므로 게이트 단계에서 403 이 먼저 나야 한다.
        const r = await httpRequest({
            port, path: "/api/serverOption", method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({})
        });
        expect(r.statusCode).toBe(403);
    });

    it("(+) CSRF 쿠키는 있지만 헤더 누락 → 403 (브라우저 쿠키 탈취 시나리오)", async () => {
        const {sessionCookie, csrfCookie} = await bootstrapLogin();
        const option = ServerOptionStore.instance.serverOption;
        const r = await httpRequest({
            port, path: "/api/serverOption", method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Origin": `http://127.0.0.1:${port}`,
                "cookie": `${sessionCookie}; ${csrfCookie}`
                // x-csrf-token 헤더 의도적으로 누락.
            },
            body: JSON.stringify(option)
        });
        expect(r.statusCode).toBe(403);
    });

    it("(h) /api/csrfToken GET → 세션 필수 + 새 csrfToken 쿠키 재발급", async () => {
        // 세션 없이 접근 → 401.
        const noAuth = await httpRequest({port, path: "/api/csrfToken"});
        expect(noAuth.statusCode).toBe(401);

        // 세션 있음 → 200 + 새로운 csrfToken 쿠키 발급.
        const {sessionCookie, csrfToken} = await bootstrapLogin();
        const r = await httpRequest({
            port, path: "/api/csrfToken",
            headers: {cookie: sessionCookie}
        });
        expect(r.statusCode).toBe(200);
        const setCookies = r.headers["set-cookie"] as string[];
        expect(Array.isArray(setCookies)).toBe(true);
        const reissued = setCookies.find(c => c.startsWith("csrfToken="))!;
        expect(reissued).toBeDefined();
        const reissuedValue = reissued.split(";")[0].split("=")[1];
        // 재발급 토큰은 기존 토큰과 다른 값이어야 한다.
        expect(reissuedValue.length).toBeGreaterThan(0);
        expect(reissuedValue).not.toBe(csrfToken);
        // 응답 본문에도 동일 토큰 포함.
        const body = JSON.parse(r.body);
        expect(body.csrfToken).toBe(reissuedValue);
    });
});
