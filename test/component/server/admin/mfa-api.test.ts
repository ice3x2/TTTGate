import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import AdminServer from "../../../../src/server/admin/AdminServer";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {AuditEvent, AuditSink, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {ClockRngProvider} from "../../../../src/util/ClockRng";
import {base32Decode} from "../../../../src/server/mfa/Base32";
import {generate, hashRecoveryCode, stepOf} from "../../../../src/server/mfa/Totp";
import {serializeIdentityFixture} from "../../../helpers/identityFixture";
import {getFreePort} from "../../../helpers/network";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot} from "../../../helpers/runtime";

// U4-04 / #112 — 본인 MFA 등록·확인·해제·복구 코드 재발급 API. 실제 AdminServer, 시계는 주입한다.
jest.setTimeout(60_000);

const ADMIN_PASSWORD = "test-password-1234";
const USER_PASSWORD = "user-password-1234";

type ApiResponse = {status: number; headers: any; body: any};
type Auth = {Cookie: string; "X-CSRF-Token": string};
type StubSink = AuditSink & {events: AuditEvent[]};

type Fixture = {
    request: (method: string, target: string, body?: object, auth?: Partial<Auth>) => Promise<ApiResponse>;
    login: (username: string, password: string) => Promise<Auth>;
    now: () => number;
    advance: (ms: number) => void;
    sink: StubSink;
    rootDir: string;
};

const authOf = (response: ApiResponse): Auth => {
    const pairs = (response.headers["set-cookie"] as string[]).map((value) => value.split(";")[0]);
    return {
        Cookie: pairs.join("; "),
        "X-CSRF-Token": pairs.find((value) => value.startsWith("csrfToken="))!.slice("csrfToken=".length)
    };
};

