import {GeoFilter} from "../../../../src/server/security/GeoFilter";

describe("GeoFilter", () => {
    it("stays unloaded and admits everything while mode is off", () => {
        const filter = new GeoFilter();
        filter.configure({mode: "off", countries: [], applyToAdmin: true, unknownPolicy: "allow"});

        expect(filter.isDatabaseLoaded()).toBe(false);
        expect(filter.decide("8.8.8.8", {kind: "tunnel", port: 1, protocol: "tcp"})).toEqual({allowed: true});
        expect(filter.stats().lookups).toBe(0);
    });

    it("loads the database on first non-off configure", () => {
        const filter = new GeoFilter();
        filter.configure({mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "allow"});

        expect(filter.isDatabaseLoaded()).toBe(true);
    });

    describe("with a loaded database", () => {
        let filter: GeoFilter;
        let c1: string;
        let c2: string;

        beforeEach(() => {
            filter = new GeoFilter();
            filter.configure({mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "allow"});
            c1 = filter.lookupCountry("8.8.8.8")!;
            c2 = filter.lookupCountry("1.1.1.1")!;
            expect(c1).toMatch(/^[A-Z]{2}$/);
            expect(c2).toMatch(/^[A-Z]{2}$/);
        });

        it("admits a country on the allow list and denies one that is not", () => {
            filter.configure({mode: "allow", countries: [c1], applyToAdmin: true, unknownPolicy: "allow"});
            expect(filter.decide("8.8.8.8", {kind: "tunnel", port: 1, protocol: "tcp"})).toEqual({allowed: true});
            if(c2 !== c1) {
                expect(filter.decide("1.1.1.1", {kind: "tunnel", port: 1, protocol: "tcp"})).toEqual({
                    allowed: false,
                    reason: "geo-deny"
                });
            }
        });

        it("denies a country on the deny list and tallies rejected", () => {
            filter.configure({mode: "deny", countries: [c1], applyToAdmin: true, unknownPolicy: "allow"});
            expect(filter.decide("8.8.8.8", {kind: "tunnel", port: 1, protocol: "tcp"})).toEqual({
                allowed: false,
                reason: "geo-deny"
            });
            expect(filter.stats().rejected).toBe(1);
        });

        it("applies unknownPolicy to private/loopback addresses without counting a lookup", () => {
            filter.configure({mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "allow"});
            const before = filter.stats().lookups;
            for(const ip of ["127.0.0.1", "10.0.0.1", "::1"]) {
                expect(filter.decide(ip, {kind: "tunnel", port: 1, protocol: "tcp"})).toEqual({allowed: true});
            }
            expect(filter.stats().lookups).toBe(before);

            filter.configure({mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "deny"});
            for(const ip of ["127.0.0.1", "10.0.0.1", "::1"]) {
                expect(filter.decide(ip, {kind: "tunnel", port: 1, protocol: "tcp"})).toEqual({
                    allowed: false,
                    reason: "geo-deny"
                });
            }
            expect(filter.stats().lookups).toBe(before);
        });

        it("skips geo enforcement for the admin scope when applyToAdmin is false", () => {
            filter.configure({mode: "deny", countries: [], applyToAdmin: false, unknownPolicy: "deny"});
            expect(filter.decide("127.0.0.1", {kind: "admin"})).toEqual({allowed: true});
            expect(filter.decide("127.0.0.1", {kind: "tunnel", port: 1, protocol: "tcp"})).toEqual({
                allowed: false,
                reason: "geo-deny"
            });
        });
    });
});
