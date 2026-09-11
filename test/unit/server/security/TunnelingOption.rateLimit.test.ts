import {defaultRateLimit, normalizeRateLimit, RATE_LIMIT_RANGE} from "../../../../src/types/TunnelingOption";

describe("defaultRateLimit", () => {
    it("defaults tcp (and undefined protocol) to 30 max connections", () => {
        expect(defaultRateLimit("tcp")).toEqual({enabled: true, windowMs: 60000, maxConnections: 30, banMs: 600000, customized: false});
        expect(defaultRateLimit(undefined)).toEqual({enabled: true, windowMs: 60000, maxConnections: 30, banMs: 600000, customized: false});
    });

    it("defaults http and https to 300 max connections", () => {
        expect(defaultRateLimit("http")).toEqual({enabled: true, windowMs: 60000, maxConnections: 300, banMs: 600000, customized: false});
        expect(defaultRateLimit("https")).toEqual({enabled: true, windowMs: 60000, maxConnections: 300, banMs: 600000, customized: false});
    });
});

describe("normalizeRateLimit", () => {
    it("returns the protocol default when input is undefined", () => {
        expect(normalizeRateLimit("http", undefined)).toEqual({success: true, rateLimit: defaultRateLimit("http")});
    });

    it("overlays a partial input onto the protocol default", () => {
        expect(normalizeRateLimit("tcp", {maxConnections: 5})).toEqual({
            success: true,
            rateLimit: {enabled: true, windowMs: 60000, maxConnections: 5, banMs: 600000, customized: false}
        });
    });

    it.each([
        ["windowMs", 999, RATE_LIMIT_RANGE.windowMs],
        ["windowMs", 3_600_001, RATE_LIMIT_RANGE.windowMs],
        ["maxConnections", 0, RATE_LIMIT_RANGE.maxConnections],
        ["maxConnections", 100_001, RATE_LIMIT_RANGE.maxConnections],
        ["banMs", 86_400_001, RATE_LIMIT_RANGE.banMs],
        ["windowMs", 1.5, RATE_LIMIT_RANGE.windowMs],
        ["windowMs", "60000", RATE_LIMIT_RANGE.windowMs]
    ])("rejects out-of-range or non-integer %s (%p)", (field, value, [min, max]) => {
        const result = normalizeRateLimit("tcp", {[field]: value});
        expect(result.success).toBe(false);
        expect((result as {success: false; message: string}).message).toBe(`rateLimit.${field} must be an integer within ${min}..${max}`);
    });

    it.each([
        [{enabled: "yes"}],
        [{customized: 1}],
        [null],
        [[]]
    ])("rejects malformed input %p", (input) => {
        const result = normalizeRateLimit("tcp", input);
        expect(result.success).toBe(false);
    });

    it("does not mutate a frozen input object", () => {
        const input = Object.freeze({maxConnections: 7});
        expect(() => normalizeRateLimit("tcp", input)).not.toThrow();
        const result = normalizeRateLimit("tcp", input);
        expect(result).toEqual({
            success: true,
            rateLimit: {enabled: true, windowMs: 60000, maxConnections: 7, banMs: 600000, customized: false}
        });
    });
});
