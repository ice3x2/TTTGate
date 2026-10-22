import * as fs from "fs";
import * as path from "path";
import { timingSafeStringEqual } from "../../../src/util/timingSafeStringEqual";

/**
 * REQ-04 / REQ-21 — timingSafeStringEqual 헬퍼 검증.
 * NO-MOCK: 실 crypto.timingSafeEqual, 실 Buffer만 사용.
 */
describe("REQ-04 timingSafeStringEqual", () => {
    const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
    test("case1 — 동일한 hex 문자열은 true", () => {
        const hex = "deadbeefcafebabe00112233445566778899aabbccddeeff";
        expect(timingSafeStringEqual(hex, hex)).toBe(true);
    });

    test("case2 — 내용이 다르면 false (길이 동일)", () => {
        const a = "deadbeefcafebabe00112233445566778899aabbccddeeff";
        const b = "deadbeefcafebabe00112233445566778899aabbccddee00";
        expect(timingSafeStringEqual(a, b)).toBe(false);
    });

    test("case3 — 길이가 달라도 예외 없이 false (상수시간 가드)", () => {
        const a = "aa";
        const b = "aabbcc";
        expect(timingSafeStringEqual(a, b)).toBe(false);
        // 역순도 동일
        expect(timingSafeStringEqual(b, a)).toBe(false);
    });

    test("case4 — 빈 문자열 동치", () => {
        expect(timingSafeStringEqual("", "")).toBe(true);
        expect(timingSafeStringEqual("", "00")).toBe(false);
    });

    test("case5 — Buffer / string 혼합 입력", () => {
        const raw = Buffer.from([0x01, 0x02, 0x03, 0x04]);
        const hex = raw.toString("hex"); // "01020304"
        expect(timingSafeStringEqual(raw, hex)).toBe(true);
        expect(timingSafeStringEqual(hex, raw)).toBe(true);
        expect(timingSafeStringEqual(raw, Buffer.from([0x01, 0x02, 0x03, 0x05]))).toBe(false);
        // utf8 인코딩 경로
        expect(timingSafeStringEqual("hello", "hello", "utf8")).toBe(true);
        expect(timingSafeStringEqual("hello", "world", "utf8")).toBe(false);
    });

    // MEDIUM-1: hex silent truncation 방지 — 부정 케이스 3건.
    test("case6 — 비-hex 문자 포함 문자열은 false (silent truncation 가드)", () => {
        // (a) 완전 non-hex
        expect(timingSafeStringEqual("zz", "zz")).toBe(false);
        // (b) 중간에 비-hex 구분자 포함
        expect(timingSafeStringEqual("ab!cd", "abcd")).toBe(false);
        // (c) prefix는 hex지만 suffix에 비-hex → Buffer.from은 "ab"로 잘라내
        //     실수로 "ab"와 일치시킬 수 있다. false여야 한다.
        expect(timingSafeStringEqual("abzz", "ab")).toBe(false);
    });

    test("case7 — expectedLength 옵션: 실제 길이 불일치는 false", () => {
        const hex = "deadbeef"; // 4바이트
        // expectedLength를 4로 지정 — 정상 경로
        expect(timingSafeStringEqual(hex, hex, "hex", 4)).toBe(true);
        // expectedLength 8인데 실제 4바이트 → false
        expect(timingSafeStringEqual(hex, hex, "hex", 8)).toBe(false);
    });

    test("case7b — expectedLength 0/음수/비정수는 RangeError (조용한 폴백 금지)", () => {
        const hex = "deadbeef";
        expect(() => timingSafeStringEqual(hex, hex, "hex", 0)).toThrow(RangeError);
        expect(() => timingSafeStringEqual(hex, hex, "hex", -1)).toThrow(RangeError);
        expect(() => timingSafeStringEqual(hex, hex, "hex", 1.5)).toThrow(RangeError);
    });

    test("every byte mismatch is rejected for Buffer, hex and UTF-8 inputs", () => {
        const base = Buffer.alloc(64, 0x61);
        for(let index = 0; index < base.length; index++) {
            const mismatch = Buffer.from(base);
            mismatch[index] = 0x62;
            expect(timingSafeStringEqual(base, mismatch)).toBe(false);
            expect(timingSafeStringEqual(base.toString("hex"), mismatch.toString("hex"))).toBe(false);
            expect(timingSafeStringEqual(base.toString("utf8"), mismatch.toString("utf8"), "utf8", 64)).toBe(false);
        }
        expect(timingSafeStringEqual(base, Buffer.from(base), "hex", 64)).toBe(true);
    });

    test("matching decoded prefixes cannot bypass format or expected-length checks", () => {
        for(const invalid of ["zz6161", "61zz61", "6161zz"]) {
            expect(timingSafeStringEqual(invalid, "6161", "hex", 2)).toBe(false);
            expect(timingSafeStringEqual("6161", invalid, "hex", 2)).toBe(false);
        }
        expect(timingSafeStringEqual("616161", "616161", "hex", 2)).toBe(false);
        expect(timingSafeStringEqual("61", "6100", "hex", 2)).toBe(false);
        expect(timingSafeStringEqual("6100", "61", "hex", 2)).toBe(false);
    });

    // Wall-clock measurements run explicitly through npm run test:timing.
    // These CI checks validate semantics/delegation, not constant-time behavior.
    test("소스 파일이 crypto.timingSafeEqual 을 사용한다", () => {
        const src = fs.readFileSync(
            path.join(REPO_ROOT, "src", "util", "timingSafeStringEqual.ts"),
            "utf8"
        );
        expect(src).toMatch(/crypto\.timingSafeEqual/);
    });
});
