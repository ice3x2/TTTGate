import {ConcurrencyContext, ConcurrencyLimiter} from "../../../../src/server/security/ConcurrencyLimiter";

// U5-08 / #123 — 그룹 동시 연결 상한. 그룹 g 가 포트 1·2 를 갖고 상한은 3 이다.

type Owner = ReturnType<ConcurrencyContext['ownerOf']>;

const regular: Owner = {userId: "u_alice", groupId: "g", role: "regular"};

const contextOf = (owner: Owner, limit: {value: number}): ConcurrencyContext => ({
    ownerOf: (port) => (port === 1 || port === 2 ? owner : undefined),
    groupAttributes: () => ({max_concurrent_connections: limit.value}),
    portsOfGroup: (groupId) => (groupId === "g" ? [1, 2] : [])
});

const sessionsFrom = (table: Record<number, number>) => (port: number): number => table[port] ?? 0;

describe("ConcurrencyLimiter", () => {
    it("그룹 포트 세션 합이 상한 미만이면 허용, 이르면 concurrency-limit 이다", () => {
        const limit = {value: 3};
        expect(new ConcurrencyLimiter(contextOf(regular, limit), sessionsFrom({1: 2, 2: 0})).decide(1))
            .toEqual({decision: {allowed: true}});
        expect(new ConcurrencyLimiter(contextOf(regular, limit), sessionsFrom({1: 2, 2: 1})).decide(1)).toEqual({
            decision: {allowed: false, reason: "concurrency-limit"},
            denial: {groupId: "g", limit: 3, sessions: 3}
        });
        // 다른 포트의 세션도 같은 그룹이면 합산된다.
        expect(new ConcurrencyLimiter(contextOf(regular, limit), sessionsFrom({1: 0, 2: 3})).decide(1).decision.allowed).toBe(false);
        // 그룹 밖 포트의 세션은 세지 않는다.
        expect(new ConcurrencyLimiter(contextOf(regular, limit), sessionsFrom({1: 1, 2: 1, 3: 50})).decide(1).decision.allowed).toBe(true);
    });

    it("상한 0 은 무제한이다", () => {
        const limiter = new ConcurrencyLimiter(contextOf(regular, {value: 0}), sessionsFrom({1: 100, 2: 0}));
        expect(limiter.decide(1)).toEqual({decision: {allowed: true}});
    });

    it("소유자가 없거나 슈퍼유저면 상한을 적용하지 않는다", () => {
        const sessions = sessionsFrom({1: 100, 2: 100});
        expect(new ConcurrencyLimiter(contextOf(undefined, {value: 3}), sessions).decide(1).decision.allowed).toBe(true);
        const superuser: Owner = {userId: "u_admin", groupId: "g", role: "superuser"};
        expect(new ConcurrencyLimiter(contextOf(superuser, {value: 3}), sessions).decide(1).decision.allowed).toBe(true);
    });

    it("호출 사이에 그룹 속성이 바뀌면 다음 decide 가 새 값을 쓴다(캐시 없음)", () => {
        const limit = {value: 3};
        const limiter = new ConcurrencyLimiter(contextOf(regular, limit), sessionsFrom({1: 2, 2: 1}));
        expect(limiter.decide(1).decision.allowed).toBe(false);
        limit.value = 5;
        expect(limiter.decide(1).decision.allowed).toBe(true);
    });
});
