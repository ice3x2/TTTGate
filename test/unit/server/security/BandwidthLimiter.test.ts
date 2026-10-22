import {BandwidthLimiter, PRESET_BYTES_PER_SECOND, REFILL_INTERVAL_MS} from "../../../../src/server/security/BandwidthLimiter";

// U5-09 / #124 — 그룹 토큰 버킷. 케이스마다 새 리미터로 시작한다(버킷 상태가 넘어가면 기대값이 달라진다).

const C = 1_048_576;

describe("BandwidthLimiter", () => {
    it("프리셋 값과 보충 간격", () => {
        expect(PRESET_BYTES_PER_SECOND).toEqual({unlimited: 0, "1MB/s": 1_048_576, "10MB/s": 10_485_760, "100MB/s": 104_857_600});
        expect(REFILL_INTERVAL_MS).toBe(100);
    });

    it("케이스 1: 빈 버킷에서 시작해 100ms 마다 1/10 씩 보충하고 상한에서 멈춘다", () => {
        const limiter = new BandwidthLimiter();
        expect(limiter.consume("g", C, 65_536, 0)).toBe(63);
        expect(limiter.consume("g", C, 0, 100)).toBe(0);
        expect(limiter.bucket("g")!.tokens).toBeCloseTo(39_321.6, 0);
        limiter.consume("g", C, 0, 2_000);
        expect(limiter.bucket("g")!.tokens).toBe(C);
        expect(limiter.consume("g", C, C, 2_000)).toBe(0);
        expect(limiter.consume("g", C, C, 2_000)).toBe(1000);
    });

    it("케이스 2: 무제한(0)은 버킷을 만들지 않는다", () => {
        const limiter = new BandwidthLimiter();
        expect(limiter.consume("g", 0, 1_000_000, 0)).toBe(0);
        expect(limiter.bucket("g")).toBeUndefined();
    });

    it("케이스 3: 용량이 바뀌면 새 버킷으로 시작한다", () => {
        const limiter = new BandwidthLimiter();
        expect(limiter.consume("g", C, 10, 0)).toBe(1);
        expect(limiter.consume("g", 10_485_760, 10, 0)).toBe(1);
        expect(limiter.bucket("g")).toMatchObject({capacity: 10_485_760, tokens: -10});
    });

    it("케이스 4: 정상 속도로 소비하면 부족분이 일정하게 유지되어 대기가 모두 100ms 다", () => {
        const limiter = new BandwidthLimiter();
        const waits: number[] = [];
        for(let now = 100; now <= 1000; now += 100) waits.push(limiter.consume("g", C, C / 10, now));
        expect(waits).toEqual(Array(10).fill(100));
        expect(limiter.bucket("g")!.tokens).toBeCloseTo(-104_857.6, 1);
    });

    it("무제한 호출은 기존 버킷을 지우지 않고, release 만 지운다", () => {
        const limiter = new BandwidthLimiter();
        limiter.consume("g", C, 10, 0);
        expect(limiter.consume("g", 0, 10, 0)).toBe(0);
        expect(limiter.bucket("g")).toBeDefined();
        limiter.release("g");
        expect(limiter.bucket("g")).toBeUndefined();
    });

    it("그룹마다 버킷이 따로다", () => {
        const limiter = new BandwidthLimiter();
        limiter.consume("a", C, C, 0);
        expect(limiter.consume("b", C, 0, 0)).toBe(0);
        expect(limiter.bucket("b")!.tokens).toBe(0);
    });
});
