import {normalizeConnectionSecurity} from "../../../../src/server/security/connectionSecurity";
import {DEFAULT_GEO_CONFIG} from "../../../../src/types/TunnelingOption";

describe("normalizeConnectionSecurity", () => {
    it("defaults to the off geo config with no warnings when input is undefined", () => {
        const result = normalizeConnectionSecurity(undefined);
        expect(result).toEqual({success: true, value: {geo: {...DEFAULT_GEO_CONFIG}}, warnings: []});
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
});
