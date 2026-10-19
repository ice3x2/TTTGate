import {normalizeRemoteAddress, isPrivateAddress} from "../../../../src/server/security/address";

describe("normalizeRemoteAddress", () => {
    it("strips the IPv4-mapped IPv6 prefix regardless of case", () => {
        expect(normalizeRemoteAddress("::ffff:1.2.3.4")).toBe("1.2.3.4");
        expect(normalizeRemoteAddress("::FFFF:1.2.3.4")).toBe("1.2.3.4");
    });

    it("strips the zone suffix", () => {
        expect(normalizeRemoteAddress("fe80::1%eth0")).toBe("fe80::1");
    });

    it("returns other addresses unchanged", () => {
        expect(normalizeRemoteAddress("8.8.8.8")).toBe("8.8.8.8");
    });
});

describe("isPrivateAddress", () => {
    const privateAddresses = [
        "10.1.2.3",
        "172.16.0.1",
        "172.31.255.255",
        "192.168.0.1",
        "127.0.0.1",
        "169.254.1.1",
        "fc00::1",
        "fd12::1",
        "::1"
    ];

    const publicAddresses = [
        "172.32.0.1",
        "8.8.8.8",
        "2001:4860::8888",
        "not-an-ip"
    ];

    it.each(privateAddresses)("treats %s as private", (ip) => {
        expect(isPrivateAddress(ip)).toBe(true);
    });

    it.each(publicAddresses)("treats %s as not private", (ip) => {
        expect(isPrivateAddress(ip)).toBe(false);
    });
});
