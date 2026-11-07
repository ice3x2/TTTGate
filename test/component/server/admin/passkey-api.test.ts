import {AdminSecurityPolicyRegistry} from "../../../../src/server/AdminSecurityPolicy";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {PasskeyLoginChallenges} from "../../../../src/server/passkey/PasskeyLoginChallenges";
import type {Passkey} from "../../../../src/server/passkey/Passkey";
import {SoftAuthenticator} from "../../../helpers/softAuthenticator";
import {ADMIN_PASSWORD, ApiResponse, Auth, MfaFixture, USER_PASSWORD, authOf, withMfaServer} from "./mfaHarness";

// #336 — 패스키 등록·목록·삭제(REQ-4~7), 패스키 로그인(REQ-8~10), 관리자 초기화(REQ-11·12).
// 실제 AdminServer 와 실제 @simplewebauthn/server 검증을 거친다. 응답은 소프트웨어 인증기가 만든다.
jest.setTimeout(60_000);

type Ctx = MfaFixture & {
    local: string;
    /** 패스키를 쓸 수 있는 Origin(http://localhost:<port>)을 붙여 보낸다. */
    call: (method: string, target: string, body?: object, headers?: Record<string, string>) => Promise<ApiResponse>;
    authFor: (username: string, password: string) => Promise<Auth>;
    register: (auth: Auth, authenticator: SoftAuthenticator, password: string, name?: string) => Promise<ApiResponse>;
    passkeyLogin: (authenticator: SoftAuthenticator, overrides?: object) => Promise<ApiResponse>;
};

const withPasskeyServer = (check: (c: Ctx) => Promise<void>, options: {mfaRequiredForSuperusers?: boolean} = {}) => withMfaServer(async (f) => {
    const local = f.origin.replace("127.0.0.1", "localhost");
    const call = (method: string, target: string, body: object = {}, headers: Record<string, string> = {}) =>
        f.request(method, target, body, {Origin: local, ...headers});
    const authFor = async (username: string, password: string): Promise<Auth> => {
        const response = await call("POST", "/api/login", {username, password});
        if(response.status !== 200) throw new Error(`login failed: ${JSON.stringify(response.body)}`);
        return authOf(response);
    };
    const register = async (auth: Auth, authenticator: SoftAuthenticator, password: string, name = "Office PC") => {
        const options = await call("POST", "/api/me/passkeys/options", {password}, auth);
        if(options.status !== 200) return options;
        return call("POST", "/api/me/passkeys", {name, response: authenticator.create(options.body.options)}, auth);
    };
    const passkeyLogin = async (authenticator: SoftAuthenticator, overrides: object = {}) => {
        const options = await call("POST", "/api/login/passkey/options");
        if(options.status !== 200) return options;
        return call("POST", "/api/login/passkey", {response: authenticator.get(options.body.options, overrides)});
    };
    await check({...f, local, call, authFor, register, passkeyLogin});
}, options);

const eventsOf = (c: Ctx, type: string) => c.sink.events.filter((event) => event.type === type);

