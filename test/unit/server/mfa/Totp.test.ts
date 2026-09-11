/**
 * #111 (U4-03) — RFC 4226 HOTP / RFC 6238 TOTP / 복구 코드 검증.
 * 비밀은 RFC 6238 부록 B 시험 벡터(ASCII '12345678901234567890', 20바이트).
 */
import {
    generateSecret,
    stepOf,
    hotp,
    generate,
    verify,
    otpauthUri,
    generateRecoveryCodes,
    hashRecoveryCode,
    normalizeRecoveryCode,
    findRecoveryCodeHash
} from "../../../../src/server/mfa/Totp";

const SECRET = Buffer.from("12345678901234567890", "ascii");

describe("Totp — RFC 6238 부록 B 시험 벡터", () => {
    it("generate 가 시각별 6자리 코드를 계산한다", () => {
        expect(generate(SECRET, 59_000)).toBe("287082");
        expect(generate(SECRET, 1_111_111_109_000)).toBe("081804");
        expect(generate(SECRET, 1_234_567_890_000)).toBe("005924");
        expect(generate(SECRET, 2_000_000_000_000)).toBe("279037");
    });

    it("hotp 가 RFC 4226 부록 D 시험 벡터와 일치한다", () => {
        expect(hotp(SECRET, 0)).toBe("755224");
        expect(hotp(SECRET, 1)).toBe("287082");
        expect(hotp(SECRET, 2)).toBe("359152");
        expect(hotp(SECRET, 3)).toBe("969429");
        expect(hotp(SECRET, 4)).toBe("338314");
        expect(hotp(SECRET, 5)).toBe("254676");
        expect(hotp(SECRET, 6)).toBe("287922");
        expect(hotp(SECRET, 7)).toBe("162583");
        expect(hotp(SECRET, 8)).toBe("399871");
        expect(hotp(SECRET, 9)).toBe("520489");
    });

    it("stepOf 가 30초 단위 카운터를 계산한다", () => {
        expect(stepOf(59_000)).toBe(1);
        expect(stepOf(1_111_111_109_000)).toBe(0x23523EC);
    });
});

describe("Totp.verify", () => {
    const now = 1_234_567_890_000;

    it("±1 스텝 이내의 코드를 허용한다", () => {
        const prev = verify(SECRET, generate(SECRET, now - 30_000), now, -1);
        expect(prev).toEqual({ ok: true, step: stepOf(now) - 1 });

        const next = verify(SECRET, generate(SECRET, now + 30_000), now, -1);
        expect(next).toEqual({ ok: true, step: stepOf(now) + 1 });
    });

    it("±2 스텝 밖의 코드는 mismatch 이다", () => {
        expect(verify(SECRET, generate(SECRET, now - 60_000), now, -1))
            .toEqual({ ok: false, reason: "mismatch" });
        expect(verify(SECRET, generate(SECRET, now + 60_000), now, -1))
            .toEqual({ ok: false, reason: "mismatch" });
    });

    it("6자리 숫자 형식이 아니면 format 오류이다", () => {
        expect(verify(SECRET, "28708", now, -1)).toEqual({ ok: false, reason: "format" });
        expect(verify(SECRET, "28708a", now, -1)).toEqual({ ok: false, reason: "format" });
        expect(verify(SECRET, " 287082", now, -1)).toEqual({ ok: false, reason: "format" });
    });

    it("이미 사용한 스텝 이하의 코드는 replayed 이다", () => {
        expect(verify(SECRET, generate(SECRET, now), now, stepOf(now)))
            .toEqual({ ok: false, reason: "replayed" });

        // lastUsedStep 이 now 의 스텝인데, now - 30_000 의 코드(더 이른 스텝)를 보내도 replayed.
        expect(verify(SECRET, generate(SECRET, now - 30_000), now, stepOf(now)))
            .toEqual({ ok: false, reason: "replayed" });

        // lastUsedStep 이 now 보다 한 스텝 이전이면, now 의 코드는 허용된다.
        expect(verify(SECRET, generate(SECRET, now), now, stepOf(now) - 1))
            .toEqual({ ok: true, step: stepOf(now) });
    });
});

describe("generateSecret", () => {
    it("길이 20바이트이고, 100회 호출이 모두 서로 다르다", () => {
        const secrets = Array.from({ length: 100 }, () => generateSecret());
        expect(secrets.every((s) => s.length === 20)).toBe(true);
        const unique = new Set(secrets.map((s) => s.toString("hex")));
        expect(unique.size).toBe(100);
    });
});

describe("otpauthUri", () => {
    it("정확한 otpauth URI 를 만든다", () => {
        expect(otpauthUri("alice", "ABC"))
            .toBe("otpauth://totp/TTTGate:alice?secret=ABC&issuer=TTTGate&algorithm=SHA1&digits=6&period=30");
    });

    it("username 을 URI 인코딩한다", () => {
        expect(otpauthUri("a b", "ABC")).toContain("TTTGate:a%20b");
    });
});

describe("복구 코드", () => {
    it("generateRecoveryCodes 가 형식이 맞고 서로 다른 10개를 만든다", () => {
        for (let i = 0; i < 200; i++) {
            const codes = generateRecoveryCodes();
            expect(codes).toHaveLength(10);
            codes.forEach((c) => expect(c).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/));
            expect(new Set(codes).size).toBe(10);
        }
    });

    it("hashRecoveryCode 가 sha256(code + userId) hex 이다", () => {
        const crypto = require("crypto");
        const expected = crypto.createHash("sha256").update("ab12-cd34" + "u_1").digest("hex");
        expect(hashRecoveryCode("ab12-cd34", "u_1")).toBe(expected);
    });

    it("normalizeRecoveryCode 가 공백·대소문자를 정규화하고 형식 밖은 undefined 이다", () => {
        expect(normalizeRecoveryCode(" AB12CD34 ")).toBe("ab12-cd34");
        expect(normalizeRecoveryCode("ab12-cd34")).toBe("ab12-cd34");
        expect(normalizeRecoveryCode("ab12-cd3")).toBeUndefined();
        expect(normalizeRecoveryCode("ab12_cd34")).toBeUndefined();
    });

    it("findRecoveryCodeHash 가 timingSafeStringEqual 로 전수 비교하여 인덱스를 찾는다", () => {
        const H1 = hashRecoveryCode("ab12-cd34", "u_1");
        const H2 = hashRecoveryCode("ef56-gh78", "u_1");
        const H3 = hashRecoveryCode("ij90-kl12", "u_1");
        const HX = hashRecoveryCode("zz99-yy88", "u_1");

        expect(findRecoveryCodeHash([H1, H2, H3], H2)).toBe(1);
        expect(findRecoveryCodeHash([H1, H2, H3], HX)).toBe(-1);
        expect(findRecoveryCodeHash([], H1)).toBe(-1);
    });

    it("findRecoveryCodeHash 는 hex 형식이 아닌 입력을 예외 없이 불일치로 처리한다", () => {
        const H1 = hashRecoveryCode("ab12-cd34", "u_1");
        const H2 = hashRecoveryCode("ef56-gh78", "u_1");
        const H3 = hashRecoveryCode("ij90-kl12", "u_1");
        expect(findRecoveryCodeHash([H1, H2, H3], "not-hex")).toBe(-1);
    });
});
