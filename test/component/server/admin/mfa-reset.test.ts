import {ADMIN_PASSWORD, USER_PASSWORD, withMfaServer} from "./mfaHarness";

// U4-08 / #127 — 슈퍼유저가 남의 MFA 를 초기화한다. 대상의 세션은 끊기고 비밀번호만으로 로그인된다.
jest.setTimeout(60_000);

describe("mfa-reset", () => {
    it("초기화하면 MFA 가 꺼지고 대상 세션이 끊기며 비밀번호만으로 로그인된다(멱등)", async () => withMfaServer(async (f) => {
        const alice = await f.login("alice", USER_PASSWORD);
        await f.enable(alice.auth!);
        const admin = await f.login("admin", ADMIN_PASSWORD);
        const aliceId = f.idOf("alice");

        const reset = await f.request("POST", `/api/users/${aliceId}/mfa/reset`, {}, admin.auth!);
        expect(reset.status).toBe(200);
        expect(reset.body.user).toMatchObject({id: aliceId, mfaEnabled: false});
        expect(reset.body.user).not.toHaveProperty("mfa");
        expect((await f.request("GET", "/api/me", {}, alice.auth!)).status).toBe(401);

        const again = await f.login("alice", USER_PASSWORD);
        expect(again.status).toBe(200);
        expect(again.body.mfaRequired).toBeUndefined();
        expect(again.auth).toBeDefined();

        expect((await f.request("POST", `/api/users/${aliceId}/mfa/reset`, {}, admin.auth!)).status).toBe(200);
        const missing = await f.request("POST", "/api/users/u_doesnotexist/mfa/reset", {}, admin.auth!);
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBe("user_not_found");

        const resets = f.sink.events.filter((event) => event.type === "mfa_reset" && event.outcome === "success");
        expect(resets.map((event) => event.target)).toEqual([{kind: "user", id: aliceId}, {kind: "user", id: aliceId}]);
    }));

    it("일반 유저는 초기화할 수 없고, CSRF 헤더가 없으면 403 이다", async () => withMfaServer(async (f) => {
        const alice = await f.login("alice", USER_PASSWORD);
        expect((await f.request("POST", `/api/users/${f.idOf("bob")}/mfa/reset`, {}, alice.auth!)).status).toBe(403);
        const admin = await f.login("admin", ADMIN_PASSWORD);
        expect((await f.request("POST", `/api/users/${f.idOf("bob")}/mfa/reset`, {}, {Cookie: admin.auth!.Cookie})).status).toBe(403);
    }));
});
