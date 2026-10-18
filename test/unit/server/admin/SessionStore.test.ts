import fs from "fs";
import Path from "path";
import SessionStore, {DEFAULT_TIMEOUT} from "../../../../src/server/admin/SessionStore";
import {IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {ClockRngProvider} from "../../../../src/util/ClockRng";
import {createFakeClockRng, FakeClockRng} from "../../../helpers/clockRng";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

describe("SessionStore baseline behavior", () => {
    let testRoot: TestRoot;
    let fakeClock: FakeClockRng;

    beforeEach(async () => {
        testRoot = await createTestRoot("session-store");
        applyTestRoot(testRoot.rootDir);
        fakeClock = createFakeClockRng(1_700_000_000_000, [0.125]);
        ClockRngProvider.configure(fakeClock);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    it("persists the first login key and validates issued sessions", async () => {
        await IdentityMigration.runAtStartup();
        const bootstrapToken = fs.readFileSync(
            Path.join(testRoot.rootDir, "config", ".bootstrap-token"),
            {encoding: "utf-8"}
        ).trim();

        const bootstrapResult = await IdentityMigration.completeBootstrap({
            username: "admin",
            password: "supersecret1",
            bootstrapToken
        });
        expect(bootstrapResult.success).toBe(true);
        const user = (bootstrapResult as {success: true; user: {id: string}}).user;

        const store = SessionStore.instance;
        const sessionKey = await store.newSession(user.id, {ip: "127.0.0.1"});

        expect(sessionKey).toMatch(/^[a-f0-9]{128}$/);
        expect(await store.isSessionValid([sessionKey])).toBe(true);
    });

    it("expires sessions when the clock advances past the default timeout", async () => {
        const store = SessionStore.instance;
        const sessionKey = await store.newSession("u_1", {ip: "127.0.0.1"});
        fakeClock.advance(DEFAULT_TIMEOUT + 1);

        expect(store.resolveSession([sessionKey])).toBeUndefined();
        expect(store.listSessions().length).toBe(0);
    });

    it("#143 만료된 세션은 목록·사용자별 종료 수에서 빠지고 sweep 이 맵에서 지운다", async () => {
        SessionStore.resetForTest();
        const store = SessionStore.instance;
        await store.newSession("u_old", {ip: "127.0.0.1"});
        await store.newSession("u_old", {ip: "127.0.0.1"});
        fakeClock.advance(DEFAULT_TIMEOUT + 1);
        const fresh = await store.newSession("u_old", {ip: "127.0.0.1"});

        // resolveSession 을 거치지 않은 만료 세션도 목록에 보이지 않는다.
        expect(store.listSessions().map((session) => session.key)).toEqual([fresh]);
        // 사용자 세션 종료 수에 만료 세션이 섞이지 않는다.
        expect(store.removeSessionsOfUser("u_old", {except: fresh})).toBe(0);

        // 경계: timeout == now 인 세션은 인증에서 거절되므로 목록에도 없다.
        SessionStore.resetForTest();
        const edge = await SessionStore.instance.newSession("u_edge", {ip: "127.0.0.1"});
        fakeClock.advance(DEFAULT_TIMEOUT);
        expect(SessionStore.instance.resolveSession([edge])).toBeUndefined();
        expect(SessionStore.instance.listSessions()).toEqual([]);
        await store.newSession("u_other", {ip: "127.0.0.1"});
        fakeClock.advance(DEFAULT_TIMEOUT + 1);
        store.sweepSession();
        expect((store as any)._sessions.size).toBe(0);
    });

    it("newSession returns a 128-char hex key and records the session metadata", async () => {
        const store = SessionStore.instance;
        const sessionKey = await store.newSession("u_1", {ip: "127.0.0.1"});

        expect(sessionKey).toMatch(/^[a-f0-9]{128}$/);
        const sessions = store.listSessions();
        expect(sessions.length).toBe(1);
        expect(sessions[0]).toMatchObject({userId: "u_1", ip: "127.0.0.1"});
        expect(sessions[0].createdAt).toBe(sessions[0].lastSeenAt);
    });

    it("resolveSession extends lastSeenAt and timeout on access", async () => {
        const store = SessionStore.instance;
        const sessionKey = await store.newSession("u_1", {ip: "127.0.0.1"});

        const resolved = store.resolveSession([sessionKey]);
        expect(resolved?.userId).toBe("u_1");

        fakeClock.advance(60 * 60 * 1000);
        const resolvedAgain = store.resolveSession([sessionKey]);
        expect(resolvedAgain?.lastSeenAt).toBe(fakeClock.now());
        expect(resolvedAgain?.timeout).toBe(fakeClock.now() + DEFAULT_TIMEOUT);
    });

    it("removeSessionsOfUser removes every session of a user except the one excluded", async () => {
        const store = SessionStore.instance;
        const k1 = await store.newSession("u_1", {ip: "127.0.0.1"});
        const k2 = await store.newSession("u_1", {ip: "127.0.0.1"});
        const k3 = await store.newSession("u_1", {ip: "127.0.0.1"});
        const otherKey = await store.newSession("u_2", {ip: "127.0.0.1"});

        const removedCount = store.removeSessionsOfUser("u_1", {except: k2});

        expect(removedCount).toBe(2);
        const remainingKeys = store.listSessions().map((s) => s.key);
        expect(remainingKeys.sort()).toEqual([k2, otherKey].sort());
        void k1;
        void k3;
    });

    it("isSessionValid returns true when at least one supplied key is valid", async () => {
        const store = SessionStore.instance;
        const sessionKey = await store.newSession("u_1", {ip: "127.0.0.1"});

        expect(await store.isSessionValid(["bogus", sessionKey])).toBe(true);
        expect(await store.isSessionValid(["bogus"])).toBe(false);
    });

    it("sessionIdOf hashes a key deterministically into a 16-char hex digest", () => {
        const idA = SessionStore.sessionIdOf("abc");
        const idB = SessionStore.sessionIdOf("abc");
        const idC = SessionStore.sessionIdOf("xyz");

        expect(idA).toMatch(/^[a-f0-9]{16}$/);
        expect(idA).toBe(idB);
        expect(idA).not.toBe(idC);
    });
});

describe("SessionStore.removeSessionById (#113 U4-05)", () => {
    let testRoot: TestRoot;
    let fakeClock: FakeClockRng;

    beforeEach(async () => {
        testRoot = await createTestRoot("session-store-remove-by-id");
        applyTestRoot(testRoot.rootDir);
        fakeClock = createFakeClockRng(1_700_000_000_000, [0.125]);
        ClockRngProvider.configure(fakeClock);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    const threeSessions = async () => {
        const store = SessionStore.instance;
        const k1 = await store.newSession("u1", {ip: "127.0.0.1"});
        const k2 = await store.newSession("u1", {ip: "127.0.0.1"});
        const k3 = await store.newSession("u2", {ip: "127.0.0.1"});
        return {store, k1, k2, k3};
    };

    it("id 로 세션 하나를 지우고 그 세션을 돌려준다", async () => {
        const {store, k1, k2, k3} = await threeSessions();
        const removed = store.removeSessionById(SessionStore.sessionIdOf(k1));
        expect(removed?.key).toBe(k1);
        expect(store.listSessions()).toHaveLength(2);
        expect(store.resolveSession([k1])).toBeUndefined();
        expect(store.resolveSession([k2])?.key).toBe(k2);
        expect(store.resolveSession([k3])?.key).toBe(k3);
    });

    it("없는 id 는 undefined 이고 목록이 변하지 않는다", async () => {
        const {store} = await threeSessions();
        expect(store.removeSessionById("0000000000000000")).toBeUndefined();
        expect(store.removeSessionById("")).toBeUndefined();
        expect(store.listSessions()).toHaveLength(3);
    });

    it("만료된 세션은 undefined 를 돌려준다", async () => {
        const {store, k1} = await threeSessions();
        fakeClock.advance(DEFAULT_TIMEOUT + 1);
        expect(store.removeSessionById(SessionStore.sessionIdOf(k1))).toBeUndefined();
        expect(store.listSessions()).toEqual([]);
    });
});

describe("SessionStore.updateSession (#127 U4-08)", () => {
    let testRoot: TestRoot;
    let fakeClock: FakeClockRng;

    beforeEach(async () => {
        testRoot = await createTestRoot("session-store-update");
        applyTestRoot(testRoot.rootDir);
        fakeClock = createFakeClockRng(1_700_000_000_000, [0.125]);
        ClockRngProvider.configure(fakeClock);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    it("mustEnrollMfa 만 바꾸고 다른 필드는 그대로 둔다", async () => {
        const store = SessionStore.instance;
        const key = await store.newSession("u1", {ip: "10.0.0.7", userAgent: "agent-1", mustEnrollMfa: true});
        const before = store.resolveSession([key])!;
        expect(before.mustEnrollMfa).toBe(true);
        store.updateSession(key, {mustEnrollMfa: false});
        const after = store.resolveSession([key])!;
        expect(after.mustEnrollMfa).toBe(false);
        expect({createdAt: after.createdAt, ip: after.ip, userAgent: after.userAgent, userId: after.userId})
            .toEqual({createdAt: before.createdAt, ip: before.ip, userAgent: before.userAgent, userId: before.userId});
    });

    it("새 세션의 mustEnrollMfa 기본값은 false 이고, 없는 키는 아무 일도 하지 않는다", async () => {
        const store = SessionStore.instance;
        const key = await store.newSession("u1", {ip: "10.0.0.7"});
        expect(store.resolveSession([key])!.mustEnrollMfa).toBe(false);
        expect(() => store.updateSession("missing", {mustEnrollMfa: true})).not.toThrow();
        expect(store.listSessions()).toHaveLength(1);
    });
});