const withMfaServer = async (check: (f: Fixture) => Promise<void>, options: {mfaRequiredForSuperusers?: boolean} = {}): Promise<void> => {
    const root = await createTestRoot("mfa-api");
    let api: AdminServer | undefined;
    let offset = 0;
    const now = (): number => Date.now() + offset;
    try {
        applyTestRoot(root.rootDir);
        ClockRngProvider.configure({now, random: () => Math.random(), secureRandomBytes: (n: number) => crypto.randomBytes(n)});
        await CertificationStore.instance.load();
        const store = ServerOptionStore.instance;
        if(!store.updateServerOption({...store.serverOption, port: await getFreePort(), adminBindHost: "127.0.0.1",
            adminTls: false, tls: false, keepAlive: 0, tunnelingOptions: [], mfaRequiredForSuperusers: options.mfaRequiredForSuperusers === true})) {
            throw new Error("mfa-api fixture: invalid server option");
        }
        await fs.writeFile(path.join(root.rootDir, "config", "identity.yaml"), await serializeIdentityFixture({users: [
            {username: "admin", password: ADMIN_PASSWORD, role: "superuser"},
            {username: "alice", password: USER_PASSWORD, role: "regular"},
            {username: "bob", password: USER_PASSWORD, role: "regular"},
        ]}), "utf8");
        IdentityStore.resetForTest();
        await IdentityMigration.runAtStartup();

        api = new AdminServer(undefined as any, false);
        const port = await api.listen(0, "127.0.0.1");
        const request = async (method: string, target: string, body: object = {}, auth: Partial<Auth> = {}): Promise<ApiResponse> => {
            const bytes = JSON.stringify(body);
            const response = await httpRequest({
                port, path: target, method,
                headers: {"Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bytes)), ...auth} as Record<string, string>,
                body: bytes
            });
            let parsed: any;
            try { parsed = JSON.parse(response.body); } catch { parsed = response.body; }
            return {status: response.statusCode, headers: response.headers, body: parsed};
        };
        const login = async (username: string, password: string): Promise<Auth> => {
            const response = await request("POST", "/api/login", {username, password});
            expect({username, status: response.status}).toEqual({username, status: 200});
            return authOf(response);
        };
        const sink: StubSink = {
            events: [],
            reserve(): boolean { return true; },
            record(event: AuditEvent): Promise<void> { this.events.push(event); return Promise.resolve(); }
        };
        AuditSinkRegistry.set(sink);
        await check({request, login, now, advance: (ms) => { offset += ms; }, sink, rootDir: root.rootDir});
    } finally {
        AuditSinkRegistry.reset();
        try { await api?.close(); } finally { await cleanupTestRoot(root); }
    }
};

/** enroll → 올바른 코드로 confirm 까지 하고 secret 과 복구 코드를 돌려준다. */
const enable = async (f: Fixture, auth: Auth): Promise<{secret: string; recoveryCodes: string[]}> => {
    const enrolled = await f.request("POST", "/api/me/mfa/enroll", {}, auth);
    expect(enrolled.status).toBe(200);
    const confirmed = await f.request("POST", "/api/me/mfa/confirm", {code: generate(base32Decode(enrolled.body.secret)!, f.now())}, auth);
    expect(confirmed.status).toBe(200);
    return {secret: enrolled.body.secret, recoveryCodes: enrolled.body.recoveryCodes};
};

describe("mfa-api", () => {
    let bcryptCostBackup: number;
    beforeAll(() => { bcryptCostBackup = IdentityStore.bcryptCost; IdentityStore.bcryptCost = 4; });
    afterAll(() => { IdentityStore.bcryptCost = bcryptCostBackup; });

    it("enroll → confirm 으로 MFA 가 켜지고 /api/me·사용자 목록에 반영된다", async () => withMfaServer(async (f) => {
        const alice = await f.login("alice", USER_PASSWORD);
        const enrolled = await f.request("POST", "/api/me/mfa/enroll", {}, alice);
        expect(enrolled.status).toBe(200);
        expect(enrolled.body.secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(enrolled.body.otpauthUri).toBe(`otpauth://totp/TTTGate:alice?secret=${enrolled.body.secret}&issuer=TTTGate&algorithm=SHA1&digits=6&period=30`);
        expect(enrolled.body.recoveryCodes).toHaveLength(10);
        expect(new Set(enrolled.body.recoveryCodes).size).toBe(10);

        // confirm 전에는 아직 꺼져 있다.
        expect((await f.request("GET", "/api/me", {}, alice)).body.mfa).toEqual({enabled: false, recoveryCodesRemaining: 0});

        const confirmed = await f.request("POST", "/api/me/mfa/confirm",
            {code: generate(base32Decode(enrolled.body.secret)!, f.now())}, alice);
        expect(confirmed.status).toBe(200);
        expect(confirmed.body.mfa).toEqual({enabled: true, recoveryCodesRemaining: 10});

        const me = await f.request("GET", "/api/me", {}, alice);
        expect(me.body.mfa).toEqual({enabled: true, recoveryCodesRemaining: 10});
        expect(me.body.user.mfaEnabled).toBe(true);
        expect(JSON.stringify(me.body)).not.toContain(enrolled.body.secret);

        const admin = await f.login("admin", ADMIN_PASSWORD);
        const users = (await f.request("GET", "/api/users", {}, admin)).body.users as any[];
        const listedAlice = users.find((user) => user.username === "alice");
        expect(listedAlice.mfaEnabled).toBe(true);
        expect(listedAlice).not.toHaveProperty("mfa");
        expect(users.find((user) => user.username === "bob").mfaEnabled).toBe(false);
        expect(JSON.stringify(users)).not.toContain(enrolled.body.secret);

        // secret 은 identity.yaml 에만 저장된다.
        const stored = YAML.parse(await fs.readFile(path.join(f.rootDir, "config", "identity.yaml"), "utf8"));
        const storedAlice = stored.users.find((user: any) => user.username === "alice");
        expect(storedAlice.mfa).toMatchObject({enabled: true, secret: enrolled.body.secret});
        // confirm 에 쓴 코드의 스텝이 저장되어 같은 코드를 다시 쓸 수 없다(재기동 뒤에도).
        expect([stepOf(f.now()) - 1, stepOf(f.now()), stepOf(f.now()) + 1]).toContain(storedAlice.mfa.lastUsedStep);

        // 성공한 confirm 은 대기 항목을 지운다. 다시 confirm 하면 409 다.
        const second = await f.request("POST", "/api/me/mfa/confirm", {code: generate(base32Decode(enrolled.body.secret)!, f.now())}, alice);
        expect(second.status).toBe(409);
        expect(second.body.code).toBe("mfa_enrollment_expired");

        // 복구 코드를 하나 쓰면 남은 개수가 줄어든다.
        const aliceId = storedAlice.id;
        expect(IdentityStore.instance.consumeRecoveryCode(aliceId, hashRecoveryCode(enrolled.body.recoveryCodes[0], aliceId)).success).toBe(true);
        expect((await f.request("GET", "/api/me", {}, alice)).body.mfa).toEqual({enabled: true, recoveryCodesRemaining: 9});
        expect(storedAlice.mfa.recoveryCodeHashes).toHaveLength(10);
        expect(JSON.stringify(storedAlice.mfa)).not.toContain(enrolled.body.recoveryCodes[0]);
    }));

    it("틀린 코드는 401 이고 pending 이 남아 올바른 코드로 다시 confirm 할 수 있다", async () => withMfaServer(async (f) => {
        const alice = await f.login("alice", USER_PASSWORD);
        const enrolled = await f.request("POST", "/api/me/mfa/enroll", {}, alice);
        const wrong = await f.request("POST", "/api/me/mfa/confirm", {code: "000000"}, alice);
        expect(wrong.status).toBe(401);
        expect(wrong.body.code).toBe("mfa_code_invalid");
        const right = await f.request("POST", "/api/me/mfa/confirm", {code: generate(base32Decode(enrolled.body.secret)!, f.now())}, alice);
        expect(right.status).toBe(200);
    }));

    it("틀린 코드를 5번 보내면 pending 이 지워져 올바른 코드도 409 다", async () => withMfaServer(async (f) => {
        const alice = await f.login("alice", USER_PASSWORD);
        const enrolled = await f.request("POST", "/api/me/mfa/enroll", {}, alice);
        const code = generate(base32Decode(enrolled.body.secret)!, f.now());
        const wrongCode = code === "000000" ? "111111" : "000000";
        for(let i = 0; i < 5; i++) {
            const wrong = await f.request("POST", "/api/me/mfa/confirm", {code: wrongCode}, alice);
            expect({i, status: wrong.status, code: wrong.body.code}).toEqual({i, status: 401, code: "mfa_code_invalid"});
        }
        const expired = await f.request("POST", "/api/me/mfa/confirm", {code}, alice);
        expect(expired.status).toBe(409);
        expect(expired.body.code).toBe("mfa_enrollment_expired");
    }));

    it("pending 이 없거나 301초가 지나면 409 mfa_enrollment_expired 다", async () => withMfaServer(async (f) => {
        const alice = await f.login("alice", USER_PASSWORD);
        const none = await f.request("POST", "/api/me/mfa/confirm", {code: "123456"}, alice);
        expect(none.status).toBe(409);
        expect(none.body.code).toBe("mfa_enrollment_expired");

        const enrolled = await f.request("POST", "/api/me/mfa/enroll", {}, alice);
        f.advance(301_000);
        const late = await f.request("POST", "/api/me/mfa/confirm", {code: generate(base32Decode(enrolled.body.secret)!, f.now())}, alice);
        expect(late.status).toBe(409);
        expect(late.body.code).toBe("mfa_enrollment_expired");
    }));

    it("이미 켜져 있으면 enroll 은 409 mfa_already_enabled 다", async () => withMfaServer(async (f) => {
        const alice = await f.login("alice", USER_PASSWORD);
        await enable(f, alice);
        const again = await f.request("POST", "/api/me/mfa/enroll", {}, alice);
        expect(again.status).toBe(409);
        expect(again.body.code).toBe("mfa_already_enabled");
    }));

    it("복구 코드 재발급은 비밀번호를 확인하고 새 10개를 준다", async () => withMfaServer(async (f) => {
        const alice = await f.login("alice", USER_PASSWORD);
        const {recoveryCodes} = await enable(f, alice);

        const wrong = await f.request("POST", "/api/me/mfa/recovery-codes", {password: "wrong"}, alice);
        expect(wrong.status).toBe(401);
        expect(wrong.body.code).toBe("password_incorrect");

        const issued = await f.request("POST", "/api/me/mfa/recovery-codes", {password: USER_PASSWORD}, alice);
        expect(issued.status).toBe(200);
        expect(issued.body.recoveryCodes).toHaveLength(10);
        expect(issued.body.recoveryCodes.filter((code: string) => recoveryCodes.includes(code))).toEqual([]);
        expect((await f.request("GET", "/api/me", {}, alice)).body.mfa).toEqual({enabled: true, recoveryCodesRemaining: 10});

        const bob = await f.login("bob", USER_PASSWORD);
        const notEnabled = await f.request("POST", "/api/me/mfa/recovery-codes", {password: USER_PASSWORD}, bob);
        expect(notEnabled.status).toBe(409);
        expect(notEnabled.body.code).toBe("mfa_not_enabled");
    }));

    it("DELETE /api/me/mfa 는 비밀번호를 확인하고 MFA 를 끈다", async () => withMfaServer(async (f) => {
        const alice = await f.login("alice", USER_PASSWORD);
        await enable(f, alice);

        const wrong = await f.request("DELETE", "/api/me/mfa", {password: "wrong"}, alice);
        expect(wrong.status).toBe(401);
        expect(wrong.body.code).toBe("password_incorrect");
        expect((await f.request("GET", "/api/me", {}, alice)).body.mfa.enabled).toBe(true);

        const disabled = await f.request("DELETE", "/api/me/mfa", {password: USER_PASSWORD}, alice);
        expect(disabled.status).toBe(200);
        expect(disabled.body.mfa).toEqual({enabled: false, recoveryCodesRemaining: 0});
        expect((await f.request("GET", "/api/me", {}, alice)).body.mfa.enabled).toBe(false);

        const again = await f.request("DELETE", "/api/me/mfa", {password: USER_PASSWORD}, alice);
        expect(again.status).toBe(409);
        expect(again.body.code).toBe("mfa_not_enabled");
    }));

    it("mfaRequiredForSuperusers 이면 슈퍼유저는 해제할 수 없고 일반 유저는 해제할 수 있다", async () => withMfaServer(async (f) => {
        const admin = await f.login("admin", ADMIN_PASSWORD);
        await enable(f, admin);
        // 비밀번호 확인이 먼저다. 틀린 비밀번호로는 정책 상태(mfa_required)를 알려 주지 않는다.
        const wrongPassword = await f.request("DELETE", "/api/me/mfa", {password: "wrong"}, admin);
        expect(wrongPassword.status).toBe(401);
        expect(wrongPassword.body.code).toBe("password_incorrect");
        const blocked = await f.request("DELETE", "/api/me/mfa", {password: ADMIN_PASSWORD}, admin);
        expect(blocked.status).toBe(409);
        expect(blocked.body.code).toBe("mfa_required");
        expect((await f.request("GET", "/api/me", {}, admin)).body.mfa.enabled).toBe(true);

        const alice = await f.login("alice", USER_PASSWORD);
        await enable(f, alice);
        expect((await f.request("DELETE", "/api/me/mfa", {password: USER_PASSWORD}, alice)).status).toBe(200);
    }, {mfaRequiredForSuperusers: true}));

    it("네 경로 모두 CSRF 헤더가 없으면 403, 세션이 없으면 401 이다", async () => withMfaServer(async (f) => {
        const alice = await f.login("alice", USER_PASSWORD);
        const routes: Array<[string, string, object]> = [
            ["POST", "/api/me/mfa/enroll", {}],
            ["POST", "/api/me/mfa/confirm", {code: "123456"}],
            ["POST", "/api/me/mfa/recovery-codes", {password: USER_PASSWORD}],
            ["DELETE", "/api/me/mfa", {password: USER_PASSWORD}],
        ];
        for(const [method, target, body] of routes) {
            expect({target, status: (await f.request(method, target, body, {Cookie: alice.Cookie})).status}).toEqual({target, status: 403});
            expect({target, status: (await f.request(method, target, body)).status}).toEqual({target, status: 401});
        }
    }));

    it("감사는 confirm·재발급·해제만 남고 secret 과 복구 코드 평문이 들어가지 않는다", async () => withMfaServer(async (f) => {
        const alice = await f.login("alice", USER_PASSWORD);
        f.sink.events.length = 0;
        const {secret, recoveryCodes} = await enable(f, alice);
        const issued = await f.request("POST", "/api/me/mfa/recovery-codes", {password: USER_PASSWORD}, alice);
        expect((await f.request("DELETE", "/api/me/mfa", {password: USER_PASSWORD}, alice)).status).toBe(200);

        const types = f.sink.events.map((event) => event.type);
        expect(types).toEqual(["mfa_enrolled", "mfa_recovery_codes_regenerated", "mfa_disabled"]);
        expect(f.sink.events.every((event) => event.target?.kind === "user" && event.outcome === "success")).toBe(true);
        const serialized = JSON.stringify(f.sink.events);
        expect(serialized).not.toContain(secret);
        for(const code of [...recoveryCodes, ...issued.body.recoveryCodes]) {
            expect(serialized).not.toContain(code);
        }
    }));
});
