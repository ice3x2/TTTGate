import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {DEFAULT_GROUP_ID} from "../../../../src/server/rbac/IdentityTypes";
import {SoftAuthenticator} from "../../../helpers/softAuthenticator";
import {ADMIN_PASSWORD, ApiResponse, Auth, MfaFixture, USER_PASSWORD, authOf, withMfaServer} from "./mfaHarness";

// #346 — 그룹별 2단계 인증 강제(mfa_required), 패스키를 2단계 수단으로 인정, 관리자 비밀번호 초기화의 2단계 초기화.
jest.setTimeout(60_000);

type Ctx = MfaFixture & {
    call: (method: string, target: string, body?: object, headers?: Record<string, string>) => Promise<ApiResponse>;
    authFor: (username: string, password: string) => Promise<Auth>;
    /** 로그인한 세션으로 패스키를 등록한다. */
    register: (auth: Auth, password: string) => Promise<{response: ApiResponse; authenticator: SoftAuthenticator}>;
    /** 등록 API 를 거치지 않고 저장소에 패스키를 넣는다(강제 등록 상태와 무관하게 준비할 때). */
    plant: (username: string) => SoftAuthenticator;
    passkeyLogin: (authenticator: SoftAuthenticator) => Promise<ApiResponse>;
    setGroupMfa: (groupId: string, required: boolean) => void;
};

const withGroupMfaServer = (check: (c: Ctx) => Promise<void>, options: {mfaRequiredForSuperusers?: boolean} = {}) => withMfaServer(async (f) => {
    const local = f.origin.replace("127.0.0.1", "localhost");
    const call = (method: string, target: string, body: object = {}, headers: Record<string, string> = {}) =>
        f.request(method, target, body, {Origin: local, ...headers});
    const authFor = async (username: string, password: string): Promise<Auth> => {
        const response = await call("POST", "/api/login", {username, password});
        if(response.status !== 200) throw new Error(`login failed: ${JSON.stringify(response.body)}`);
        return authOf(response);
    };
    const register = async (auth: Auth, password: string) => {
        const authenticator = new SoftAuthenticator(local);
        const options = await call("POST", "/api/me/passkeys/options", {password}, auth);
        if(options.status !== 200) return {response: options, authenticator};
        return {response: await call("POST", "/api/me/passkeys", {name: "Phone", response: authenticator.create(options.body.options)}, auth), authenticator};
    };
    const plant = (username: string): SoftAuthenticator => {
        const authenticator = new SoftAuthenticator(local);
        authenticator.create({rp: {id: "localhost"}, user: {id: Buffer.from(f.idOf(username)).toString("base64url")}, challenge: "AAAA"});
        const credential = authenticator.credentials[0];
        const added = IdentityStore.instance.addPasskey(f.idOf(username), {
            id: credential.id.toString("base64url"), publicKey: Buffer.from(credential.publicKeyCose).toString("base64url"),
            counter: 0, transports: [], rpId: "localhost", name: "Planted", createdAt: 1, backedUp: false
        });
        if(!added.success) throw new Error(`plant failed: ${added.message}`);
        return authenticator;
    };
    const passkeyLogin = async (authenticator: SoftAuthenticator) => {
        const options = await call("POST", "/api/login/passkey/options");
        if(options.status !== 200) return options;
        return call("POST", "/api/login/passkey", {response: authenticator.get(options.body.options)});
    };
    const setGroupMfa = (groupId: string, required: boolean) => {
        const updated = IdentityStore.instance.updateGroup(groupId, {attributes: {mfa_required: required}});
        if(!updated.success) throw new Error(`group update failed: ${updated.message}`);
    };
    await check({...f, call, authFor, register, plant, passkeyLogin, setGroupMfa});
}, options);

const TUNNELS = "/api/tunnelingOption";

describe("#346 그룹 속성 mfa_required", () => {
    it("기본값은 false 이고, 불리언이 아니면 422 다 (FR-1, AC-7)", async () => withGroupMfaServer(async (c) => {
        expect(IdentityStore.instance.group(DEFAULT_GROUP_ID)!.attributes.mfa_required).toBe(false);
        const admin = await c.authFor("admin", ADMIN_PASSWORD);
        const bad = await c.call("PUT", `/api/groups/${DEFAULT_GROUP_ID}`, {attributes: {mfa_required: "yes"}}, admin);
        expect(bad.status).toBe(422);
        const good = await c.call("PUT", `/api/groups/${DEFAULT_GROUP_ID}`, {attributes: {mfa_required: true}}, admin);
        expect(good.status).toBe(200);
        expect(good.body.group.attributes.mfa_required).toBe(true);
    }));
});

