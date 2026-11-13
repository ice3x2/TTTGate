import {
    ENROLLMENT_CODE_ALPHABET,
    deriveEnrollmentKeys,
    generateEnrollmentCode,
    normalizeEnrollmentCode,
    openEnrollmentPayload,
    sealEnrollmentPayload
} from "../../../src/commons/Enrollment";

// #212 REQ-4·REQ-6: 등록 코드와 교환 응답 봉인
describe("enrollment crypto", () => {
    test("codes are 12 symbols from an alphabet without confusable letters, shown in groups of four (60 bits)", () => {
        expect(ENROLLMENT_CODE_ALPHABET).toHaveLength(32);
        expect(ENROLLMENT_CODE_ALPHABET).not.toMatch(/[ILOU]/);
        const codes = new Set<string>();
        for(let n = 0; n < 200; n++) {
            const code = generateEnrollmentCode();
            expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
            codes.add(code);
        }
        expect(codes.size).toBe(200);
    });

    test("normalization ignores case, spaces and dashes and maps confusable letters", () => {
        expect(normalizeEnrollmentCode(" 7q4k-m2xp-ab01 ")).toBe("7Q4KM2XPAB01");
        expect(normalizeEnrollmentCode("7Q4K M2XP AB0I")).toBe("7Q4KM2XPAB01");
        expect(normalizeEnrollmentCode("OOOO-LLLL-0000")).toBe("000011110000");
        expect(normalizeEnrollmentCode("short")).toBeUndefined();
        expect(normalizeEnrollmentCode("7Q4K-M2XP-AB0U")).toBeUndefined();
    });

    test("key derivation is deterministic per code and separates the lookup value from the key", async () => {
        const a = await deriveEnrollmentKeys("7Q4K-M2XP-AB01");
        const b = await deriveEnrollmentKeys("7q4km2xpab01");
        const c = await deriveEnrollmentKeys("7Q4K-M2XP-AB02");
        expect(a.lookup).toBe(b.lookup);
        expect(a.lookup).toMatch(/^[0-9a-f]{64}$/);
        expect(a.lookup).not.toBe(c.lookup);
        expect(a.key.equals(b.key)).toBe(true);
        expect(a.key.toString("hex")).not.toBe(a.lookup);
    });

    test("a sealed payload opens only with the same code and lookup", async () => {
        const keys = await deriveEnrollmentKeys("7Q4K-M2XP-AB01");
        const other = await deriveEnrollmentKeys("7Q4K-M2XP-AB02");
        const sealed = sealEnrollmentPayload(keys, {clientId: "edge", clientSecret: "s"});
        expect(JSON.stringify(sealed)).not.toContain("edge");
        expect(openEnrollmentPayload(keys, sealed)).toEqual({clientId: "edge", clientSecret: "s"});
        expect(openEnrollmentPayload(other, sealed)).toBeUndefined();
        expect(openEnrollmentPayload({...keys, lookup: other.lookup}, sealed)).toBeUndefined();
        // 첫 바이트를 비트로 뒤집어 반드시 바꾼다. 첫 글자를 "x" 로 바꾸면 원래 "x" 일 때(약 1/64) 아무것도 바뀌지 않았다.
        const flipped = Buffer.from(sealed.ciphertext, "base64");
        flipped[0] ^= 0x01;
        const tampered = {...sealed, ciphertext: flipped.toString("base64")};
        expect(tampered.ciphertext).not.toBe(sealed.ciphertext);
        expect(openEnrollmentPayload(keys, tampered)).toBeUndefined();
    });
});
