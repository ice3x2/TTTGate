import {ipv6Groups, normalizeRemoteAddress, isPrivateAddress} from "../../../../src/server/security/address";

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

// #288 — IPv6 주소를 16비트 그룹 8개로 펴는 공용 함수. 레이트 리밋 버킷과 차단 목록 정규화가 함께 쓴다.
describe("ipv6Groups", () => {
    it.each([
        ["::", [0, 0, 0, 0, 0, 0, 0, 0]],
        ["2001:DB8::1", [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]],
        ["2001:db8:1:2:3:4:5:6", [0x2001, 0xdb8, 1, 2, 3, 4, 5, 6]],
        ["::ffff:1.2.3.4", [0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]],
        ["64:ff9b::192.0.2.33", [0x64, 0xff9b, 0, 0, 0, 0, 0xc000, 0x0221]],
        ["fe80::", [0xfe80, 0, 0, 0, 0, 0, 0, 0]]
    ])("%s 를 펴 그룹 8개로 돌려준다", (input, expected) => {
        expect(ipv6Groups(input)).toEqual(expected);
    });

    it.each([["1.2.3.4"], ["foo:bar"], ["1:2"], [":::"], ["fe80::1%eth0"], [""]])("IPv6 가 아닌 %p 는 undefined 다", (input) => {
        expect(ipv6Groups(input)).toBeUndefined();
    });
});
