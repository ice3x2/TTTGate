import {
    PASSKEY_LIMIT, isStoredPasskey, passkeyNameOf, passkeyRpIdOf, sanitizeTransports, toPasskeyView, type Passkey
} from "../../../../src/server/passkey/Passkey";

// #336 REQ-1·REQ-2·REQ-3 과 용어 "패스키를 쓸 수 있는 Origin".

const stored = (overrides: Partial<Passkey> = {}): Passkey => ({
    id: "AAEC", publicKey: "pQECAyYgASFYIA", counter: 0, transports: ["internal"], rpId: "admin.example.com",
    name: "Office PC", createdAt: 1_700_000_000_000, backedUp: false, ...overrides
});

describe("passkeyRpIdOf — 패스키를 쓸 수 있는 Origin 의 RP ID", () => {
    it.each([
        ["https://admin.example.com", "admin.example.com"],
        ["https://admin.example.com:9300", "admin.example.com"],
        ["https://ADMIN.Example.com:9300", "admin.example.com"],
        ["http://localhost:9300", "localhost"],
        ["https://localhost", "localhost"],
    ])("%s → %s", (origin, rpId) => {
        expect(passkeyRpIdOf(origin)).toBe(rpId);
    });

    it.each([
        [undefined],
        [""],
        ["null"],
        ["not a url"],
        ["http://admin.example.com:9300"],
        ["https://192.168.0.10:9300"],
        ["https://[::1]:9300"],
        ["http://127.0.0.1:9300"],
        ["ftp://admin.example.com"],
    ])("%s 는 쓸 수 없다", (origin) => {
        expect(passkeyRpIdOf(origin)).toBeUndefined();
    });
});

describe("passkeyNameOf — REQ-3", () => {
    it("앞뒤 공백을 뺀 1~64자를 받는다", () => {
        expect(passkeyNameOf("  Office PC ")).toBe("Office PC");
        expect(passkeyNameOf("a")).toBe("a");
        expect(passkeyNameOf("x".repeat(64))).toBe("x".repeat(64));
    });

    it.each([[""], ["   "], ["x".repeat(65)], [42], [undefined], [null]])("%p 는 받지 않는다", (value) => {
        expect(passkeyNameOf(value)).toBeUndefined();
    });
});

describe("sanitizeTransports — REQ-1", () => {
    it("허용한 값만 남기고 중복을 지운다", () => {
        expect(sanitizeTransports(["internal", "junk", "hybrid", "internal", 3, "usb"])).toEqual(["internal", "hybrid", "usb"]);
    });

    it("배열이 아니면 빈 배열이다", () => {
        expect(sanitizeTransports("internal")).toEqual([]);
        expect(sanitizeTransports(undefined)).toEqual([]);
    });

    it("허용한 7가지를 모두 받는다", () => {
        const all = ["usb", "nfc", "ble", "internal", "hybrid", "cable", "smart-card"];
        expect(sanitizeTransports(all)).toEqual(all);
    });

    it("최대 8개까지만 남긴다", () => {
        // 허용 값은 7가지라 중복 제거 뒤 8개를 넘을 수 없다. 상한은 저장 크기를 묶는 마지막 장치로 둔다.
        expect(sanitizeTransports(Array.from({length: 50}, () => "usb"))).toEqual(["usb"]);
    });
});

describe("isStoredPasskey — 파일에서 읽은 항목 검사(REQ-1)", () => {
    it("올바른 항목을 받는다", () => {
        expect(isStoredPasskey(stored())).toBe(true);
        expect(isStoredPasskey(stored({lastUsedAt: 1_700_000_100_000, backedUp: true}))).toBe(true);
    });

    it.each([
        ["id 없음", {id: undefined}],
        ["id 빈 문자열", {id: ""}],
        ["publicKey 숫자", {publicKey: 3}],
        ["counter 음수", {counter: -1}],
        ["counter 소수", {counter: 1.5}],
        ["transports 문자열", {transports: "usb"}],
        ["rpId 없음", {rpId: ""}],
        ["name 너무 김", {name: "x".repeat(65)}],
        ["createdAt 문자열", {createdAt: "now"}],
        ["lastUsedAt 문자열", {lastUsedAt: "now"}],
        ["backedUp 문자열", {backedUp: "yes"}],
    ])("%s 이면 버린다", (_label, patch) => {
        expect(isStoredPasskey({...stored(), ...patch})).toBe(false);
    });

    it("객체가 아니면 버린다", () => {
        expect(isStoredPasskey(null)).toBe(false);
        expect(isStoredPasskey("passkey")).toBe(false);
    });
});

describe("toPasskeyView — REQ-2·REQ-6", () => {
    it("공개키를 담지 않고, 쓴 적이 없으면 lastUsedAt 은 null 이다", () => {
        const view = toPasskeyView(stored());
        expect(view).toEqual({id: "AAEC", name: "Office PC", rpId: "admin.example.com", createdAt: 1_700_000_000_000, lastUsedAt: null, backedUp: false});
        expect(JSON.stringify(view)).not.toContain("pQECAyYgASFYIA");
    });

    it("쓴 시각이 있으면 그대로 담는다", () => {
        expect(toPasskeyView(stored({lastUsedAt: 5, backedUp: true}))).toMatchObject({lastUsedAt: 5, backedUp: true});
    });
});

it("사용자당 상한은 20개다", () => {
    expect(PASSKEY_LIMIT).toBe(20);
});