describe("#346 강제 등록", () => {
    it("2단계 수단이 없는 강제 대상은 mustEnrollMfa 이고 터널 목록이 403 이며, 패스키를 등록하면 같은 세션에서 풀린다 (AC-1, AC-2, AC-10)", async () =>
        withGroupMfaServer(async (c) => {
            c.setGroupMfa(DEFAULT_GROUP_ID, true);
            const login = await c.call("POST", "/api/login", {username: "alice", password: USER_PASSWORD});
            expect(login.status).toBe(200);
            expect(login.body.mustEnrollMfa).toBe(true);
            const auth = authOf(login);
            const denied = await c.call("GET", TUNNELS, {}, auth);
            expect(denied.status).toBe(403);
            expect(denied.body.code).toBe("mfa_enrollment_required");
            expect((await c.call("GET", "/api/me", {}, auth)).body).toMatchObject({mustEnrollMfa: true, mfaRequired: true});

            const {response} = await c.register(auth, USER_PASSWORD);
            expect(response.status).toBe(200);
            expect((await c.call("GET", TUNNELS, {}, auth)).status).toBe(200);
            expect((await c.call("GET", "/api/me", {}, auth)).body).toMatchObject({mustEnrollMfa: false, mfaRequired: true});
        }));

    it("TOTP 를 등록해도 같은 세션에서 풀린다 (FR-4)", async () => withGroupMfaServer(async (c) => {
        c.setGroupMfa(DEFAULT_GROUP_ID, true);
        const auth = await c.authFor("alice", USER_PASSWORD);
        await c.enable(auth);
        expect((await c.call("GET", TUNNELS, {}, auth)).status).toBe(200);
    }));

    it("로그인 중에 그룹 강제를 켜면 다음 요청부터 막히고, 끄면 다음 요청부터 풀린다 (AC-9, AC-11, FR-7)", async () => withGroupMfaServer(async (c) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        expect((await c.call("GET", TUNNELS, {}, auth)).status).toBe(200);
        c.setGroupMfa(DEFAULT_GROUP_ID, true);
        const denied = await c.call("GET", TUNNELS, {}, auth);
        expect(denied.status).toBe(403);
        expect(denied.body.code).toBe("mfa_enrollment_required");
        c.setGroupMfa(DEFAULT_GROUP_ID, false);
        expect((await c.call("GET", TUNNELS, {}, auth)).status).toBe(200);
    }));

    it("강제 대상이 아니면 지금과 같다", async () => withGroupMfaServer(async (c) => {
        const login = await c.call("POST", "/api/login", {username: "alice", password: USER_PASSWORD});
        expect(login.body.mustEnrollMfa).toBe(false);
        expect((await c.call("GET", "/api/me", {}, authOf(login))).body).toMatchObject({mustEnrollMfa: false, mfaRequired: false});
    }));

    it("비밀번호 강제 변경이 함께 걸리면 비밀번호 변경이 먼저다 (FR-5)", async () => withGroupMfaServer(async (c) => {
        c.setGroupMfa(DEFAULT_GROUP_ID, true);
        const admin = await c.authFor("admin", ADMIN_PASSWORD);
        expect((await c.call("POST", `/api/users/${c.idOf("alice")}/password-reset`, {temporaryPassword: "temporary-pass-1"}, admin)).status).toBe(200);
        const auth = await c.authFor("alice", "temporary-pass-1");
        const enroll = await c.call("POST", "/api/me/mfa/enroll", {}, auth);
        expect(enroll.status).toBe(403);
        expect(enroll.body.code).toBe("password_change_required");
        expect((await c.call("PUT", "/api/me/password", {currentPassword: "temporary-pass-1", newPassword: "brand-new-pass-1"}, auth)).status).toBe(200);
        expect((await c.call("POST", "/api/me/mfa/enroll", {}, auth)).status).toBe(200);
        expect((await c.call("GET", TUNNELS, {}, auth)).body.code).toBe("mfa_enrollment_required");
    }));
});

