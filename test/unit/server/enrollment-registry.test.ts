import {EnrollmentRegistry, MAX_ENROLLMENT_FAILURES} from "../../../src/server/EnrollmentRegistry";
import {deriveEnrollmentKeys} from "../../../src/commons/Enrollment";

// #212 REQ-4·REQ-7: 1회용·만료·재발급 무효화·해시만 저장·주소별 실패 제한
describe("EnrollmentRegistry", () => {
    let now = 1_000_000;
    const clock = () => now;

    test("a code is taken once, by its lookup value, before it expires", async () => {
        const registry = new EnrollmentRegistry(clock);
        const issued = await registry.issue("edge");
        expect(issued.expiresAt).toBe(now + 15 * 60_000);
        const keys = await deriveEnrollmentKeys(issued.code);
        const taken = registry.take(keys.lookup, "10.0.0.1");
        expect(taken).toEqual({ok: true, clientId: "edge", keys: {lookup: keys.lookup, key: keys.key}});
        expect(registry.take(keys.lookup, "10.0.0.1")).toEqual({ok: false, reason: "rejected"});
    });

    test("an expired code is rejected, and the lifetime is capped at 30 days", async () => {
        const registry = new EnrollmentRegistry(clock);
        const short = await registry.issue("edge", 60_000);
        const keys = await deriveEnrollmentKeys(short.code);
        now += 60_001;
        expect(registry.take(keys.lookup, "10.0.0.1")).toEqual({ok: false, reason: "rejected"});
        expect((await registry.issue("edge", 60 * 24 * 3600_000)).expiresAt).toBe(now + 30 * 24 * 3600_000);
    });

    // #313: null 은 만료 없음이다. 쓰이거나, 새로 발급하거나, 클라이언트를 지울 때까지 유효하다.
    test("a code without expiry stays valid over time until it is used, replaced or revoked", async () => {
        const registry = new EnrollmentRegistry(clock);
        const never = await registry.issue("edge", null);
        expect(never.expiresAt).toBeNull();
        now += 365 * 24 * 3600_000;
        const keys = await deriveEnrollmentKeys(never.code);
        expect(registry.take(keys.lookup, "10.0.0.1").ok).toBe(true);

        const replaced = await deriveEnrollmentKeys((await registry.issue("edge", null)).code);
        await registry.issue("edge", null);
        expect(registry.take(replaced.lookup, "10.0.0.1").ok).toBe(false);

        const revoked = await deriveEnrollmentKeys((await registry.issue("other", null)).code);
        registry.revokeClient("other");
        expect(registry.take(revoked.lookup, "10.0.0.1").ok).toBe(false);
    });

    // 실패한 take 는 만료된 코드를 지운다. 만료 없는 코드(null)는 지우지 않아야 한다(null <= now 는 참이라 쉽게 틀린다).
    test("pruning after a failed take keeps codes without expiry, and revokeAll drops them", async () => {
        const registry = new EnrollmentRegistry(clock);
        const kept = await deriveEnrollmentKeys((await registry.issue("edge", null)).code);
        expect(registry.take("not-a-lookup", "10.0.0.2")).toEqual({ok: false, reason: "rejected"});
        expect(registry.take(kept.lookup, "10.0.0.1").ok).toBe(true);
        const dropped = await deriveEnrollmentKeys((await registry.issue("edge", null)).code);
        registry.revokeAll();
        expect(registry.take(dropped.lookup, "10.0.0.1").ok).toBe(false);
    });

    test("a new code for the same client invalidates the previous one", async () => {
        const registry = new EnrollmentRegistry(clock);
        const first = await deriveEnrollmentKeys((await registry.issue("edge")).code);
        const second = await deriveEnrollmentKeys((await registry.issue("edge")).code);
        expect(registry.take(first.lookup, "10.0.0.1").ok).toBe(false);
        expect(registry.take(second.lookup, "10.0.0.1").ok).toBe(true);
    });

    test("revoking a client drops its code", async () => {
        const registry = new EnrollmentRegistry(clock);
        const keys = await deriveEnrollmentKeys((await registry.issue("edge")).code);
        registry.revokeClient("edge");
        expect(registry.take(keys.lookup, "10.0.0.1").ok).toBe(false);
    });

    test("the registry keeps no code text", async () => {
        const registry = new EnrollmentRegistry(clock);
        const {code} = await registry.issue("edge");
        const dump = JSON.stringify([...(registry as any)._pending.entries()].map(([k, v]: [string, any]) => [k, {...v, key: v.keys.key.toString("hex")}]));
        expect(dump).not.toContain(code);
        expect(dump).not.toContain(code.replace(/-/g, ""));
    });

    test("too many failures from one address are throttled, even for a valid code, until the window passes", async () => {
        const registry = new EnrollmentRegistry(clock);
        const keys = await deriveEnrollmentKeys((await registry.issue("edge")).code);
        for(let n = 0; n < MAX_ENROLLMENT_FAILURES; n++) {
            expect(registry.take("0".repeat(64), "203.0.113.9")).toEqual({ok: false, reason: "rejected"});
        }
        expect(registry.take(keys.lookup, "203.0.113.9")).toEqual({ok: false, reason: "throttled"});
        expect(registry.take(keys.lookup, "198.51.100.1").ok).toBe(true);
        now += 15 * 60_000 + 1;
        expect(registry.take("0".repeat(64), "203.0.113.9")).toEqual({ok: false, reason: "rejected"});
    });

    test("failure records of other addresses are dropped after the window and stay bounded", async () => {
        const registry = new EnrollmentRegistry(clock);
        for(let n = 0; n < 50; n++) registry.take("0".repeat(64), `10.1.${n}.1`);
        expect((registry as any)._failures.size).toBe(50);
        now += 15 * 60_000 + 1;
        registry.take("0".repeat(64), "10.9.9.9");
        expect((registry as any)._failures.size).toBe(1);
    });
});
