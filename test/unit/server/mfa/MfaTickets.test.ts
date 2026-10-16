import {MfaTicketStore, PendingEnrollmentStore} from "../../../../src/server/mfa/MfaTickets";

// U4-04 / #112 — 2단계 로그인 티켓과 등록 대기 저장소. 시계는 주입한다.

const clock = () => {
    let current = 1_757_548_800_000;
    return {now: () => current, advance: (ms: number) => { current += ms; }};
};

describe("MfaTicketStore", () => {
    it("issue 한 티켓은 같은 IP 로 몇 번 peek 해도 남아 있다", () => {
        const c = clock();
        const store = new MfaTicketStore(c.now);
        const ticket = store.issue("u_alice", "10.0.0.1");
        expect(ticket).toMatch(/^[0-9a-f]{64}$/);
        expect(store.peek(ticket, "10.0.0.1")).toEqual({userId: "u_alice", ip: "10.0.0.1", expiresAt: c.now() + 120_000, attempts: 0});
        expect(store.peek(ticket, "10.0.0.1")).toBeDefined();
    });

    it("다른 IP 로 peek 하면 undefined 이고 그 티켓은 지워진다", () => {
        const store = new MfaTicketStore(clock().now);
        const ticket = store.issue("u_alice", "10.0.0.1");
        expect(store.peek(ticket, "10.0.0.2")).toBeUndefined();
        expect(store.peek(ticket, "10.0.0.1")).toBeUndefined();
    });

    it("120초가 지나면 만료된다", () => {
        const c = clock();
        const store = new MfaTicketStore(c.now);
        const ticket = store.issue("u_alice", "10.0.0.1");
        c.advance(119_999);
        expect(store.peek(ticket, "10.0.0.1")).toBeDefined();
        c.advance(1);
        expect(store.peek(ticket, "10.0.0.1")).toBeUndefined();
    });

    it("fail 을 5번 부르면 다섯 번째에 5 를 돌려주고 지워진다", () => {
        const store = new MfaTicketStore(clock().now);
        const ticket = store.issue("u_alice", "10.0.0.1");
        for(let i = 1; i <= 4; i++) {
            expect(store.fail(ticket)).toBe(i);
            expect(store.peek(ticket, "10.0.0.1")?.attempts).toBe(i);
        }
        expect(store.fail(ticket)).toBe(5);
        expect(store.peek(ticket, "10.0.0.1")).toBeUndefined();
    });

    it("fail 은 저장된 항목을 바꾸지 않고 새 객체로 교체한다", () => {
        const store = new MfaTicketStore(clock().now);
        const ticket = store.issue("u_alice", "10.0.0.1");
        const before = store.peek(ticket, "10.0.0.1")!;
        store.fail(ticket);
        expect(before.attempts).toBe(0);
        expect(store.peek(ticket, "10.0.0.1")!.attempts).toBe(1);
    });

    it("같은 사용자로 다시 issue 하면 이전 티켓은 무효가 된다", () => {
        const store = new MfaTicketStore(clock().now);
        const first = store.issue("u_alice", "10.0.0.1");
        const second = store.issue("u_alice", "10.0.0.1");
        expect(second).not.toBe(first);
        expect(store.peek(first, "10.0.0.1")).toBeUndefined();
        expect(store.peek(second, "10.0.0.1")).toBeDefined();
    });

    it("다른 사용자의 티켓은 서로 영향이 없다", () => {
        const store = new MfaTicketStore(clock().now);
        const alice = store.issue("u_alice", "10.0.0.1");
        const bob = store.issue("u_bob", "10.0.0.1");
        expect(store.peek(alice, "10.0.0.1")).toBeDefined();
        expect(store.peek(bob, "10.0.0.1")).toBeDefined();
    });

    it("consume 뒤에는 peek 가 undefined 다", () => {
        const store = new MfaTicketStore(clock().now);
        const ticket = store.issue("u_alice", "10.0.0.1");
        store.consume(ticket);
        expect(store.peek(ticket, "10.0.0.1")).toBeUndefined();
    });

    it("없는 티켓에 fail·consume 을 불러도 던지지 않는다", () => {
        const store = new MfaTicketStore(clock().now);
        expect(store.fail("missing")).toBe(0);
        expect(() => store.consume("missing")).not.toThrow();
        expect(store.peek("missing", "10.0.0.1")).toBeUndefined();
    });

    it("sweep 은 만료된 티켓만 지운다", () => {
        const c = clock();
        const store = new MfaTicketStore(c.now);
        const old = store.issue("u_alice", "10.0.0.1");
        c.advance(60_000);
        const fresh = store.issue("u_bob", "10.0.0.1");
        c.advance(60_000);
        store.sweep();
        expect(store.size).toBe(1);
        expect(store.peek(old, "10.0.0.1")).toBeUndefined();
        expect(store.peek(fresh, "10.0.0.1")).toBeDefined();
    });
});

describe("PendingEnrollmentStore", () => {
    const entry = () => ({secret: Buffer.alloc(20, 1), recoveryCodes: ["aaaa-bbbb"]});

    it("set 한 항목은 300초 동안 남고 그 뒤 만료된다", () => {
        const c = clock();
        const store = new PendingEnrollmentStore(c.now);
        store.set("u_alice", entry());
        expect(store.peek("u_alice")).toEqual({...entry(), expiresAt: c.now() + 300_000, attempts: 0});
        c.advance(299_999);
        expect(store.peek("u_alice")).toBeDefined();
        c.advance(1);
        expect(store.peek("u_alice")).toBeUndefined();
    });

    it("fail 5번 뒤에는 지워진다", () => {
        const store = new PendingEnrollmentStore(clock().now);
        store.set("u_alice", entry());
        for(let i = 1; i <= 4; i++) expect(store.fail("u_alice")).toBe(i);
        expect(store.peek("u_alice")?.attempts).toBe(4);
        expect(store.fail("u_alice")).toBe(5);
        expect(store.peek("u_alice")).toBeUndefined();
    });

    it("다시 set 하면 시도 횟수와 만료가 새로 시작한다", () => {
        const c = clock();
        const store = new PendingEnrollmentStore(c.now);
        store.set("u_alice", entry());
        store.fail("u_alice");
        c.advance(100_000);
        store.set("u_alice", entry());
        expect(store.peek("u_alice")).toMatchObject({attempts: 0, expiresAt: c.now() + 300_000});
    });

    it("consume 과 sweep", () => {
        const c = clock();
        const store = new PendingEnrollmentStore(c.now);
        store.set("u_alice", entry());
        store.consume("u_alice");
        expect(store.peek("u_alice")).toBeUndefined();
        store.set("u_bob", entry());
        c.advance(300_000);
        store.sweep();
        expect(store.size).toBe(0);
        expect(store.fail("u_missing")).toBe(0);
    });
});
