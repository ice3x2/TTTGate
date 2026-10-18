import {ConnectionRateLimiter, MAX_TRACKED_IPS_PER_PORT, MAX_TRACKED_SUBNETS_PER_PREFIX} from "../../../../src/server/security/ConnectionRateLimiter";

jest.setTimeout(30_000);

// #175 — IPv6 /48 하나로 /64 를 대량으로 만들어 창 표를 넘쳐도 다른 버킷의 카운터가 지워지면 안 된다.
const CONFIG = {windowMs: 60_000, maxConnections: 3, banMs: 60_000};
const v6 = (n: number) => `2001:db8:${(n >> 16) & 0xffff}:${n & 0xffff}::1`;
const v4 = (n: number) => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;

describe("ConnectionRateLimiter window table under a /64 flood (#175)", () => {
    it("a bucket close to its limit keeps its count while one /48 floods new /64 buckets", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, CONFIG);
        expect(limiter.admit(1, "198.51.100.7", 0).allowed).toBe(true);
        expect(limiter.admit(1, "198.51.100.7", 1).allowed).toBe(true);
        for(let n = 0; n < MAX_TRACKED_IPS_PER_PORT + 100; n++) limiter.admit(1, v6(n), 2);
        expect(limiter.trackedIps(1)).toBeLessThanOrEqual(MAX_TRACKED_SUBNETS_PER_PREFIX + 2);
        expect(limiter.admit(1, "198.51.100.7", 3).allowed).toBe(true);
        expect(limiter.admit(1, "198.51.100.7", 4)).toMatchObject({allowed: false, reason: "rate-limit-exceeded"});
    });

    it("new /64 buckets beyond the per-/48 cap are counted together, and only they are banned", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, CONFIG);
        for(let n = 0; n < MAX_TRACKED_SUBNETS_PER_PREFIX; n++) expect(limiter.admit(1, `2001:db8:77:${n.toString(16)}::1`, 0).allowed).toBe(true);
        const decisions = [0, 1, 2, 3].map((n) => limiter.admit(1, `2001:db8:77:${(0x1000 + n).toString(16)}::1`, 1));
        expect(decisions.slice(0, 3).every((decision) => decision.allowed)).toBe(true);
        expect(decisions[3]).toMatchObject({allowed: false, reason: "rate-limit-exceeded"});
        // 같은 /48 의 다른 새 /64 도 그 동안 막힌다.
        expect(limiter.admit(1, "2001:db8:77:2000::1", 2)).toMatchObject({allowed: false, reason: "rate-limit-ban"});
        // 이미 따로 세던 /64 와 다른 /48 은 영향을 받지 않는다.
        expect(limiter.admit(1, "2001:db8:77:0::5", 2).allowed).toBe(true);
        expect(limiter.admit(1, "2001:db8:78:1::1", 2).allowed).toBe(true);
    });

    it("a full table of active IPv4 buckets never turns into a shared bucket that blocks new clients", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, CONFIG);
        for(let n = 0; n < MAX_TRACKED_IPS_PER_PORT + 1_200; n++) limiter.admit(1, v4(n), 0);
        for(let n = 0; n < 40; n++) limiter.admit(1, v4(MAX_TRACKED_IPS_PER_PORT + 2_000 + n), 1);
        expect(limiter.bans(2).map((ban) => ban.ip).filter((ip) => !/^\d+\.\d+\.\d+\.\d+$/.test(ip))).toEqual([]);
        expect(limiter.admit(1, "203.0.113.9", 2).allowed).toBe(true);
        expect(limiter.trackedIps(1)).toBe(MAX_TRACKED_IPS_PER_PORT);
    });

    it("expired buckets are dropped first when the table is full", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, CONFIG);
        for(let n = 0; n < MAX_TRACKED_IPS_PER_PORT; n++) limiter.admit(1, v4(n), 0);
        expect(limiter.admit(1, "203.0.113.9", CONFIG.windowMs + 1).allowed).toBe(true);
        expect(limiter.trackedIps(1)).toBe(1);
    });

    it("the per-/48 count follows pruning, so a /48 whose /64 buckets expired is counted per /64 again", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, CONFIG);
        for(let n = 0; n < MAX_TRACKED_SUBNETS_PER_PREFIX; n++) limiter.admit(1, `2001:db8:77:${n.toString(16)}::1`, 0);
        limiter.prune(CONFIG.windowMs + 1);
        expect(limiter.trackedIps(1)).toBe(0);
        for(let n = 0; n < 4; n++) expect(limiter.admit(1, `2001:db8:77:${(0x1000 + n).toString(16)}::1`, CONFIG.windowMs + 2).allowed).toBe(true);
    });
});

describe("/48 bans are listed and can be lifted (#175)", () => {
    it("lists the /48 ban and unbans it by the listed string", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, CONFIG);
        for(let n = 0; n < MAX_TRACKED_SUBNETS_PER_PREFIX; n++) limiter.admit(1, `2001:db8:77:${n.toString(16)}::1`, 0);
        for(let n = 0; n < 4; n++) limiter.admit(1, `2001:db8:77:${(0x1000 + n).toString(16)}::1`, 1);
        expect(limiter.bans(2).map((ban) => ban.ip)).toContain("2001:db8:77::/48");
        expect(limiter.unban(1, "2001:db8:77::/48")).toBe(true);
        expect(limiter.admit(1, "2001:db8:77:2000::1", 3).allowed).toBe(true);
    });
});

describe("full ban table (#175)", () => {
    it("a bucket over its limit stays rejected for the window when no more bans fit", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, {windowMs: 60_000, maxConnections: 3, banMs: 600_000});
        // 서로 다른 IPv4 1만 개를 각각 한도 넘게 열어 ban 표를 채운다.
        for(let n = 0; n < MAX_TRACKED_IPS_PER_PORT; n++) for(let k = 0; k < 4; k++) limiter.admit(1, v4(n), 0);
        expect(limiter.stats(1).bannedIps).toBe(MAX_TRACKED_IPS_PER_PORT);
        let allowed = 0;
        for(let k = 0; k < 100; k++) if(limiter.admit(1, "203.0.113.9", 1 + k).allowed) allowed++;
        expect(allowed).toBe(3);
        // 창이 지나면 다시 받는다.
        expect(limiter.admit(1, "203.0.113.9", 60_200).allowed).toBe(true);
    });
});

describe("per-/48 subnet count invariant (#175)", () => {
    it("matches the /64 buckets in the window table after mixed operations", () => {
        const limiter = new ConnectionRateLimiter();
        limiter.configurePort(1, {windowMs: 1_000, maxConnections: 2, banMs: 5_000});
        let seed = 7;
        const rand = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
        for(let step = 0; step < 20_000; step++) {
            const now = step;
            if(rand(50) === 0) limiter.prune(now);
            limiter.admit(1, `2001:db8:${rand(3)}:${rand(400).toString(16)}::1`, now);
        }
        const state = (limiter as any)._ports.get(1);
        const expected = new Map<string, number>();
        for(const key of state.windows.keys()) {
            const m = /^([0-9a-f]+):([0-9a-f]+):([0-9a-f]+):[0-9a-f]+::\/64$/.exec(key);
            if(m) expected.set(`${m[1]}:${m[2]}:${m[3]}::/48`, (expected.get(`${m[1]}:${m[2]}:${m[3]}::/48`) ?? 0) + 1);
        }
        expect(new Map(state.subnetsPerPrefix)).toEqual(expected);
    });
});