describe("passkey registration (#336 REQ-4~7)", () => {
    afterEach(() => AdminSecurityPolicyRegistry.reset());

    it("옵션은 비밀번호를 확인한 뒤 RP ID·사용자·필수 설정을 담아 돌려준다", async () => withPasskeyServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        const response = await c.call("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, auth);
        expect(response.status).toBe(200);
        const options = response.body.options;
        expect(options.rp).toEqual({id: "localhost", name: "TTTGate"});
        expect(options.user.name).toBe("alice");
        expect(Buffer.from(options.user.id, "base64url").toString("utf8")).toBe(c.idOf("alice"));
        expect(options.attestation).toBe("none");
        expect(options.authenticatorSelection).toMatchObject({residentKey: "required", userVerification: "required"});
        expect(options.pubKeyCredParams.map((entry: {alg: number}) => entry.alg)).toEqual([-8, -7, -257]);
        expect(Buffer.from(options.challenge, "base64url").length).toBe(32);
        expect(options.excludeCredentials).toEqual([]);
    }));

    it("비밀번호가 틀리면 401 password_incorrect 이고 로그인 실패로 세지 않는다", async () => withPasskeyServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        for(let i = 0; i < 6; i++) {
            const response = await c.call("POST", "/api/me/passkeys/options", {password: "wrong-password"}, auth);
            expect({i, status: response.status, code: response.body.code}).toEqual({i, status: 401, code: "password_incorrect"});
        }
        expect((await c.call("POST", "/api/login", {username: "alice", password: USER_PASSWORD})).status).toBe(200);
    }));

    it("IP 주소 Origin 이나 Origin 없는 요청은 422 passkey_origin_unsupported 다", async () => withPasskeyServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        const ip = await c.request("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, {...auth, Origin: c.origin});
        expect(ip.status).toBe(422);
        expect(ip.body.code).toBe("passkey_origin_unsupported");
        const none = await c.request("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, auth);
        expect(none.status).toBe(422);
        expect(none.body.code).toBe("passkey_origin_unsupported");
    }));

    it("등록하면 목록에 보이고 감사가 남으며, 응답·감사에 공개키가 없다", async () => withPasskeyServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        const authenticator = new SoftAuthenticator(c.local);
        const saved = await c.register(auth, authenticator, USER_PASSWORD, "  Office PC  ");
        expect(saved.status).toBe(200);
        const credentialId = authenticator.credentials[0].id.toString("base64url");
        expect(saved.body.passkey).toEqual({
            id: credentialId, name: "Office PC", rpId: "localhost", createdAt: expect.any(Number), lastUsedAt: null, backedUp: false
        });

        const list = await c.call("GET", "/api/me/passkeys", {}, auth);
        expect(list.status).toBe(200);
        expect(list.body.passkeys).toEqual([saved.body.passkey]);

        const stored = IdentityStore.instance.user(c.idOf("alice"))!.passkeys![0];
        expect(stored.transports).toEqual(["internal", "hybrid"]);
        const registered = eventsOf(c, "passkey_registered");
        expect(registered).toHaveLength(1);
        expect(registered[0]).toMatchObject({outcome: "success", target: {kind: "user", id: c.idOf("alice")},
            detail: {passkeyId: credentialId, name: "Office PC"}});
        const everything = JSON.stringify([saved.body, list.body, c.sink.events]);
        expect(everything).not.toContain(stored.publicKey);
    }));

    it("허용하지 않은 transports 는 저장하지 않는다", async () => withPasskeyServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        const authenticator = new SoftAuthenticator(c.local);
        const options = await c.call("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, auth);
        const response = authenticator.create(options.body.options, {transports: ["usb", "junk", "x".repeat(1000)]});
        expect((await c.call("POST", "/api/me/passkeys", {name: "Key", response}, auth)).status).toBe(200);
        expect(IdentityStore.instance.user(c.idOf("alice"))!.passkeys![0].transports).toEqual(["usb"]);
    }));

    it("동기화되는 패스키는 backedUp 이 true 다", async () => withPasskeyServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        const authenticator = new SoftAuthenticator(c.local);
        const options = await c.call("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, auth);
        const saved = await c.call("POST", "/api/me/passkeys", {name: "iPhone", response: authenticator.create(options.body.options, {backedUp: true})}, auth);
        expect(saved.body.passkey.backedUp).toBe(true);
    }));

    it("이름이 1~64자가 아니면 422 passkey_name_invalid 다", async () => withPasskeyServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        const authenticator = new SoftAuthenticator(c.local);
        const options = await c.call("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, auth);
        const response = authenticator.create(options.body.options);
        for(const name of ["", "   ", "x".repeat(65), 7]) {
            const saved = await c.call("POST", "/api/me/passkeys", {name, response}, auth);
            expect({name, status: saved.status, code: saved.body.code}).toEqual({name, status: 422, code: "passkey_name_invalid"});
        }
    }));

    it("옵션 없이 저장하거나 5분이 지나면 409 passkey_registration_expired 다", async () => withPasskeyServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        const authenticator = new SoftAuthenticator(c.local);
        const fake = authenticator.create({rp: {id: "localhost"}, user: {id: "dQ"}, challenge: "AAAA"});
        const none = await c.call("POST", "/api/me/passkeys", {name: "Key", response: fake}, auth);
        expect(none.status).toBe(409);
        expect(none.body.code).toBe("passkey_registration_expired");

        const options = await c.call("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, auth);
        c.advance(300_001);
        const late = await c.call("POST", "/api/me/passkeys", {name: "Key", response: authenticator.create(options.body.options)}, auth);
        expect(late.status).toBe(409);
        expect(late.body.code).toBe("passkey_registration_expired");
    }));

    it("다시 요청한 옵션이 앞의 옵션을 대신한다", async () => withPasskeyServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        const authenticator = new SoftAuthenticator(c.local);
        const first = await c.call("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, auth);
        await c.call("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, auth);
        const saved = await c.call("POST", "/api/me/passkeys", {name: "Key", response: authenticator.create(first.body.options)}, auth);
        expect(saved.status).toBe(400);
        expect(saved.body.code).toBe("passkey_invalid");
    }));

    it.each([
        ["사용자 확인(UV)이 없으면", {uv: false}],
        ["다른 Origin 에서 만든 응답이면", {origin: "https://evil.example.com"}],
        ["다른 RP ID 로 만든 응답이면", {rpId: "evil.example.com"}],
        ["다른 challenge 면", {challenge: Buffer.alloc(32, 1).toString("base64url")}],
    ])("%s 400 passkey_invalid 이고 대기 값이 지워진다", async (_label, overrides) => withPasskeyServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        const authenticator = new SoftAuthenticator(c.local);
        const options = await c.call("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, auth);
        const bad = await c.call("POST", "/api/me/passkeys", {name: "Key", response: authenticator.create(options.body.options, overrides)}, auth);
        expect(bad.status).toBe(400);
        expect(bad.body.code).toBe("passkey_invalid");
        const retry = await c.call("POST", "/api/me/passkeys", {name: "Key", response: authenticator.create(options.body.options)}, auth);
        expect(retry.body.code).toBe("passkey_registration_expired");
        expect(IdentityStore.instance.user(c.idOf("alice"))!.passkeys).toBeUndefined();
    }));

    it("옵션을 받은 Origin 과 저장 요청의 Origin 이 다르면 400 passkey_invalid 다", async () => withPasskeyServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        const authenticator = new SoftAuthenticator(c.local);
        const options = await c.call("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, auth);
        const response = authenticator.create(options.body.options);
        const other = await c.request("POST", "/api/me/passkeys", {name: "Key", response}, {...auth, Origin: c.origin});
        expect(other.status).toBe(400);
        expect(other.body.code).toBe("passkey_invalid");
    }));

    it("다른 사용자가 이미 등록한 자격증명이면 409 passkey_already_registered 다", async () => withPasskeyServer(async (c) => {
        const alice = await c.authFor("alice", USER_PASSWORD);
        const aliceKey = new SoftAuthenticator(c.local);
        expect((await c.register(alice, aliceKey, USER_PASSWORD)).status).toBe(200);
        const bob = await c.authFor("bob", USER_PASSWORD);
        const options = await c.call("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, bob);
        const response = new SoftAuthenticator(c.local).create(options.body.options, {credentialId: aliceKey.credentials[0].id.toString("base64url")});
        const saved = await c.call("POST", "/api/me/passkeys", {name: "Key", response}, bob);
        expect(saved.status).toBe(409);
        expect(saved.body.code).toBe("passkey_already_registered");
    }));

    it("excludeCredentials 에 같은 RP ID 의 기존 패스키를 담는다", async () => withPasskeyServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        const authenticator = new SoftAuthenticator(c.local);
        await c.register(auth, authenticator, USER_PASSWORD);
        IdentityStore.instance.addPasskey(c.idOf("alice"), {
            id: "other-rp", publicKey: "pk", counter: 0, transports: [], rpId: "admin.example.com", name: "Elsewhere", createdAt: 1, backedUp: false
        });
        const options = await c.call("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, auth);
        expect(options.body.options.excludeCredentials).toEqual([
            {id: authenticator.credentials[0].id.toString("base64url"), type: "public-key", transports: ["internal", "hybrid"]}
        ]);
    }));

    it("20개면 옵션과 저장 모두 409 passkey_limit 다", async () => withPasskeyServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        const authenticator = new SoftAuthenticator(c.local);
        const options = await c.call("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, auth);
        const filler = (i: number): Passkey => ({id: `fill-${i}`, publicKey: "pk", counter: 0, transports: [], rpId: "localhost", name: `K${i}`, createdAt: i, backedUp: false});
        for(let i = 0; i < 20; i++) IdentityStore.instance.addPasskey(c.idOf("alice"), filler(i));
        const saved = await c.call("POST", "/api/me/passkeys", {name: "Key", response: authenticator.create(options.body.options)}, auth);
        expect(saved.status).toBe(409);
        expect(saved.body.code).toBe("passkey_limit");
        const again = await c.call("POST", "/api/me/passkeys/options", {password: USER_PASSWORD}, auth);
        expect(again.status).toBe(409);
        expect(again.body.code).toBe("passkey_limit");
    }));

    it("목록은 등록 시각의 최신 순이다", async () => withPasskeyServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        const authenticator = new SoftAuthenticator(c.local);
        await c.register(auth, authenticator, USER_PASSWORD, "First");
        c.advance(1_000);
        await c.register(auth, authenticator, USER_PASSWORD, "Second");
        const list = await c.call("GET", "/api/me/passkeys", {}, auth);
        expect(list.body.passkeys.map((entry: {name: string}) => entry.name)).toEqual(["Second", "First"]);
    }));

    it("본인 패스키만 지울 수 있고, 지우면 감사가 남으며 세션은 그대로다", async () => withPasskeyServer(async (c) => {
        const alice = await c.authFor("alice", USER_PASSWORD);
        const aliceKey = new SoftAuthenticator(c.local);
        await c.register(alice, aliceKey, USER_PASSWORD);
        const aliceId = aliceKey.credentials[0].id.toString("base64url");
        const bob = await c.authFor("bob", USER_PASSWORD);

        const foreign = await c.call("DELETE", `/api/me/passkeys/${aliceId}`, {}, bob);
        expect(foreign.status).toBe(404);
        expect(foreign.body.code).toBe("passkey_not_found");

        const removed = await c.call("DELETE", `/api/me/passkeys/${aliceId}`, {}, alice);
        expect(removed.status).toBe(200);
        expect((await c.call("GET", "/api/me/passkeys", {}, alice)).body.passkeys).toEqual([]);
        expect(eventsOf(c, "passkey_removed").filter((event) => event.outcome === "success")).toEqual([
            expect.objectContaining({target: {kind: "user", id: c.idOf("alice")}, detail: expect.objectContaining({passkeyId: aliceId, name: "Office PC"})})
        ]);
        expect((await c.call("GET", "/api/me", {}, alice)).status).toBe(200);
    }));

    it("비밀번호 변경 강제 중에는 패스키를 다룰 수 없다", async () => withPasskeyServer(async (c) => {
        const admin = await c.authFor("admin", ADMIN_PASSWORD);
        const reset = await c.call("POST", `/api/users/${c.idOf("alice")}/password-reset`, {temporaryPassword: "temporary-pass-1"}, admin);
        expect(reset.status).toBe(200);
        const auth = await c.authFor("alice", "temporary-pass-1");
        const response = await c.call("POST", "/api/me/passkeys/options", {password: "temporary-pass-1"}, auth);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe("password_change_required");
    }));

    it("슈퍼유저 MFA 등록 강제 중에는 패스키를 다룰 수 없다", async () => withPasskeyServer(async (c) => {
        const auth = await c.authFor("admin", ADMIN_PASSWORD);
        const response = await c.call("POST", "/api/me/passkeys/options", {password: ADMIN_PASSWORD}, auth);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe("mfa_enrollment_required");
    }, {mfaRequiredForSuperusers: true}));
});

