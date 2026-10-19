import {ISO_ALPHA2, countryName, listCountries} from "../../../../src/server/security/countries";

describe("countries", () => {
    it("contains exactly the 249 ISO 3166-1 alpha-2 codes, all uppercase two-letter", () => {
        expect(ISO_ALPHA2.size).toBe(249);
        for(const code of ISO_ALPHA2) {
            expect(code).toMatch(/^[A-Z]{2}$/);
        }
        expect(ISO_ALPHA2.has("KR")).toBe(true);
        expect(ISO_ALPHA2.has("US")).toBe(true);
        expect(ISO_ALPHA2.has("AU")).toBe(true);
    });

    it("translates a known code to a non-empty, different display name", () => {
        const name = countryName("KR");
        expect(name.length).toBeGreaterThan(0);
        expect(name).not.toBe("KR");
    });

    it("returns unknown codes verbatim without going through Intl.DisplayNames", () => {
        expect(countryName("ZZ")).toBe("ZZ");
        expect(countryName("zz")).toBe("zz");
        expect(countryName("KOR")).toBe("KOR");
        expect(countryName("")).toBe("");
    });

    it("lists all 249 countries sorted by name ascending", () => {
        const list = listCountries();
        expect(list.length).toBe(249);
        const names = list.map((entry) => entry.name);
        const sorted = [...names].sort((a, b) => a.localeCompare(b, "en"));
        expect(names).toEqual(sorted);
    });
});
