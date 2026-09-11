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
