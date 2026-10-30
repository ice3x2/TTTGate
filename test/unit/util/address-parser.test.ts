import {parseServerAddress} from "../../../src/util/AddressParser";

// #202 IPv6 와 포트 검사, #211 tls:// · tcp:// 스킴
describe("parseServerAddress", () => {
    test.each([
        ["example.com", {host: "example.com"}],
        ["example.com:9126", {host: "example.com", port: 9126}],
        ["10.0.0.1", {host: "10.0.0.1"}],
        ["10.0.0.1:443", {host: "10.0.0.1", port: 443}],
        ["[::1]", {host: "::1"}],
        ["[::1]:9126", {host: "::1", port: 9126}],
        ["[2001:db8::7]:1", {host: "2001:db8::7", port: 1}],
        ["::1", {host: "::1"}],
        ["2001:db8::7", {host: "2001:db8::7"}],
        ["tls://gw.example.com:9126", {host: "gw.example.com", port: 9126, scheme: "tls"}],
        ["TCP://gw.example.com", {host: "gw.example.com", scheme: "tcp"}],
        ["tls://[::1]:9126", {host: "::1", port: 9126, scheme: "tls"}]
    ])("%s", (input, expected) => {
        expect(parseServerAddress(input)).toEqual({ok: true, ...expected});
    });

    test.each([
        "host:", "host:abc", "host:0", "host:65536", "[::1]:", "[::1", "[::1]x", "", ":9126",
        "http://example.com", "tls://example.com/path", "tls://example.com?x=1", "tls://"
    ])("rejects %s", (input) => {
        const result = parseServerAddress(input);
        expect(result.ok).toBe(false);
        if(!result.ok) expect(result.message).toContain(JSON.stringify(input));
    });
});