describe("#346 패스키만 가진 강제 대상", () => {
    it("맞는 비밀번호로는 403 passkey_required 이고 쿠키가 없으며, 패스키로는 강제 등록 없이 들어간다 (AC-3, FR-10a)", async () =>
        withGroupMfaServer(async (c) => {
            const authenticator = c.plant("alice");
            c.setGroupMfa(DEFAULT_GROUP_ID, true);
            const response = await c.call("POST", "/api/login", {username: "alice", password: USER_PASSWORD});
            expect(response.status).toBe(403);
            expect(response.body.code).toBe("passkey_required");
            expect(response.headers["set-cookie"]).toBeUndefined();
            const failure = c.sink.events.filter((event) => event.type === "login_failure").at(-1);
            expect(failure?.detail).toMatchObject({reason: "passkey_required"});
            expect(c.sink.events.some((event) => event.type === "login_success")).toBe(false);

            const wrong = await c.call("POST", "/api/login", {username: "alice", password: "wrong-password-1"});
            expect(wrong.status).toBe(401);

            const passkey = await c.passkeyLogin(authenticator);
            expect(passkey.status).toBe(200);
            expect(passkey.body.mustEnrollMfa).toBe(false);
            expect((await c.call("GET", TUNNELS, {}, authOf(passkey))).status).toBe(200);
        }));

    it("강제 대상이 아니면 패스키만 있어도 비밀번호 로그인이 성공한다 (AC-3a)", async () => withGroupMfaServer(async (c) => {
        c.plant("alice");
        expect((await c.call("POST", "/api/login", {username: "alice", password: USER_PASSWORD})).status).toBe(200);
    }));

    it("마지막 패스키는 지울 수 없고, TOTP 가 있으면 지울 수 있다 (AC-4, FR-6)", async () => withGroupMfaServer(async (c) => {
        const authenticator = c.plant("alice");
        c.setGroupMfa(DEFAULT_GROUP_ID, true);
        const auth = authOf(await c.passkeyLogin(authenticator));
        const id = IdentityStore.instance.user(c.idOf("alice"))!.passkeys![0].id;
        const blocked = await c.call("DELETE", `/api/me/passkeys/${id}`, {}, auth);
        expect(blocked.status).toBe(409);
        expect(blocked.body.code).toBe("mfa_required");
        await c.enable(auth);
        expect((await c.call("DELETE", `/api/me/passkeys/${id}`, {}, auth)).status).toBe(200);
        // 이제 TOTP 가 마지막 수단이다.
        const disable = await c.call("DELETE", "/api/me/mfa", {password: USER_PASSWORD}, auth);
        expect(disable.status).toBe(409);
        expect(disable.body.code).toBe("mfa_required");
    }));
});

describe("#346 슈퍼유저 강제(mfaRequiredForSuperusers)도 같은 규칙", () => {
    it("패스키가 있는 슈퍼유저는 강제 등록 상태가 아니고, TOTP 와 패스키가 함께 있으면 TOTP 를 끌 수 있다 (AC-8)", async () =>
        withGroupMfaServer(async (c) => {
            const authenticator = c.plant("admin");
            const password = await c.call("POST", "/api/login", {username: "admin", password: ADMIN_PASSWORD});
            expect(password.status).toBe(403);
            expect(password.body.code).toBe("passkey_required");
            const login = await c.passkeyLogin(authenticator);
            expect(login.body.mustEnrollMfa).toBe(false);
            const auth = authOf(login);
            expect((await c.call("GET", "/api/users", {}, auth)).status).toBe(200);
            await c.enable(auth);
            expect((await c.call("DELETE", "/api/me/mfa", {password: ADMIN_PASSWORD}, auth)).status).toBe(200);
            const id = IdentityStore.instance.user(c.idOf("admin"))!.passkeys![0].id;
            expect((await c.call("DELETE", `/api/me/passkeys/${id}`, {}, auth)).body.code).toBe("mfa_required");
        }, {mfaRequiredForSuperusers: true}));

    it("강제 등록 중에도 패스키 등록 옵션을 받을 수 있다 (AC-10)", async () => withGroupMfaServer(async (c) => {
        const auth = await c.authFor("admin", ADMIN_PASSWORD);
        expect((await c.call("POST", "/api/me/passkeys/options", {password: ADMIN_PASSWORD}, auth)).status).toBe(200);
    }, {mfaRequiredForSuperusers: true}));
});

