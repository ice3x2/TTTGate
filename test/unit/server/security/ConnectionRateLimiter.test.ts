import {ConnectionRateLimiter, MAX_TRACKED_IPS_PER_PORT} from "../../../../src/server/security/ConnectionRateLimiter";

jest.setTimeout(30_000);

const BASE_CONFIG = {windowMs: 1000, maxConnections: 3, banMs: 5000};

describe("ConnectionRateLimiter", () => {
    it("admits up to the configured maximum, then rejects and bans, then expires the ban", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, BASE_CONFIG);

        expect(limiter.admit(1, "1.1.1.1", 0)).toEqual({allowed: true});
        expect(limiter.admit(1, "1.1.1.1", 1)).toEqual({allowed: true});
        expect(limiter.admit(1, "1.1.1.1", 2)).toEqual({allowed: true});

        expect(limiter.admit(1, "1.1.1.1", 3)).toEqual({
            allowed: false,
            reason: "rate-limit-exceeded",
            retryAfterMs: 5000
        });

        const expectedBan = {allowed: false, reason: "rate-limit-ban", retryAfterMs: 4993};
        expect(limiter.admit(1, "1.1.1.1", 10)).toEqual(expectedBan);
        expect(limiter.banned(1, "1.1.1.1", 10)).toEqual(expectedBan);
        expect(limiter.banned(1, "2.2.2.2", 10)).toBeUndefined();

        expect(limiter.admit(1, "1.1.1.1", 5003)).toEqual({allowed: true});
    });

    it("slides the window forward as old timestamps age out", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, BASE_CONFIG);

        expect(limiter.admit(1, "1.1.1.1", 0)).toEqual({allowed: true});
        expect(limiter.admit(1, "1.1.1.1", 1)).toEqual({allowed: true});
        expect(limiter.admit(1, "1.1.1.1", 2)).toEqual({allowed: true});

        expect(limiter.admit(1, "1.1.1.1", 1001)).toEqual({allowed: true});
        expect(limiter.admit(1, "1.1.1.1", 1002)).toEqual({allowed: true});
        expect(limiter.admit(1, "1.1.1.1", 1003)).toEqual({allowed: true});
        expect(limiter.admit(1, "1.1.1.1", 1004)).toEqual({
            allowed: false,
            reason: "rate-limit-exceeded",
            retryAfterMs: 5000
        });
    });

    it("clears the whole window when every timestamp has aged out (findIndex === -1)", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, BASE_CONFIG);

        expect(limiter.admit(1, "1.1.1.1", 0)).toEqual({allowed: true});
        expect(limiter.admit(1, "1.1.1.1", 1)).toEqual({allowed: true});
        expect(limiter.admit(1, "1.1.1.1", 2)).toEqual({allowed: true});

        expect(limiter.admit(1, "1.1.1.1", 5000)).toEqual({allowed: true});
        expect(limiter.admit(1, "1.1.1.1", 5001)).toEqual({allowed: true});
        expect(limiter.admit(1, "1.1.1.1", 5002)).toEqual({allowed: true});
        expect(limiter.admit(1, "1.1.1.1", 5003)).toEqual({
            allowed: false,
            reason: "rate-limit-exceeded",
            retryAfterMs: 5000
        });
    });

    it("bans a port independently of other ports with the same config", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, BASE_CONFIG);
        limiter.configurePort(2, BASE_CONFIG);

        limiter.admit(1, "1.1.1.1", 0);
        limiter.admit(1, "1.1.1.1", 1);
        limiter.admit(1, "1.1.1.1", 2);
        limiter.admit(1, "1.1.1.1", 3);

        expect(limiter.admit(1, "1.1.1.1", 10)).toMatchObject({reason: "rate-limit-ban"});
        expect(limiter.admit(2, "1.1.1.1", 10)).toEqual({allowed: true});
    });

    it("clears all state for a port when reconfigured with undefined", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, BASE_CONFIG);

        limiter.admit(1, "1.1.1.1", 0);
        limiter.admit(1, "1.1.1.1", 1);
        limiter.admit(1, "1.1.1.1", 2);
        limiter.admit(1, "1.1.1.1", 3);

        limiter.configurePort(1, undefined);

        expect(limiter.admit(1, "1.1.1.1", 4)).toEqual({allowed: true});
        expect(limiter.stats(1)).toEqual({rejectedBans: 0, rejectedExceeded: 0, bannedIps: 0});
        expect(limiter.ports()).not.toContain(1);
    });

    it("unbans an IP on request and reports false for an unknown entry", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, BASE_CONFIG);

        limiter.admit(1, "1.1.1.1", 0);
        limiter.admit(1, "1.1.1.1", 1);
        limiter.admit(1, "1.1.1.1", 2);
        limiter.admit(1, "1.1.1.1", 3);

        expect(limiter.unban(1, "1.1.1.1")).toBe(true);
        expect(limiter.admit(1, "1.1.1.1", 4)).toEqual({allowed: true});
        expect(limiter.unban(1, "9.9.9.9")).toBe(false);
    });

    it("lists active bans sorted by port then bannedUntil, and empties once expired", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, BASE_CONFIG);

        limiter.admit(1, "1.1.1.1", 0);
        limiter.admit(1, "1.1.1.1", 1);
        limiter.admit(1, "1.1.1.1", 2);
        limiter.admit(1, "1.1.1.1", 3);

        expect(limiter.bans(10)).toEqual([{port: 1, ip: "1.1.1.1", bannedUntil: 5003, hits: 4}]);
        expect(limiter.bans(5003)).toEqual([]);
    });

    it("tracks window entry counts and prune() reclaims stale bans and windows", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, BASE_CONFIG);

        limiter.admit(1, "1.1.1.1", 0);
        limiter.admit(1, "1.1.1.1", 1);
        limiter.admit(1, "1.1.1.1", 2);
        limiter.admit(1, "1.1.1.1", 3);

        limiter.admit(1, "2.2.2.2", 0);

        expect(limiter.trackedIps(1)).toBe(1);

        limiter.prune(6000);

        expect(limiter.stats(1).bannedIps).toBe(0);
        expect(limiter.trackedIps(1)).toBe(0);
    });

    it("evicts the oldest tracked IP once MAX_TRACKED_IPS_PER_PORT is exceeded", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, BASE_CONFIG);

        for (let n = 0; n <= MAX_TRACKED_IPS_PER_PORT; n++) {
            limiter.admit(1, `10.0.0.${n}`, n);
        }

        expect(limiter.trackedIps(1)).toBe(MAX_TRACKED_IPS_PER_PORT);

        const base = MAX_TRACKED_IPS_PER_PORT + 1;
        expect(limiter.admit(1, "10.0.0.0", base)).toEqual({allowed: true});
        expect(limiter.admit(1, "10.0.0.0", base + 1)).toEqual({allowed: true});
        expect(limiter.admit(1, "10.0.0.0", base + 2)).toEqual({allowed: true});
    });

    it("resolves a banned lookup in O(1) time at scale", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, BASE_CONFIG);

        limiter.admit(1, "1.1.1.1", 0);
        limiter.admit(1, "1.1.1.1", 1);
        limiter.admit(1, "1.1.1.1", 2);
        limiter.admit(1, "1.1.1.1", 3);

        for (let i = 0; i < 100_000; i++) {
            limiter.admit(1, "1.1.1.1", 10);
        }

        const start = process.hrtime.bigint();
        let allBanned = true;
        for (let i = 0; i < 1_000_000; i++) {
            const decision = limiter.admit(1, "1.1.1.1", 10);
            if (!decision.allowed && decision.reason !== "rate-limit-ban") {
                allBanned = false;
            } else if (decision.allowed) {
                allBanned = false;
            }
        }
        const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;

        expect(allBanned).toBe(true);
        expect(elapsedMs).toBeLessThan(2000);
    });
});
