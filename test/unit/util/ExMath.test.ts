import ExMath from "../../../src/util/ExMath";

describe("ExMath", () => {
    it("map linearly rescales a value, extrapolating outside the input range", () => {
        expect(ExMath.map(5, 0, 10, 0, 100)).toBe(50);
        expect(ExMath.map(15, 0, 10, 0, 100)).toBe(150);
        expect(ExMath.map(-5, 0, 10, 100, 0)).toBe(150);
    });

    it("floor truncates toward negative infinity at the given precision", () => {
        expect(ExMath.floor(1.239, 2)).toBe(1.23);
        expect(ExMath.floor(1299, -2)).toBe(1200);
        expect(ExMath.floor(2.7, 0)).toBe(2);
    });

    it("ceil rounds up toward positive infinity at the given precision", () => {
        expect(ExMath.ceil(1.231, 2)).toBe(1.24);
        expect(ExMath.ceil(1201, -2)).toBe(1300);
        expect(ExMath.ceil(2.1, 0)).toBe(3);
    });

    it("round rounds to the nearest value at the given precision", () => {
        expect(ExMath.round(1.234, 2)).toBe(1.23);
        expect(ExMath.round(1.236, 2)).toBe(1.24);
        expect(ExMath.round(2.5, 0)).toBe(3);
        expect(ExMath.round(1250, -2)).toBe(1300);
    });
});
