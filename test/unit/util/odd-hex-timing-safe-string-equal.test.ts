import {timingSafeStringEqual} from "../../../src/util/timingSafeStringEqual";

describe("odd-length hex validation (#66)", () => {
    test.each([
        ["aaf", "aa"], ["aa", "aaf"],
        ["", "f"], ["f", ""],
        ["a", "b"], ["b", "a"], ["a", "a"],
        ["aaf", "aab"], ["aaf", "aaf"],
    ])("rejects malformed hex %j versus %j", (left, right) => {
        expect(timingSafeStringEqual(left, right)).toBe(false);
    });

    test("rejects unmatched nibbles with Buffer inputs on either side", () => {
        const byte = Buffer.from([0xaa]);
        expect(timingSafeStringEqual(byte, "aaf")).toBe(false);
        expect(timingSafeStringEqual("aaf", byte)).toBe(false);
        expect(timingSafeStringEqual(Buffer.alloc(0), "f")).toBe(false);
        expect(timingSafeStringEqual("f", Buffer.alloc(0))).toBe(false);
    });

    test("expectedLength does not make a truncated hex prefix valid", () => {
        expect(timingSafeStringEqual("aaf", "aa", "hex", 1)).toBe(false);
        expect(timingSafeStringEqual("aa", "aaf", "hex", 1)).toBe(false);
        expect(timingSafeStringEqual("aaf", Buffer.from([0xaa]), "hex", 1)).toBe(false);
    });

    test("preserves even-length hex, case-insensitive digits and empty equality", () => {
        expect(timingSafeStringEqual("AaFf", "aaff")).toBe(true);
        expect(timingSafeStringEqual("aaff", "aa00")).toBe(false);
        expect(timingSafeStringEqual("", "")).toBe(true);
        expect(timingSafeStringEqual("aa", "aa", "hex", 1)).toBe(true);
    });

    test("Buffer byte counts and UTF-8 character counts may be odd", () => {
        const bytes = Buffer.from([0x01, 0x02, 0x03]);
        expect(timingSafeStringEqual(bytes, Buffer.from(bytes))).toBe(true);
        expect(timingSafeStringEqual(bytes, "010203", "hex", 3)).toBe(true);
        expect(timingSafeStringEqual("abc", "abc", "utf8")).toBe(true);
        expect(timingSafeStringEqual("a", "a", "utf8", 1)).toBe(true);
        expect(timingSafeStringEqual("a", "b", "utf8")).toBe(false);
    });
});
