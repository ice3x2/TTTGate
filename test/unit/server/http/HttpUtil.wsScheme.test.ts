import HttpUtil from "../../../../src/server/http/HttpUtil";

// #175 — URL scheme 은 대소문자를 구분하지 않는다(RFC 3986 §3.1).
describe("WebSocket URL scheme case (#175)", () => {
    it.each([
        ["WS://host/path", "http://host/path"],
        ["Wss://host/path", "https://host/path"],
        ["wSs://host:8443/a?b=c", "https://host:8443/a?b=c"],
    ])("%s converts to %s", (input, expected) => {
        expect(HttpUtil.isWebSocketUrl(input)).toBe(true);
        expect(HttpUtil.wsUrlToHttpUrl(input)).toBe(expected);
    });

    it("recognises secure WebSocket URLs in any case", () => {
        expect(HttpUtil.isSecureWebSocketUrl("WSS://host")).toBe(true);
        expect(HttpUtil.isSecureWebSocketUrl("WS://host")).toBe(false);
    });

    it("converts HTTP URLs back in any case", () => {
        expect(HttpUtil.httpUrlToWsUrl("HTTPS://host/a")).toBe("wss://host/a");
        expect(HttpUtil.httpUrlToWsUrl("Http://host/a")).toBe("ws://host/a");
    });
});
