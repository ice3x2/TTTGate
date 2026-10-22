import * as net from "net";

type ParsedServerAddress = {ok: true, host: string, port?: number, scheme?: "tls" | "tcp"};
type ServerAddressResult = ParsedServerAddress | {ok: false, message: string};

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;

/**
 * 서버 주소 해석(#202·#211). `-addr`, `client join <addr>` 이 함께 쓴다.
 *
 * 받는 형식: host, host:port, IPv4[:port], [IPv6][:port], 대괄호 없는 IPv6(포트 없음),
 * 그리고 앞에 붙는 tls:// 또는 tcp://. 경로·쿼리는 받지 않는다.
 */
const parseServerAddress = (input: string): ServerAddressResult => {
    const fail = (reason: string): ServerAddressResult => ({ok: false, message: `invalid server address ${JSON.stringify(input)}: ${reason}`});
    let rest = input.trim();
    let scheme: "tls" | "tcp" | undefined;
    const schemeMatch = SCHEME.exec(rest);
    if(schemeMatch) {
        const name = schemeMatch[1].toLowerCase();
        if(name !== "tls" && name !== "tcp") return fail(`unsupported scheme '${schemeMatch[1]}://' (use tls:// or tcp://)`);
        scheme = name;
        rest = rest.substring(schemeMatch[0].length);
    }
    if(/[/?#]/.test(rest)) return fail("a path or query is not allowed");

    let host: string;
    let portText: string | undefined;
    if(rest.startsWith("[")) {
        const close = rest.indexOf("]");
        if(close < 0) return fail("missing ']'");
        host = rest.substring(1, close);
        const after = rest.substring(close + 1);
        if(after.length > 0) {
            if(!after.startsWith(":")) return fail("unexpected text after ']'");
            portText = after.substring(1);
        }
        if(!net.isIPv6(host)) return fail("the bracketed host is not an IPv6 address");
    } else {
        const colons = rest.split(":").length - 1;
        if(colons > 1) {
            if(!net.isIPv6(rest)) return fail("too many ':' (write IPv6 addresses as [addr]:port)");
            host = rest;
        } else if(colons === 1) {
            const idx = rest.indexOf(":");
            host = rest.substring(0, idx);
            portText = rest.substring(idx + 1);
        } else {
            host = rest;
        }
    }
    if(host.length === 0) return fail("the host is empty");

    const result: ParsedServerAddress = {ok: true, host};
    if(portText !== undefined) {
        const port = /^\d+$/.test(portText) ? Number(portText) : NaN;
        if(!Number.isInteger(port) || port < 1 || port > 65535) return fail("the port must be a number from 1 to 65535");
        result.port = port;
    }
    if(scheme) result.scheme = scheme;
    return result;
};

/** 주소를 사람이 읽는 형식으로 되돌린다. IPv6 는 대괄호로 감싼다. */
const formatServerAddress = (host: string, port: number): string => `${net.isIPv6(host) ? `[${host}]` : host}:${port}`;

export {parseServerAddress, formatServerAddress, ParsedServerAddress, ServerAddressResult};
