import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {ADMIN_PASSWORD, USER_PASSWORD, withMfaServer} from "./mfaHarness";

// U4-08 / #127 — mfaRequiredForSuperusers 가 켜지면 MFA 없는 슈퍼유저는 등록 전까지 me:* 외 API 가 403 이다.
jest.setTimeout(60_000);

describe("mfa-enforcement", () => {
    it("MFA 없는 슈퍼유저는 mustEnrollMfa 이고 me 계열만 쓰며, 등록하면 재로그인 없이 풀린다", async () => withMfaServer(async (f) => {
        const login = await f.login("admin", ADMIN_PASSWORD);
        expect(login.status).toBe(200);
        expect(login.body.mustEnrollMfa).toBe(true);
        const auth = login.auth!;
        expect((await f.request("GET", "/api/validateSession", {}, auth)).body.mustEnrollMfa).toBe(true);
        const me = await f.request("GET", "/api/me", {}, auth);
        expect(me.status).toBe(200);
        expect(me.body.mustEnrollMfa).toBe(true);

        const users = await f.request("GET", "/api/users", {}, auth);
        expect(users.status).toBe(403);
        expect(users.body).toMatchObject({code: "mfa_enrollment_required", message: "Enable two-factor authentication first."});
        expect((await f.request("GET", "/api/me/sessions", {}, auth)).status).not.toBe(403);
        const password = await f.request("PUT", "/api/me/password", {currentPassword: "wrong", newPassword: "another-password-123"}, auth);
        expect(password.status).not.toBe(403);

        await f.enable(auth);
        expect((await f.request("GET", "/api/users", {}, auth)).status).toBe(200);
        expect((await f.request("GET", "/api/me", {}, auth)).body.mustEnrollMfa).toBe(false);

        // MFA 를 켠 슈퍼유저는 이 옵션에서 해제할 수 없다(#112 의 검사).
        const disable = await f.request("DELETE", "/api/me/mfa", {password: ADMIN_PASSWORD}, auth);
        expect(disable.status).toBe(409);
        expect(disable.body.code).toBe("mfa_required");
    }, {mfaRequiredForSuperusers: true}));

    it("옵션을 켜기 전에 만든 슈퍼유저 세션은 소급해서 잠기지 않는다", async () => withMfaServer(async (f) => {
        const before = await f.login("admin", ADMIN_PASSWORD);
        expect(before.body.mustEnrollMfa).toBe(false);
        const store = ServerOptionStore.instance;
        expect(store.updateServerOption({...store.serverOption, mfaRequiredForSuperusers: true})).toBeTruthy();
        expect((await f.request("GET", "/api/users", {}, before.auth!)).status).toBe(200);
        // 새로 로그인한 세션은 잠긴다.
        const after = await f.login("admin", ADMIN_PASSWORD);
        expect(after.body.mustEnrollMfa).toBe(true);
        expect((await f.request("GET", "/api/users", {}, after.auth!)).status).toBe(403);
    }));

    it("옵션이 켜져도 일반 유저는 영향이 없다", async () => withMfaServer(async (f) => {
        const alice = await f.login("alice", USER_PASSWORD);
        expect(alice.body.mustEnrollMfa).toBe(false);
        expect((await f.request("GET", "/api/tunnelingOption", {}, alice.auth!)).status).toBe(200);
        expect((await f.request("GET", "/api/me", {}, alice.auth!)).body.mustEnrollMfa).toBe(false);
    }, {mfaRequiredForSuperusers: true}));
});
