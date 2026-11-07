import crypto from "node:crypto";
import {PasskeyLoginChallenges} from "../../../../src/server/passkey/PasskeyLoginChallenges";

// #336 REQ-8·REQ-9 — 상태를 남기지 않는 로그인 challenge 와 한 번만 쓰게 하는 사용 목록.

const scope = {origin: "https://admin.example.com:9300", rpId: "admin.example.com", ip: "203.0.113.7"};
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

const setup = (options: {maxUsed?: number} = {}) => {
    let now = 1_700_000_000_000;
    const challenges = new PasskeyLoginChallenges(() => now, options);
    return {challenges, advance: (ms: number) => { now += ms; }, now: () => now};
};

describe("PasskeyLoginChallenges", () => {
    it("challenge 는 난수 16 + 만료 8 + HMAC 32 바이트이고 만료는 빅엔디언 Unix ms 다", () => {
        const {challenges, now} = setup();
        const issued = challenges.issue(scope);
        expect(issued).toBeInstanceOf(Uint8Array);
        expect(issued.length).toBe(56);
        expect(Buffer.from(issued).readBigUInt64BE(16)).toBe(BigInt(now() + 150_000));
    });

    it("발급할 때마다 다른 값이다", () => {
        const {challenges} = setup();
        expect(b64(challenges.issue(scope))).not.toBe(b64(challenges.issue(scope)));
    });

    it("같은 Origin·RP ID·IP 이면 맞고, 하나라도 다르면 맞지 않는다", () => {
        const {challenges} = setup();
        const value = b64(challenges.issue(scope));
        expect(challenges.matches(value, scope)).toBe(true);
        expect(challenges.matches(value, {...scope, origin: "https://admin.example.com:9301"})).toBe(false);
        expect(challenges.matches(value, {...scope, rpId: "other.example.com"})).toBe(false);
        expect(challenges.matches(value, {...scope, ip: "203.0.113.8"})).toBe(false);
    });

    it("필드 경계를 옮겨도 맞지 않는다(입력을 \\0 으로 나눈다)", () => {
        const {challenges} = setup();
        const value = b64(challenges.issue({origin: "https://a.b", rpId: "c", ip: "1.2.3.4"}));
        expect(challenges.matches(value, {origin: "https://a.bc", rpId: "", ip: "1.2.3.4"})).toBe(false);
    });

    it("150초가 지나면 맞지 않는다", () => {
        const {challenges, advance} = setup();
        const value = b64(challenges.issue(scope));
        advance(149_999);
        expect(challenges.matches(value, scope)).toBe(true);
        advance(1);
        expect(challenges.matches(value, scope)).toBe(false);
    });

    it("다른 인스턴스(다시 시작한 서버)가 발급한 값은 맞지 않는다", () => {
        const {challenges} = setup();
        const other = new PasskeyLoginChallenges(() => 1_700_000_000_000);
        expect(challenges.matches(b64(other.issue(scope)), scope)).toBe(false);
    });

    it.each([
        ["빈 문자열", ""],
        ["짧은 값", "AAAA"],
        ["base64url 이 아닌 값", "!!!!"],
        ["길이가 다른 값", b64(crypto.randomBytes(57))],
        ["임의의 56바이트", b64(crypto.randomBytes(56))],
    ])("%s 는 맞지 않는다", (_label, value) => {
        const {challenges} = setup();
        expect(challenges.matches(value, scope)).toBe(false);
    });

    it("consume 은 한 번만 ok 이고 두 번째는 invalid 다", () => {
        const {challenges} = setup();
        const value = b64(challenges.issue(scope));
        expect(challenges.consume(value, scope)).toBe("ok");
        expect(challenges.consume(value, scope)).toBe("invalid");
    });

    it("맞지 않는 값은 사용 목록에 넣지 않는다", () => {
        const {challenges} = setup();
        for(let i = 0; i < 10; i++) expect(challenges.consume(b64(crypto.randomBytes(56)), scope)).toBe("invalid");
        expect(challenges.usedCount).toBe(0);
    });

    it("사용 목록이 상한이면 busy 이고, 그 값은 나중에 쓸 수 있다", () => {
        const {challenges} = setup({maxUsed: 2});
        const values = [0, 1, 2].map(() => b64(challenges.issue(scope)));
        expect(challenges.consume(values[0], scope)).toBe("ok");
        expect(challenges.consume(values[1], scope)).toBe("ok");
        expect(challenges.consume(values[2], scope)).toBe("busy");
        expect(challenges.usedCount).toBe(2);
    });

    it("sweep 은 만료된 항목만 지운다", () => {
        const {challenges, advance} = setup({maxUsed: 2});
        const first = b64(challenges.issue(scope));
        expect(challenges.consume(first, scope)).toBe("ok");
        advance(100_000);
        const second = b64(challenges.issue(scope));
        expect(challenges.consume(second, scope)).toBe("ok");
        advance(50_000);
        challenges.sweep();
        expect(challenges.usedCount).toBe(1);
        const third = b64(challenges.issue(scope));
        expect(challenges.consume(third, scope)).toBe("ok");
    });

    it("기본 사용 목록 상한은 100,000개다", () => {
        expect(PasskeyLoginChallenges.MAX_USED).toBe(100_000);
        expect(PasskeyLoginChallenges.TTL_MS).toBe(150_000);
    });
});
