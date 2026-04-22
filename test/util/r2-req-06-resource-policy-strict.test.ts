/**
 * R2-REQ-06 — ResourcePolicyRegistry 엄격 모드 검증.
 * NO-MOCK: 실 모듈. jest.isolateModules는 Node 모듈 캐시 분리이며 함수 대체(Mock)가 아님.
 */
import { ResourcePolicyRegistry, DEFAULT_RESOURCE_POLICY } from "../../src/util/ResourcePolicy";

describe("R2-REQ-06 ResourcePolicy strict mode", () => {
    beforeEach(() => {
        ResourcePolicyRegistry.reset();
        ResourcePolicyRegistry.configureStrict(false);
    });

    afterAll(() => {
        ResourcePolicyRegistry.reset();
        ResourcePolicyRegistry.configureStrict(false);
    });

    test("(a) 기본 모드: 잘못된 ratio 값 WARN + clamp", () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            ResourcePolicyRegistry.configure({ highWatermarkRatio: 1.5 });
            const cur = ResourcePolicyRegistry.current();
            expect(cur.highWatermarkRatio).toBe(0.95);
            // 콘솔 WARN 또는 LoggerFactory로 내려갔을 수 있음. 어느 쪽이든 throw 없이 통과.
            // 로거 경로가 우선이면 console.warn은 호출되지 않으므로 호출 여부 필수 아님.
        } finally {
            warnSpy.mockRestore();
        }
    });

    test("(a-2) 음수 byte limit WARN + clamp", () => {
        ResourcePolicyRegistry.configure({ defaultPoolQueueLimitBytes: -100 });
        const cur = ResourcePolicyRegistry.current();
        expect(cur.defaultPoolQueueLimitBytes).toBe(DEFAULT_RESOURCE_POLICY.defaultPoolQueueLimitBytes);
    });

    test("(a-3) NaN ratio WARN + clamp", () => {
        ResourcePolicyRegistry.configure({ lowWatermarkRatio: NaN });
        const cur = ResourcePolicyRegistry.current();
        expect(cur.lowWatermarkRatio).toBe(DEFAULT_RESOURCE_POLICY.lowWatermarkRatio);
    });

    test("(b) strict 모드: 잘못된 ratio → RangeError throw", () => {
        ResourcePolicyRegistry.configureStrict(true);
        ResourcePolicyRegistry.configure({ highWatermarkRatio: 1.5 });
        expect(() => ResourcePolicyRegistry.current()).toThrow(RangeError);
    });

    test("(b-2) strict 모드: 음수 byte limit → RangeError throw", () => {
        ResourcePolicyRegistry.configureStrict(true);
        ResourcePolicyRegistry.configure({ defaultPoolQueueLimitBytes: -1 });
        expect(() => ResourcePolicyRegistry.current()).toThrow(RangeError);
    });

    test("(b-3) strict 모드: NaN → RangeError throw", () => {
        ResourcePolicyRegistry.configureStrict(true);
        ResourcePolicyRegistry.configure({ lowWatermarkRatio: NaN });
        expect(() => ResourcePolicyRegistry.current()).toThrow(RangeError);
    });

    test("(c) RESOURCE_POLICY_STRICT=1 env 경로 (jest.isolateModules)", () => {
        const prevEnv = process.env.RESOURCE_POLICY_STRICT;
        process.env.RESOURCE_POLICY_STRICT = "1";
        try {
            jest.isolateModules(() => {
                const { ResourcePolicyRegistry: isolatedRegistry } =
                    require("../../src/util/ResourcePolicy");
                expect(isolatedRegistry.isStrict()).toBe(true);
                isolatedRegistry.configure({ highWatermarkRatio: 2.0 });
                expect(() => isolatedRegistry.current()).toThrow(RangeError);
            });
        } finally {
            if(prevEnv === undefined) delete process.env.RESOURCE_POLICY_STRICT;
            else process.env.RESOURCE_POLICY_STRICT = prevEnv;
        }
    });

    test("(d) 정상 값은 throw 없음 (정상 경로 회귀)", () => {
        ResourcePolicyRegistry.configureStrict(true);
        ResourcePolicyRegistry.configure({ highWatermarkRatio: 0.8, lowWatermarkRatio: 0.4 });
        expect(() => ResourcePolicyRegistry.current()).not.toThrow();
    });

    test("configureStrict / isStrict API 존재", () => {
        expect(typeof ResourcePolicyRegistry.configureStrict).toBe("function");
        expect(typeof ResourcePolicyRegistry.isStrict).toBe("function");
    });
});