describe("passkey login (#336 REQ-8~10)", () => {
    afterEach(() => {
        AdminSecurityPolicyRegistry.reset();
        jest.restoreAllMocks();
    });

    const enrolled = async (c: Ctx, username = "alice", password = USER_PASSWORD): Promise<SoftAuthenticator> => {
        const auth = await c.authFor(username, password);
        const authenticator = new SoftAuthenticator(c.local);
        const saved = await c.register(auth, authenticator, password);
        if(saved.status !== 200) throw new Error(`register failed: ${JSON.stringify(saved.body)}`);
        await c.call("POST", "/api/logout", {}, auth);
        return authenticator;
    };

    it("로그인 옵션은 세션 없이 받고, challenge·rpId·UV 필수·빈 allowCredentials 를 담는다", async () => withPasskeyServer(async (c) => {
        const response = await c.call("POST", "/api/login/passkey/options");
        expect(response.status).toBe(200);
        expect(response.body.options).toMatchObject({rpId: "localhost", userVerification: "required", timeout: 120_000});
        expect(response.body.options.allowCredentials ?? []).toEqual([]);
        expect(Buffer.from(response.body.options.challenge, "base64url").length).toBe(56);
        expect(response.headers["set-cookie"]).toBeUndefined();
    }));

    it("패스키로 로그인하면 TOTP 없이 세션을 받고, 사용 기록과 감사가 남는다", async () => withPasskeyServer(async (c) => {
        const first = await c.authFor("alice", USER_PASSWORD);
        await c.enable(first);
        const authenticator = new SoftAuthenticator(c.local);
        expect((await c.register(first, authenticator, USER_PASSWORD)).status).toBe(200);

        const before = c.now();
        const response = await c.passkeyLogin(authenticator);
        const after = c.now();
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({success: true, user: {username: "alice"}, mustChangePassword: false, mustEnrollMfa: false});
        const auth = authOf(response);
        expect((await c.call("GET", "/api/me", {}, auth)).status).toBe(200);

        const stored = IdentityStore.instance.user(c.idOf("alice"))!.passkeys![0];
        expect(stored.counter).toBe(1);
        expect(stored.lastUsedAt).toBeGreaterThanOrEqual(before);
        expect(stored.lastUsedAt).toBeLessThanOrEqual(after);
        const credentialId = authenticator.credentials[0].id.toString("base64url");
        const success = eventsOf(c, "login_success").at(-1)!;
        expect(success).toMatchObject({target: {kind: "user", id: c.idOf("alice")}, detail: {method: "passkey", passkeyId: credentialId}});
    }));

    it("슈퍼유저 MFA 강제는 기존 규칙대로 세션에 남는다", async () => withPasskeyServer(async (c) => {
        // 등록은 MFA 강제 중에 막히므로, 인증기가 만든 자격증명을 저장소에 바로 넣고 로그인한다.
        const authenticator = new SoftAuthenticator(c.local);
        authenticator.create({rp: {id: "localhost"}, user: {id: Buffer.from(c.idOf("admin")).toString("base64url")}, challenge: "AAAA"});
        const credential = authenticator.credentials[0];
        IdentityStore.instance.addPasskey(c.idOf("admin"), {
            id: credential.id.toString("base64url"), publicKey: Buffer.from(credential.publicKeyCose).toString("base64url"),
            counter: 0, transports: [], rpId: "localhost", name: "Admin key", createdAt: 1, backedUp: false
        });
        const response = await c.passkeyLogin(authenticator);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({user: {username: "admin"}, mustEnrollMfa: true});
    }, {mfaRequiredForSuperusers: true}));

    it("같은 응답을 다시 보내면 401 passkey_invalid(challenge)다", async () => withPasskeyServer(async (c) => {
        const authenticator = await enrolled(c);
        const options = await c.call("POST", "/api/login/passkey/options");
        const response = authenticator.get(options.body.options);
        expect((await c.call("POST", "/api/login/passkey", {response})).status).toBe(200);
        const replay = await c.call("POST", "/api/login/passkey", {response});
        expect(replay.status).toBe(401);
        expect(replay.body.code).toBe("passkey_invalid");
        expect(eventsOf(c, "login_failure").at(-1)).toMatchObject({outcome: "failure", detail: {method: "passkey", reason: "challenge"}});
    }));

    it("150초가 지난 challenge 는 401 이다", async () => withPasskeyServer(async (c) => {
        const authenticator = await enrolled(c);
        const options = await c.call("POST", "/api/login/passkey/options");
        c.advance(150_001);
        const response = await c.call("POST", "/api/login/passkey", {response: authenticator.get(options.body.options)});
        expect(response.status).toBe(401);
        expect(eventsOf(c, "login_failure").at(-1)!.detail).toMatchObject({reason: "challenge"});
    }));

    it.each([
        ["모르는 자격증명", {credentialId: "AAAAAAAAAAAAAAAAAAAAAA"}, "credential"],
        ["사용자 확인(UV) 없음", {uv: false}, "verification"],
        ["서명 변조", {tamperSignature: true}, "verification"],
        ["다른 사용자의 userHandle", {userHandle: Buffer.from("u_someoneelse").toString("base64url")}, "user"],
    ])("%s 이면 401 passkey_invalid(%s)", async (_label, overrides, reason) => withPasskeyServer(async (c) => {
        const authenticator = await enrolled(c);
        const options = await c.call("POST", "/api/login/passkey/options");
        let response;
        if((overrides as {credentialId?: string}).credentialId) {
            const real = authenticator.get(options.body.options);
            response = {...real, id: (overrides as {credentialId: string}).credentialId, rawId: (overrides as {credentialId: string}).credentialId};
        } else {
            response = authenticator.get(options.body.options, overrides);
        }
        const result = await c.call("POST", "/api/login/passkey", {response});
        expect(result.status).toBe(401);
        expect(result.body).toMatchObject({code: "passkey_invalid", message: "The passkey was not accepted."});
        expect(result.headers["set-cookie"]).toBeUndefined();
        expect(eventsOf(c, "login_failure").at(-1)!.detail).toMatchObject({method: "passkey", reason});
    }));

    it("userHandle 이 없어도 로그인한다", async () => withPasskeyServer(async (c) => {
        const authenticator = await enrolled(c);
        expect((await c.passkeyLogin(authenticator, {userHandle: null})).status).toBe(200);
    }));

    it("서명 카운터가 늘지 않으면 401(verification)이다", async () => withPasskeyServer(async (c) => {
        const authenticator = await enrolled(c);
        expect((await c.passkeyLogin(authenticator, {counter: 5})).status).toBe(200);
        const again = await c.passkeyLogin(authenticator, {counter: 5});
        expect(again.status).toBe(401);
        expect(eventsOf(c, "login_failure").at(-1)!.detail).toMatchObject({reason: "verification"});
    }));

    it("비활성 사용자는 401(user)이다", async () => withPasskeyServer(async (c) => {
        const authenticator = await enrolled(c);
        const admin = await c.authFor("admin", ADMIN_PASSWORD);
        expect((await c.call("PUT", `/api/users/${c.idOf("alice")}`, {status: "disabled"}, admin)).status).toBe(200);
        const response = await c.passkeyLogin(authenticator);
        expect(response.status).toBe(401);
        expect(eventsOf(c, "login_failure").at(-1)!.detail).toMatchObject({reason: "user"});
    }));

    it("패스키의 RP ID 가 요청의 RP ID 와 다르면 401(credential)이다", async () => withPasskeyServer(async (c) => {
        const authenticator = await enrolled(c);
        const id = authenticator.credentials[0].id.toString("base64url");
        const stored = IdentityStore.instance.findPasskey(id)!.passkey;
        IdentityStore.instance.removePasskey(c.idOf("alice"), id);
        IdentityStore.instance.addPasskey(c.idOf("alice"), {...stored, rpId: "admin.example.com"});
        const response = await c.passkeyLogin(authenticator);
        expect(response.status).toBe(401);
        expect(eventsOf(c, "login_failure").at(-1)!.detail).toMatchObject({reason: "credential"});
    }));

    it("실패 5번이면 그 버킷은 차단되어 옵션도 429 다", async () => withPasskeyServer(async (c) => {
        const authenticator = await enrolled(c);
        for(let i = 0; i < 5; i++) {
            const response = await c.passkeyLogin(authenticator, {uv: false});
            expect({i, status: response.status}).toEqual({i, status: 401});
        }
        expect((await c.call("POST", "/api/login/passkey/options")).status).toBe(429);
    }), 30_000);

    it("사용 기록을 저장하지 못하면 503 이고 세션을 주지 않으며 실패로 세지 않는다", async () => withPasskeyServer(async (c) => {
        const authenticator = await enrolled(c);
        const spy = jest.spyOn(IdentityStore.instance, "markPasskeyUsed")
            .mockReturnValue({success: false, status: 422, code: "identity_save_failed", message: "identity file could not be saved"});
        for(let i = 0; i < 6; i++) {
            const response = await c.passkeyLogin(authenticator);
            expect({i, status: response.status}).toEqual({i, status: 503});
            expect(response.headers["set-cookie"]).toBeUndefined();
        }
        expect(eventsOf(c, "login_failure").at(-1)!.detail).toMatchObject({method: "passkey", reason: "store"});
        spy.mockRestore();
        expect((await c.passkeyLogin(authenticator)).status).toBe(200);
    }));

    it("IP 주소 Origin 이나 Origin 없는 요청은 422 passkey_origin_unsupported 다", async () => withPasskeyServer(async (c) => {
        const ip = await c.request("POST", "/api/login/passkey/options", {}, {Origin: c.origin});
        expect(ip.status).toBe(422);
        expect(ip.body.code).toBe("passkey_origin_unsupported");
        const none = await c.request("POST", "/api/login/passkey/options", {});
        expect(none.body.code).toBe("passkey_origin_unsupported");
        const verify = await c.request("POST", "/api/login/passkey", {response: {}});
        expect(verify.status).toBe(422);
        expect(verify.body.code).toBe("passkey_origin_unsupported");
    }));

    it("허용하지 않은 Origin 은 기존 검사대로 403 이다", async () => withPasskeyServer(async (c) => {
        const response = await c.request("POST", "/api/login/passkey/options", {}, {Origin: "https://evil.example.com"});
        expect(response.status).toBe(403);
    }));

    it("계정 저장소가 없는 모드(legacy-fallback)에서는 로그인 두 경로 모두 503 passkey_unavailable 이다", async () => withPasskeyServer(async (c) => {
        jest.spyOn(IdentityStore.instance, "mode", "get").mockReturnValue("legacy-fallback");
        const options = await c.call("POST", "/api/login/passkey/options");
        expect(options.status).toBe(503);
        expect(options.body.code).toBe("passkey_unavailable");
        const verify = await c.call("POST", "/api/login/passkey", {response: {}});
        expect(verify.status).toBe(503);
        expect(verify.body.code).toBe("passkey_unavailable");
    }));

    it("사용 목록이 가득 차면 503 passkey_busy 이고, 실패로 세지 않으며 감사도 남기지 않는다", async () => withPasskeyServer(async (c) => {
        const authenticator = await enrolled(c);
        jest.spyOn(PasskeyLoginChallenges.prototype, "consume").mockReturnValue("busy");
        const failuresBefore = eventsOf(c, "login_failure").length;
        for(let i = 0; i < 6; i++) {
            const response = await c.passkeyLogin(authenticator);
            expect({i, status: response.status, code: response.body.code}).toEqual({i, status: 503, code: "passkey_busy"});
        }
        expect(eventsOf(c, "login_failure")).toHaveLength(failuresBefore);
        jest.restoreAllMocks();
        expect((await c.passkeyLogin(authenticator)).status).toBe(200);
    }));

    it("검증하는 사이 패스키가 지워졌으면 401(credential)이다", async () => withPasskeyServer(async (c) => {
        const authenticator = await enrolled(c);
        jest.spyOn(IdentityStore.instance, "markPasskeyUsed")
            .mockReturnValue({success: false, status: 404, code: "passkey_not_found", message: "Passkey not found."});
        const response = await c.passkeyLogin(authenticator);
        expect(response.status).toBe(401);
        expect(eventsOf(c, "login_failure").at(-1)!.detail).toMatchObject({reason: "credential"});
    }));

    it("동시 로그인으로 저장된 카운터가 이미 앞섰으면 401(verification)이다", async () => withPasskeyServer(async (c) => {
        const authenticator = await enrolled(c);
        jest.spyOn(IdentityStore.instance, "markPasskeyUsed")
            .mockReturnValue({success: false, status: 409, code: "passkey_counter_stale", message: "stale"});
        const response = await c.passkeyLogin(authenticator);
        expect(response.status).toBe(401);
        expect(eventsOf(c, "login_failure").at(-1)!.detail).toMatchObject({reason: "verification"});
    }));

    it("부트스트랩 전에는 503 passkey_unavailable 이다", async () => withPasskeyServer(async (c) => {
        jest.spyOn(IdentityMigration, "bootstrapRequired").mockReturnValue(true);
        const response = await c.call("POST", "/api/login/passkey/options");
        expect(response.status).toBe(503);
        expect(response.body.code).toBe("passkey_unavailable");
    }));

    it("CSRF 토큰 없이 부른다(로그인 전 경로)", async () => withPasskeyServer(async (c) => {
        const authenticator = await enrolled(c);
        const options = await c.call("POST", "/api/login/passkey/options", {}, {Cookie: "csrfToken=abc"});
        expect(options.status).toBe(200);
        const response = await c.call("POST", "/api/login/passkey", {response: authenticator.get(options.body.options)}, {Cookie: "csrfToken=abc"});
        expect(response.status).toBe(200);
    }));
});

