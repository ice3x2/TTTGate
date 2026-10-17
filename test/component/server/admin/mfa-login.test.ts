import {AdminSecurityPolicyRegistry} from "../../../../src/server/AdminSecurityPolicy";
import {ADMIN_PASSWORD, USER_PASSWORD, withMfaServer} from "./mfaHarness";

// U4-08 / #127 — 2단계 로그인. MFA 가 켜진 사용자는 비밀번호 뒤 티켓을 받고 /api/login/mfa 로 세션을 받는다.
jest.setTimeout(60_000);

const STEP_MS = 30_000;

describe("mfa-login", () => {
    afterEach(() => AdminSecurityPolicyRegistry.reset());

    it("MFA 가 켜진 사용자는 1단계에서 쿠키 없이 티켓만 받고, 올바른 코드로 세션을 받는다", async () => withMfaServer(async (f) => {
        const first = await f.login("alice", USER_PASSWORD);
        const {secret} = await f.enable(first.auth!);
        expect((await f.request("POST", "/api/logout", {}, first.auth!)).status).toBe(200);
        f.advance(STEP_MS);

        const stepOne = await f.request("POST", "/api/login", {username: "alice", password: USER_PASSWORD});
        expect(stepOne.status).toBe(200);
        expect(stepOne.body).toMatchObject({success: true, mfaRequired: true});
        expect(stepOne.body.mfaTicket).toMatch(/^[0-9a-f]{64}$/);
        expect(stepOne.headers["set-cookie"]).toBeUndefined();
        expect(f.sink.events.filter((event) => event.type === "login_success" && event.target?.id === f.idOf("alice"))).toHaveLength(1);

        const code = f.codeOf(secret);
        const stepTwo = await f.request("POST", "/api/login/mfa", {mfaTicket: stepOne.body.mfaTicket, code});
        expect(stepTwo.status).toBe(200);
        const cookies: string[] = stepTwo.headers["set-cookie"];
        expect(cookies.some((cookie) => cookie.startsWith("sessionKey="))).toBe(true);
        expect(cookies.some((cookie) => cookie.startsWith("csrfToken="))).toBe(true);
        expect(stepTwo.body).toMatchObject({success: true, user: {username: "alice"}, mustChangePassword: false, mustEnrollMfa: false});
        expect(typeof stepTwo.body.csrfToken).toBe("string");
        const auth = {Cookie: cookies.map((c) => c.split(";")[0]).join("; "), "X-CSRF-Token": stepTwo.body.csrfToken};
        expect((await f.request("GET", "/api/me", {}, auth)).status).toBe(200);

        // 같은 코드는 다시 쓸 수 없다.
        const replayTicket = (await f.request("POST", "/api/login", {username: "alice", password: USER_PASSWORD})).body.mfaTicket;
        const replay = await f.request("POST", "/api/login/mfa", {mfaTicket: replayTicket, code});
        expect(replay.status).toBe(401);
        expect(replay.body.code).toBe("mfa_code_invalid");
        f.advance(STEP_MS);
        expect((await f.request("POST", "/api/login/mfa", {mfaTicket: replayTicket, code: f.codeOf(secret)})).status).toBe(200);

        const types = f.sink.events.map((event) => event.type);
        expect(types).toContain("mfa_success");
        expect(types).toContain("mfa_failure");
        expect(JSON.stringify(f.sink.events)).not.toContain(secret);
    }));

    it("틀린 코드 5번은 모두 401 이고 백오프가 걸리며, 여섯 번째는 429 이고 티켓은 소멸한다", async () => withMfaServer(async (f) => {
        const first = await f.login("alice", USER_PASSWORD);
        const {secret} = await f.enable(first.auth!);
        const ticket = (await f.request("POST", "/api/login", {username: "alice", password: USER_PASSWORD})).body.mfaTicket;
        const wrong = f.codeOf(secret) === "000000" ? "111111" : "000000";
        const elapsed: number[] = [];
        for(let i = 0; i < 5; i++) {
            const response = await f.request("POST", "/api/login/mfa", {mfaTicket: ticket, code: wrong});
            expect({i, status: response.status, code: response.body.code}).toEqual({i, status: 401, code: "mfa_code_invalid"});
            elapsed.push(response.elapsedMs);
        }
        expect(elapsed[1] - elapsed[0]).toBeGreaterThanOrEqual(100);
        const blocked = await f.request("POST", "/api/login/mfa", {mfaTicket: ticket, code: f.codeOf(secret)});
        expect(blocked.status).toBe(429);
        expect(blocked.body.message).toBe("Too many login attempts");

        f.advance(61_000);
        // 차단이 풀린 뒤 새로 로그인하지 않고 옛 티켓을 다시 써 본다. 다섯 번째 실패로 티켓이 지워졌어야 한다(TTL 120초 안).
        const reused = await f.request("POST", "/api/login/mfa", {mfaTicket: ticket, code: f.codeOf(secret)});
        expect(reused.status).toBe(401);
        expect(reused.body.code).toBe("mfa_ticket_invalid");
        const fresh = await f.request("POST", "/api/login", {username: "alice", password: USER_PASSWORD});
        expect(fresh.body.mfaRequired).toBe(true);
        const gone = await f.request("POST", "/api/login/mfa", {mfaTicket: ticket, code: f.codeOf(secret)});
        expect(gone.status).toBe(401);
        expect(gone.body).toMatchObject({code: "mfa_ticket_invalid", message: "The sign-in expired. Start again."});
        expect(f.sink.events.filter((event) => event.type === "mfa_failure")).toHaveLength(5);
    }), 30_000);

    it("1단계 로그인은 실패 카운터를 초기화하지 않는다", async () => withMfaServer(async (f) => {
        const first = await f.login("alice", USER_PASSWORD);
        const {secret} = await f.enable(first.auth!);
        const wrong = f.codeOf(secret) === "000000" ? "111111" : "000000";
        let ticket = (await f.request("POST", "/api/login", {username: "alice", password: USER_PASSWORD})).body.mfaTicket;
        for(let i = 0; i < 4; i++) expect((await f.request("POST", "/api/login/mfa", {mfaTicket: ticket, code: wrong})).status).toBe(401);
        // 비밀번호를 아는 사람이 1단계를 다시 해도 백오프가 이어진다.
        ticket = (await f.request("POST", "/api/login", {username: "alice", password: USER_PASSWORD})).body.mfaTicket;
        expect((await f.request("POST", "/api/login/mfa", {mfaTicket: ticket, code: wrong})).status).toBe(401);
        expect((await f.request("POST", "/api/login/mfa", {mfaTicket: ticket, code: f.codeOf(secret)})).status).toBe(429);
    }), 30_000);

    it("성공한 티켓은 다시 쓸 수 없다", async () => withMfaServer(async (f) => {
        const first = await f.login("alice", USER_PASSWORD);
        const {secret, recoveryCodes} = await f.enable(first.auth!);
        f.advance(STEP_MS);
        const ticket = (await f.request("POST", "/api/login", {username: "alice", password: USER_PASSWORD})).body.mfaTicket;
        expect((await f.request("POST", "/api/login/mfa", {mfaTicket: ticket, code: f.codeOf(secret)})).status).toBe(200);
        const reused = await f.request("POST", "/api/login/mfa", {mfaTicket: ticket, recoveryCode: recoveryCodes[0]});
        expect(reused.status).toBe(401);
        expect(reused.body.code).toBe("mfa_ticket_invalid");
    }));

    it("잘못된 티켓도 백오프에 들어가 다섯 번 뒤에는 429 다", async () => withMfaServer(async (f) => {
        for(let i = 0; i < 5; i++) {
            expect((await f.request("POST", "/api/login/mfa", {mfaTicket: `bogus-${i}`, code: "123456"})).body.code).toBe("mfa_ticket_invalid");
        }
        expect((await f.request("POST", "/api/login/mfa", {mfaTicket: "bogus-6", code: "123456"})).status).toBe(429);
    }), 30_000);

    it("1단계 뒤 비활성화된 사용자는 2단계를 통과하지 못한다", async () => withMfaServer(async (f) => {
        const first = await f.login("alice", USER_PASSWORD);
        const {secret} = await f.enable(first.auth!);
        f.advance(STEP_MS);
        const ticket = (await f.request("POST", "/api/login", {username: "alice", password: USER_PASSWORD})).body.mfaTicket;
        const admin = await f.login("admin", ADMIN_PASSWORD);
        expect((await f.request("PUT", `/api/users/${f.idOf("alice")}`, {status: "disabled"}, admin.auth!)).status).toBe(200);
        const denied = await f.request("POST", "/api/login/mfa", {mfaTicket: ticket, code: f.codeOf(secret)});
        expect(denied.status).toBe(401);
        expect(denied.body.code).toBe("mfa_ticket_invalid");
        expect(denied.headers["set-cookie"]).toBeUndefined();
    }));

    it("다른 IP 에서 쓴 티켓은 무효가 되고 원래 IP 로도 쓸 수 없다", async () => withMfaServer(async (f) => {
        AdminSecurityPolicyRegistry.configure({trustXForwardedFor: true});
        const first = await f.login("alice", USER_PASSWORD, {"X-Forwarded-For": "10.1.1.5"});
        const {secret} = await f.enable(first.auth!);
        const ticket = (await f.request("POST", "/api/login", {username: "alice", password: USER_PASSWORD}, {"X-Forwarded-For": "10.1.1.5"})).body.mfaTicket;
        const other = await f.request("POST", "/api/login/mfa", {mfaTicket: ticket, code: f.codeOf(secret)}, {"X-Forwarded-For": "10.9.9.9"});
        expect(other.status).toBe(401);
        expect(other.body.code).toBe("mfa_ticket_invalid");
        const same = await f.request("POST", "/api/login/mfa", {mfaTicket: ticket, code: f.codeOf(secret)}, {"X-Forwarded-For": "10.1.1.5"});
        expect(same.status).toBe(401);
        expect(same.body.code).toBe("mfa_ticket_invalid");
    }));

    it("복구 코드로 로그인하면 하나가 줄고, 같은 코드는 다시 못 쓰며, 대문자·하이픈 없이도 받는다", async () => withMfaServer(async (f) => {
        const first = await f.login("alice", USER_PASSWORD);
        const {recoveryCodes} = await f.enable(first.auth!);
        const ticketOf = async () => (await f.request("POST", "/api/login", {username: "alice", password: USER_PASSWORD})).body.mfaTicket;

        const used = await f.request("POST", "/api/login/mfa", {mfaTicket: await ticketOf(), recoveryCode: recoveryCodes[0]});
        expect(used.status).toBe(200);
        const auth = {Cookie: (used.headers["set-cookie"] as string[]).map((c) => c.split(";")[0]).join("; "), "X-CSRF-Token": used.body.csrfToken};
        expect((await f.request("GET", "/api/me", {}, auth)).body.mfa.recoveryCodesRemaining).toBe(9);

        const again = await f.request("POST", "/api/login/mfa", {mfaTicket: await ticketOf(), recoveryCode: recoveryCodes[0]});
        expect(again.status).toBe(401);
        expect(again.body.code).toBe("mfa_code_invalid");

        const loose = recoveryCodes[1].replace("-", "").toUpperCase();
        expect((await f.request("POST", "/api/login/mfa", {mfaTicket: await ticketOf(), recoveryCode: loose})).status).toBe(200);

        const recovered = f.sink.events.filter((event) => event.type === "mfa_recovery_used");
        expect(recovered.map((event) => event.detail?.remaining)).toEqual([9, 8]);
        const serialized = JSON.stringify(f.sink.events);
        for(const code of recoveryCodes) expect(serialized).not.toContain(code);
    }));

    it("code·recoveryCode 를 둘 다 주거나 둘 다 빼면 422, 티켓 없이 code 만 주면 401 이다", async () => withMfaServer(async (f) => {
        const first = await f.login("alice", USER_PASSWORD);
        await f.enable(first.auth!);
        const ticket = (await f.request("POST", "/api/login", {username: "alice", password: USER_PASSWORD})).body.mfaTicket;
        const both = await f.request("POST", "/api/login/mfa", {mfaTicket: ticket, code: "123456", recoveryCode: "abcd-efgh"});
        expect(both.status).toBe(422);
        expect(both.body.message).toBe("Provide code or recoveryCode");
        expect((await f.request("POST", "/api/login/mfa", {mfaTicket: ticket})).status).toBe(422);
        const noTicket = await f.request("POST", "/api/login/mfa", {code: "123456"});
        expect(noTicket.status).toBe(401);
        expect(noTicket.body.code).toBe("mfa_ticket_invalid");
    }));

    it("/api/login/mfa 는 CSRF 헤더 예외지만 Origin 검사는 받고, 다른 MFA API 는 CSRF 를 받는다", async () => withMfaServer(async (f) => {
        const noCsrf = await f.request("POST", "/api/login/mfa", {mfaTicket: "x", code: "123456"});
        expect(noCsrf.body.message).not.toBe("Missing CSRF token");
        // 브라우저처럼 허용된 Origin 을 붙이고 CSRF 헤더 없이 보내도 403 이 아니다(예외가 실제로 필요한 경로).
        const sameOrigin = await f.request("POST", "/api/login/mfa", {mfaTicket: "x", code: "123456"}, {Origin: f.origin});
        expect(sameOrigin.status).not.toBe(403);
        expect(sameOrigin.body.code).toBe("mfa_ticket_invalid");
        const badOrigin = await f.request("POST", "/api/login/mfa", {mfaTicket: "x", code: "123456"}, {Origin: "https://evil.example"});
        expect(badOrigin.status).toBe(403);
        expect(badOrigin.body.message).toBe("Forbidden origin");

        const admin = await f.login("admin", ADMIN_PASSWORD);
        const enroll = await f.request("POST", "/api/me/mfa/enroll", {}, {Cookie: admin.auth!.Cookie});
        expect(enroll.status).toBe(403);
    }));
});
