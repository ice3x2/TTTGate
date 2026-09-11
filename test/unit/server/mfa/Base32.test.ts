/**
 * #111 (U4-03) — RFC 4648 §6 Base32 (패딩 없음) 인코딩/디코딩 검증.
 */
import * as crypto from "crypto";
import { base32Encode, base32Decode } from "../../../../src/server/mfa/Base32";

describe("Base32", () => {
    it("RFC 6238 부록 B 비밀을 Base32 로 인코딩한다", () => {
        expect(base32Encode(Buffer.from("12345678901234567890", "ascii")))
            .toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    });

    it("RFC 4648 §10 벡터를 패딩 없이 인코딩한다", () => {
        expect(base32Encode(Buffer.from(""))).toBe("");
        expect(base32Encode(Buffer.from("f"))).toBe("MY");
        expect(base32Encode(Buffer.from("fo"))).toBe("MZXQ");
        expect(base32Encode(Buffer.from("foo"))).toBe("MZXW6");
        expect(base32Encode(Buffer.from("foob"))).toBe("MZXW6YQ");
        expect(base32Encode(Buffer.from("fooba"))).toBe("MZXW6YTB");
        expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    });

    it("무작위 20바이트 100개에 대해 encode-decode 왕복이 원본과 같다", () => {
        for (let i = 0; i < 100; i++) {
            const b = crypto.randomBytes(20);
            expect(base32Decode(base32Encode(b))).toEqual(b);
        }
    });

    it("대소문자와 패딩을 무시하고 디코드한다", () => {
        expect(base32Decode("mzxw6ytboi")).toEqual(Buffer.from("foobar"));
        expect(base32Decode("MZXW6YTBOI======")).toEqual(Buffer.from("foobar"));
    });

    it("알파벳 밖 문자가 있으면 undefined 를 반환한다 (throw 금지)", () => {
        expect(base32Decode("MZ1")).toBeUndefined();
        expect(base32Decode("MZX-")).toBeUndefined();
    });
});
