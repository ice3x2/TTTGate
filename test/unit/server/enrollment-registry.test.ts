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

    test("an expired code is rejected, and the lifetime is capped at 24 hours", async () => {
        const registry = new EnrollmentRegistry(clock);
        const short = await registry.issue("edge", 60_000);
        const keys = await deriveEnrollmentKeys(short.code);
        now += 60_001;
        expect(registry.take(keys.lookup, "10.0.0.1")).toEqual({ok: false, reason: "rejected"});
        expect((await registry.issue("edge", 7 * 24 * 3600_000)).expiresAt).toBe(now + 24 * 3600_000);
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