describe("#346 관리자 비밀번호 초기화의 resetSecondFactors", () => {
    const prepare = async (c: Ctx) => {
        const auth = await c.authFor("alice", USER_PASSWORD);
        await c.enable(auth);
        c.plant("alice");
        return auth;
    };

    it("true 면 TOTP 와 패스키를 지우고 세션을 끝내며 감사에 남긴다. 다음 로그인은 비밀번호 변경 뒤 2단계 등록이다 (AC-5)", async () =>
        withGroupMfaServer(async (c) => {
            const alice = await prepare(c);
            c.setGroupMfa(DEFAULT_GROUP_ID, true);
            const admin = await c.authFor("admin", ADMIN_PASSWORD);
            const reset = await c.call("POST", `/api/users/${c.idOf("alice")}/password-reset`,
                {temporaryPassword: "temporary-pass-1", resetSecondFactors: true}, admin);
            expect(reset.status).toBe(200);
            const user = IdentityStore.instance.user(c.idOf("alice"))!;
            expect(user.mfa).toBeUndefined();
            expect(user.passkeys ?? []).toEqual([]);
            expect((await c.call("GET", "/api/me", {}, alice)).status).toBe(401);
            const issued = c.sink.events.filter((event) => event.type === "temp_password_issued").at(-1);
            expect(issued?.detail).toMatchObject({secondFactorsReset: true});

            const login = await c.call("POST", "/api/login", {username: "alice", password: "temporary-pass-1"});
            expect(login.status).toBe(200);
            expect(login.body).toMatchObject({mustChangePassword: true, mustEnrollMfa: true});
        }));

    it("false 거나 없으면 2단계 수단을 남긴다 (AC-6)", async () => withGroupMfaServer(async (c) => {
        await prepare(c);
        const admin = await c.authFor("admin", ADMIN_PASSWORD);
        expect((await c.call("POST", `/api/users/${c.idOf("alice")}/password-reset`,
            {temporaryPassword: "temporary-pass-1", resetSecondFactors: false}, admin)).status).toBe(200);
        expect((await c.call("POST", `/api/users/${c.idOf("alice")}/password-reset`, {temporaryPassword: "temporary-pass-2"}, admin)).status).toBe(200);
        const user = IdentityStore.instance.user(c.idOf("alice"))!;
        expect(user.mfa?.enabled).toBe(true);
        expect(user.passkeys).toHaveLength(1);
        const issued = c.sink.events.filter((event) => event.type === "temp_password_issued").at(-1);
        expect(issued?.detail).toMatchObject({secondFactorsReset: false});
    }));

    it("불리언이 아니면 422 이고 아무것도 바꾸지 않는다", async () => withGroupMfaServer(async (c) => {
        await prepare(c);
        const admin = await c.authFor("admin", ADMIN_PASSWORD);
        const response = await c.call("POST", `/api/users/${c.idOf("alice")}/password-reset`,
            {temporaryPassword: "temporary-pass-1", resetSecondFactors: "yes"}, admin);
        expect(response.status).toBe(422);
        expect(IdentityStore.instance.user(c.idOf("alice"))!.mfa?.enabled).toBe(true);
        expect((await c.call("POST", "/api/login", {username: "alice", password: USER_PASSWORD})).status).toBe(200);
    }));

    it("사용자 조회 응답에 mfaRequired 가 있다 (FR-9)", async () => withGroupMfaServer(async (c) => {
        c.setGroupMfa(DEFAULT_GROUP_ID, true);
        const admin = await c.authFor("admin", ADMIN_PASSWORD);
        expect((await c.call("GET", `/api/users/${c.idOf("alice")}`, {}, admin)).body.user.mfaRequired).toBe(true);
        expect((await c.call("GET", `/api/users/${c.idOf("admin")}`, {}, admin)).body.user.mfaRequired).toBe(false);
    }));
});

describe("#346 인증 앱 교체(결정 1: 휴대폰을 잃고 복구 코드로 들어온 TOTP 전용 사용자)", () => {
    it("TOTP 가 켜져 있으면 replace 와 비밀번호로만 다시 등록하고, 새 코드를 확인하는 순간 바뀐다", async () => withGroupMfaServer(async (c) => {
        c.setGroupMfa(DEFAULT_GROUP_ID, true);
        const first = await c.authFor("alice", USER_PASSWORD);
        const old = await c.enable(first);

        const plain = await c.call("POST", "/api/me/mfa/enroll", {}, first);
        expect(plain.status).toBe(409);
        expect(plain.body.code).toBe("mfa_already_enabled");
        const wrong = await c.call("POST", "/api/me/mfa/enroll", {replace: true, password: "wrong-password-1"}, first);
        expect(wrong.status).toBe(401);
        expect(wrong.body.code).toBe("password_incorrect");

        const enrolled = await c.call("POST", "/api/me/mfa/enroll", {replace: true, password: USER_PASSWORD}, first);
        expect(enrolled.status).toBe(200);
        // 확인하기 전에는 기존 인증 앱이 그대로다.
        expect(IdentityStore.instance.user(c.idOf("alice"))!.mfa!.secret).toBe(old.secret);
        const confirmed = await c.call("POST", "/api/me/mfa/confirm", {code: c.codeOf(enrolled.body.secret)}, first);
        expect(confirmed.status).toBe(200);
        const stored = IdentityStore.instance.user(c.idOf("alice"))!.mfa!;
        expect(stored.enabled).toBe(true);
        expect(stored.secret).toBe(enrolled.body.secret);
        const event = c.sink.events.filter((entry) => entry.type === "mfa_enrolled").at(-1);
        expect(event?.detail).toMatchObject({replaced: true});
    }));
});
