import {normalizeConnectionSecurity} from "../../../../src/server/security/connectionSecurity";
import {DEFAULT_GEO_CONFIG} from "../../../../src/types/TunnelingOption";

describe("normalizeConnectionSecurity", () => {
    it("defaults to the off geo config with no warnings when input is undefined", () => {
        const result = normalizeConnectionSecurity(undefined);
        expect(result).toEqual({success: true, value: {geo: {...DEFAULT_GEO_CONFIG}, blocklist: []}, warnings: [], blocklistWarnings: []});
    });

    it("trims, uppercases, and de-duplicates country codes", () => {
        const result = normalizeConnectionSecurity({geo: {mode: "allow", countries: ["kr", " us ", "KR"]}});
        expect(result.success).toBe(true);
        if(result.success) {
            expect(result.value.geo.countries).toEqual(["KR", "US"]);
        }
    });

    it("rejects allow mode with an empty country list", () => {
        const result = normalizeConnectionSecurity({geo: {mode: "allow", countries: []}});
        expect(result).toEqual({success: false, message: "allow mode requires at least one country"});
    });

    it("rejects a country code that is not ISO 3166-1 alpha-2", () => {
        const result = normalizeConnectionSecurity({geo: {mode: "deny", countries: ["XX"]}});
        expect(result).toEqual({
            success: false,
            message: "connectionSecurity.geo.countries[0] is not an ISO 3166-1 alpha-2 code: XX"
        });
    });

    it.each([
        [{geo: {mode: "block"}}],
        [{geo: {applyToAdmin: "yes"}}],
        [{geo: {unknownPolicy: "maybe"}}],
        [{geo: {countries: "KR"}}],
        ["text"]
    ])("rejects invalid input %#", (input) => {
        const result = normalizeConnectionSecurity(input);
        expect(result.success).toBe(false);
    });

    it("warns when unknownPolicy=deny also applies to the admin console", () => {
        const withAdmin = normalizeConnectionSecurity({
            geo: {mode: "allow", countries: ["KR"], unknownPolicy: "deny", applyToAdmin: true}
        });
        expect(withAdmin.success).toBe(true);
        if(withAdmin.success) expect(withAdmin.warnings.length).toBe(1);

        const withoutAdmin = normalizeConnectionSecurity({
            geo: {mode: "deny", countries: ["KR"], unknownPolicy: "deny", applyToAdmin: false}
        });
        expect(withoutAdmin.success).toBe(true);
        if(withoutAdmin.success) expect(withoutAdmin.warnings).toEqual([]);
    });

    // #286 REQ-2 AC-3 — 차단 목록은 geo 와 함께 정규화한다. 틀린 항목은 실패가 아니라 경고로 건너뛴다.
    it("normalizes the blocklist and skips broken entries with a warning", () => {
        const result = normalizeConnectionSecurity({blocklist: [
            {address: "198.51.100.9/24", port: null, note: "", createdAt: 1, createdBy: "admin"},
            {address: "bogus", port: null, note: "", createdAt: 1, createdBy: "admin"}
        ]});
        expect(result).toEqual({
            success: true,
            value: {geo: {...DEFAULT_GEO_CONFIG}, blocklist: [{address: "198.51.100.0/24", port: null, note: "", createdAt: 1, createdBy: "admin"}]},
            warnings: [],
            blocklistWarnings: [expect.stringContaining("connectionSecurity.blocklist[1]")]
        });
    });

    it("keeps the blocklist alongside a valid geo config", () => {
        const result = normalizeConnectionSecurity({geo: {mode: "deny", countries: ["KP"]}, blocklist: [
            {address: "203.0.113.7", port: 18080, note: "x", createdAt: 1, createdBy: "admin"}
        ]});
        expect(result.success && result.value.blocklist).toEqual([{address: "203.0.113.7", port: 18080, note: "x", createdAt: 1, createdBy: "admin"}]);
        expect(result.success && result.value.geo.mode).toBe("deny");
    });
});
