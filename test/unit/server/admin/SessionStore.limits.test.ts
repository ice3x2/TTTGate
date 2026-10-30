import SessionStore, {MAX_SESSIONS_PER_USER, MAX_USER_AGENT_LENGTH} from "../../../../src/server/admin/SessionStore";
import {ClockRngProvider} from "../../../../src/util/ClockRng";
import {createFakeClockRng, FakeClockRng} from "../../../helpers/clockRng";

// #250 — 관리 세션 수에 상한을 둔다(사용자별·전체). 넘으면 가장 오래 쓰지 않은 세션부터 끝낸다.
describe("SessionStore limits (#250)", () => {
    let clock: FakeClockRng;
    beforeEach(() => {
        SessionStore.resetForTest();
        clock = createFakeClockRng(1_700_000_000_000, [0.125]);
        ClockRngProvider.configure(clock);
    });
    afterEach(() => { SessionStore.resetForTest(); ClockRngProvider.reset(); });

    const login = async (userId: string, evicted?: string[]) => {
        clock.advance(10);
        return SessionStore.instance.newSession(userId, {ip: "127.0.0.1", onEvicted: (session) => evicted?.push(session.key)});
    };
    const sessionsOf = (userId: string) => SessionStore.instance.listSessions().filter((session) => session.userId === userId);

    // REQ-1 / AC-1
    test("thirty logins of one user leave the twenty most recently used sessions", async () => {
        expect(MAX_SESSIONS_PER_USER).toBe(20);
        const keys: string[] = [];
        const evicted: string[] = [];
        for(let n = 0; n < 30; n++) keys.push(await login("u1", evicted));
        expect(sessionsOf("u1").map((session) => session.key).sort()).toEqual(keys.slice(10).sort());
        expect(evicted.sort()).toEqual(keys.slice(0, 10).sort());
        expect(SessionStore.instance.resolveSession([keys[0]])).toBeUndefined();
    });

    // REQ-1 — "가장 오래 쓰지 않은" 은 마지막 사용 시각으로 본다. 방금 쓴 세션은 남는다.
    test("the least recently used session is the one evicted, not the oldest created", async () => {
        const keys: string[] = [];
        for(let n = 0; n < 20; n++) keys.push(await login("u1"));
        clock.advance(10);
        expect(SessionStore.instance.resolveSession([keys[0]])).toBeDefined();
        const evicted: string[] = [];
        await login("u1", evicted);
        expect(evicted).toEqual([keys[1]]);
        expect(SessionStore.instance.resolveSession([keys[0]])).toBeDefined();
    });

    // REQ-2 / AC-2
    test("the total number of sessions stays within the global limit", async () => {
        SessionStore.instance.configureLimitsForTest({perUser: 20, total: 5});
        const keys: string[] = [];
        for(let n = 0; n < 8; n++) keys.push(await login(`user-${n}`));
        expect(SessionStore.instance.listSessions().length).toBe(5);
        expect(SessionStore.instance.listSessions().map((session) => session.key).sort()).toEqual(keys.slice(3).sort());
    });

    // REQ-2 — 끝낸 이유는 어느 상한이 끝냈는지로 정한다. 전체 상한이 같은 사용자의 세션을 끝내도 total_limit 이다.
    test("onEvicted reports which limit evicted the session", async () => {
        SessionStore.instance.configureLimitsForTest({perUser: 3, total: 3});
        const reasons: string[] = [];
        const record = (session: {userId: string}, reason: string) => reasons.push(`${session.userId}:${reason}`);
        const add = async (userId: string) => { clock.advance(10); await SessionStore.instance.newSession(userId, {ip: "127.0.0.1", onEvicted: record}); };
        await add("u1"); await add("u1"); await add("u1");
        await add("u1");
        expect(reasons).toEqual(["u1:per_user_limit"]);
        await add("u2");
        expect(reasons).toEqual(["u1:per_user_limit", "u1:total_limit"]);
    });

    // REQ-1 — 알림 콜백이 실패해도 로그인(새 세션 생성)은 끝까지 간다.
    test("a throwing onEvicted does not break newSession", async () => {
        SessionStore.instance.configureLimitsForTest({perUser: 1, total: 10});
        await login("u1");
        clock.advance(10);
        const key = await SessionStore.instance.newSession("u1", {ip: "127.0.0.1", onEvicted: () => { throw new Error("audit down"); }});
        expect(sessionsOf("u1").map((session) => session.key)).toEqual([key]);
    });

    test("configureLimitsForTest rejects limits below one", () => {
        expect(() => SessionStore.instance.configureLimitsForTest({perUser: 0, total: 5})).toThrow();
        expect(() => SessionStore.instance.configureLimitsForTest({perUser: 5, total: 0})).toThrow();
    });

    // REQ-3 / AC-3
    test("a long User-Agent is stored truncated", async () => {
        expect(MAX_USER_AGENT_LENGTH).toBe(512);
        await SessionStore.instance.newSession("u1", {ip: "127.0.0.1", userAgent: "a".repeat(8 * 1024)});
        expect(sessionsOf("u1")[0].userAgent).toHaveLength(512);
    });
});