describe("passkey admin reset (#336 REQ-11·12)", () => {
    afterEach(() => AdminSecurityPolicyRegistry.reset());

    it("관리자는 사용자의 패스키를 모두 지우고 그 사용자의 세션을 끊는다", async () => withPasskeyServer(async (c) => {
        const alice = await c.authFor("alice", USER_PASSWORD);
        const authenticator = new SoftAuthenticator(c.local);
        await c.register(alice, authenticator, USER_PASSWORD, "One");
        await c.register(alice, authenticator, USER_PASSWORD, "Two");
        const admin = await c.authFor("admin", ADMIN_PASSWORD);

        const view = await c.call("GET", `/api/users/${c.idOf("alice")}`, {}, admin);
        expect(view.body.user.passkeyCount).toBe(2);

        const reset = await c.call("POST", `/api/users/${c.idOf("alice")}/passkeys/reset`, {}, admin);
        expect(reset.status).toBe(200);
        expect(reset.body.user.passkeyCount).toBe(0);
        expect(IdentityStore.instance.user(c.idOf("alice"))!.passkeys).toBeUndefined();
        expect((await c.call("GET", "/api/me", {}, alice)).status).toBe(401);
        expect(eventsOf(c, "passkey_reset").filter((event) => event.outcome === "success")).toEqual([
            expect.objectContaining({target: {kind: "user", id: c.idOf("alice")}})
        ]);

        expect((await c.call("POST", `/api/users/${c.idOf("alice")}/passkeys/reset`, {}, admin)).status).toBe(200);
        const missing = await c.call("POST", "/api/users/u_missing/passkeys/reset", {}, admin);
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBe("user_not_found");
    }));

    it("일반 사용자는 초기화할 수 없다", async () => withPasskeyServer(async (c) => {
        const bob = await c.authFor("bob", USER_PASSWORD);
        const response = await c.call("POST", `/api/users/${c.idOf("alice")}/passkeys/reset`, {}, bob);
        expect(response.status).toBe(403);
    }));

    it("사용자 목록의 passkeyCount 는 패스키가 없으면 0 이다", async () => withPasskeyServer(async (c) => {
        const admin = await c.authFor("admin", ADMIN_PASSWORD);
        const list = await c.call("GET", "/api/users", {}, admin);
        expect(list.body.users.every((user: {passkeyCount: number}) => user.passkeyCount === 0)).toBe(true);
    }));
});
