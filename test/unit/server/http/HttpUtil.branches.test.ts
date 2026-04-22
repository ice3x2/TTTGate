/**
 * HttpUtil / HttpPipe 광역 단위 테스트.
 *
 * 목적: Phase 4 에서 collectCoverageFrom 에 추가된 src/server/http/HttpPipe.ts,
 * src/server/http/HttpUtil.ts 의 분기 커버리지를 확보하기 위한 정직 범위 단위 검사.
 * Mock 금지 — 순수 함수/버퍼 조작만 사용.
 */
import { HttpPipe, HttpMethod, MessageType, HttpRequestHeader, HttpResponseHeader, HttpHeader } from "../../../../src/server/http/HttpPipe";
import HttpUtil from "../../../../src/server/http/HttpUtil";
import zlib from "zlib";

function buildRequestHeader(headers: Array<{name: string, value: string}> = []): HttpRequestHeader {
    return {
        type: MessageType.Request,
        method: HttpMethod.GET,
        path: "/",
        version: "HTTP/1.1",
        headers: headers.slice(),
        contentLength: -1,
        upgrade: false,
        chunked: false,
        keepAlive: true,
        connection: ""
    } as HttpRequestHeader;
}

function buildResponseHeader(headers: Array<{name: string, value: string}> = []): HttpResponseHeader {
    return {
        type: MessageType.Response,
        version: "HTTP/1.1",
        status: 200,
        statusText: "OK",
        headers: headers.slice(),
        contentLength: -1,
        upgrade: false,
        chunked: false,
        keepAlive: true,
        connection: ""
    } as HttpResponseHeader;
}

describe("HttpUtil branch coverage", () => {
    it("findHeader / findHeaders / findHeaderValue / removeHeader 기본 분기", () => {
        const h = buildRequestHeader([
            { name: "X-Foo", value: "a" },
            { name: "x-foo", value: "b" },
            { name: "Host", value: "ok" }
        ]);
        expect(HttpUtil.findHeaderValue(h, "host")).toBe("ok");
        expect(HttpUtil.findHeaderValue(h, "missing")).toBeNull();
        expect(HttpUtil.findHeaders(h, "x-foo").length).toBe(2);
        HttpUtil.removeHeader(h, "X-FOO");
        expect(HttpUtil.findHeaders(h, "x-foo").length).toBe(0);
    });

    it("isTextContentType true/false 분기", () => {
        expect(HttpUtil.isTextContentType(buildRequestHeader([{name:"Content-Type",value:"text/html"}]))).toBe(true);
        expect(HttpUtil.isTextContentType(buildRequestHeader([{name:"Content-Type",value:"application/json; charset=utf-8"}]))).toBe(true);
        expect(HttpUtil.isTextContentType(buildRequestHeader([{name:"Content-Type",value:"application/octet-stream"}]))).toBe(false);
        expect(HttpUtil.isTextContentType(buildRequestHeader([]))).toBe(false);
    });

    it("isChunked true/false", () => {
        expect(HttpUtil.isChunked(buildRequestHeader([{name:"Transfer-Encoding",value:"chunked"}]))).toBe(true);
        expect(HttpUtil.isChunked(buildRequestHeader([{name:"Transfer-Encoding",value:"gzip"}]))).toBe(false);
        expect(HttpUtil.isChunked(buildRequestHeader([]))).toBe(false);
    });

    it("isKeepAlive 분기: HTTP/1.1 default, close 지시, keep-alive 지시", () => {
        expect(HttpUtil.isKeepAlive(buildRequestHeader([]), "HTTP/1.1")).toBe(true);
        expect(HttpUtil.isKeepAlive(buildRequestHeader([]), "HTTP/1.0")).toBe(false);
        expect(HttpUtil.isKeepAlive(buildRequestHeader([{name:"Connection",value:"close"}]), "HTTP/1.1")).toBe(false);
        expect(HttpUtil.isKeepAlive(buildRequestHeader([{name:"Connection",value:"keep-alive"}]), "HTTP/1.0")).toBe(true);
    });

    it("getKeepAliveTimeout 파싱", () => {
        expect(HttpUtil.getKeepAliveTimeout(buildRequestHeader([{name:"Keep-Alive",value:"timeout=30, max=100"}]))).toBe(30);
        expect(HttpUtil.getKeepAliveTimeout(buildRequestHeader([]))).toBeNull();
        expect(HttpUtil.getKeepAliveTimeout(buildRequestHeader([{name:"Keep-Alive",value:"max=100"}]))).toBeNull();
    });

    it("isWebSocketUpgrade 분기", () => {
        const yes = buildRequestHeader([
            { name: "Connection", value: "Upgrade" },
            { name: "Upgrade", value: "websocket" }
        ]);
        expect(HttpUtil.isWebSocketUpgrade(yes)).toBe(true);
        expect(HttpUtil.isWebSocketUpgrade(buildRequestHeader([]))).toBe(false);
    });

    it("setContentLength / setTransferEncoding / addChunkedEncoding", () => {
        const h = buildRequestHeader([{name:"Content-Length",value:"10"}]);
        HttpUtil.setContentLength(h, 42);
        expect(HttpUtil.findHeaderValue(h, "content-length")).toBe("42");
        expect(h.contentLength).toBe(42);

        HttpUtil.setTransferEncoding(h, "chunked");
        expect(h.chunked).toBe(true);
        HttpUtil.setTransferEncoding(h, "gzip");
        expect(h.chunked).toBe(false);

        HttpUtil.addChunkedEncoding(h);
        expect(h.chunked).toBe(true);
        expect(h.contentLength).toBe(-1);
    });

    it("URL 유틸 분기", () => {
        expect(HttpUtil.parseUrl("http://a/b")).not.toBeNull();
        expect(HttpUtil.parseUrl("/relative/path")).not.toBeNull();
        expect(HttpUtil.parseUrl("ht tp:/// no host")).toBeNull();

        const req = buildRequestHeader([{name:"Host",value:"a.example"}]);
        req.path = "/p";
        expect(HttpUtil.getUrlFromRequest(req)?.host).toBe("a.example");
        req.path = "http://abs.example/x";
        expect(HttpUtil.getUrlFromRequest(req)?.host).toBe("abs.example");

        const params = HttpUtil.parseUrlParams("/x?a=1&b=2");
        expect(params.a).toBe("1");
        expect(params.b).toBe("2");
    });

    it("methodCanHaveBody / getCookieValue", () => {
        expect(HttpUtil.methodCanHaveBody(HttpMethod.POST)).toBe(true);
        expect(HttpUtil.methodCanHaveBody(HttpMethod.GET)).toBe(false);
        const h = buildRequestHeader([{name:"Cookie",value:"a=1; b=two; c=3"}]);
        expect(HttpUtil.getCookieValue(h, "b")).toBe("two");
        expect(HttpUtil.getCookieValue(h, "missing")).toBeNull();
        expect(HttpUtil.getCookieValue(buildRequestHeader([]), "x")).toBeNull();
    });

    it("WebSocket URL 변환", () => {
        expect(HttpUtil.wsUrlToHttpUrl("ws://a/b")).toBe("http://a/b");
        expect(HttpUtil.wsUrlToHttpUrl("wss://a/b")).toBe("https://a/b");
        expect(HttpUtil.wsUrlToHttpUrl("http://a/b")).toBe("http://a/b");
        expect(HttpUtil.httpUrlToWsUrl("http://a/b")).toBe("ws://a/b");
        expect(HttpUtil.httpUrlToWsUrl("https://a/b")).toBe("wss://a/b");
        expect(HttpUtil.httpUrlToWsUrl("ftp://a/b")).toBe("ftp://a/b");
        expect(HttpUtil.isWebSocketUrl("ws://a")).toBe(true);
        expect(HttpUtil.isSecureWebSocketUrl("wss://a")).toBe(true);
        expect(HttpUtil.isSecureWebSocketUrl("ws://a")).toBe(false);
    });

    it("compress/uncompress 라운드 트립 (gzip/deflate/br)", () => {
        const body = Buffer.from("hello world ".repeat(40));
        for (const enc of ["gzip", "deflate", "br"]) {
            const compressed = HttpUtil.compressBody(enc, body);
            const back = HttpUtil.uncompressBody(enc, compressed);
            expect(back.toString()).toBe(body.toString());
        }
        // 빈 body / null encoding 분기.
        expect(HttpUtil.uncompressBody(null, body).toString()).toBe(body.toString());
        expect(HttpUtil.compressBody(null, body).toString()).toBe(body.toString());
        expect(HttpUtil.uncompressBody("gzip", Buffer.alloc(0)).length).toBe(0);
    });

    it("convertHttpHeaderToBuffer 정상/응답 분기", () => {
        const reqBuf = HttpUtil.convertHttpHeaderToBuffer(buildRequestHeader([{name:"Host",value:"a"}]));
        expect(reqBuf.toString()).toMatch(/^GET \/ HTTP\/1\.1\r\nHost: a\r\n\r\n$/);

        const resBuf = HttpUtil.convertHttpHeaderToBuffer(buildResponseHeader([{name:"Content-Type",value:"text/plain"}]));
        expect(resBuf.toString()).toMatch(/^HTTP\/1\.1 200 OK\r\nContent-Type: text\/plain\r\n\r\n$/);
    });
});

describe("HttpPipe branch coverage", () => {
    function makePipe(type: MessageType = MessageType.Request) {
        const pipe = type === MessageType.Request
            ? HttpPipe.createHttpRequestPipe()
            : (() => { const p = new HttpPipe(); p.reset(MessageType.Response); return p; })();
        const state: any = { errors: [], headers: [], data: [] as Buffer[], end: false };
        pipe.onErrorCallback = (e) => state.errors.push(e);
        pipe.onHeaderCallback = (h) => state.headers.push(h);
        pipe.onDataCallback = (d) => { state.data.push(Buffer.from(d)); return true; };
        pipe.onEndCallback = () => { state.end = true; };
        return { pipe, state };
    }

    it("GET 요청 (no body) → 즉시 종료", () => {
        const { pipe, state } = makePipe();
        pipe.write(Buffer.from("GET /x HTTP/1.1\r\nHost: a\r\n\r\n"));
        expect(state.errors.length).toBe(0);
        expect(state.end).toBe(true);
        expect(state.headers[0].method).toBe(HttpMethod.GET);
    });

    it("POST + Content-Length body 수신 완료", () => {
        const { pipe, state } = makePipe();
        pipe.write(Buffer.from("POST /x HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r\nhello"));
        expect(state.errors.length).toBe(0);
        expect(state.end).toBe(true);
        expect(Buffer.concat(state.data).toString()).toBe("hello");
    });

    it("HTTP/1.0 no-CL → UNKNOWN_LENGTH_BODY 경로", () => {
        const { pipe, state } = makePipe();
        pipe.write(Buffer.from("POST /x HTTP/1.0\r\nHost: a\r\n\r\npartial-body"));
        expect(state.errors.length).toBe(0);
        // UNKNOWN_LENGTH_BODY 경로에서는 end 되지 않고 데이터 전달.
        expect(Buffer.concat(state.data).toString()).toContain("partial-body");
    });

    it("Response 파싱: HTTP/1.1 200", () => {
        const { pipe, state } = makePipe(MessageType.Response);
        pipe.write(Buffer.from("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"));
        expect(state.errors.length).toBe(0);
        expect(state.headers[0].status).toBe(200);
        expect(state.end).toBe(true);
    });

    it("Upgrade: websocket 경로", () => {
        const { pipe, state } = makePipe();
        const payload = "GET /ws HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nRAW-FRAME";
        pipe.write(Buffer.from(payload));
        expect(state.errors.length).toBe(0);
        expect(state.headers[0].upgrade).toBe(true);
        expect(Buffer.concat(state.data).toString()).toContain("RAW-FRAME");
    });

    it("Chunked 완전한 본문 파싱 + trailer 없음", () => {
        const { pipe, state } = makePipe();
        const payload =
            "POST /x HTTP/1.1\r\n" +
            "Host: a\r\nTransfer-Encoding: chunked\r\n\r\n" +
            "5\r\nhello\r\n" +
            "0\r\n\r\n";
        pipe.write(Buffer.from(payload));
        expect(state.errors.length).toBe(0);
        expect(state.end).toBe(true);
    });

    it("Invalid method → 에러", () => {
        const { pipe, state } = makePipe();
        pipe.write(Buffer.from("FOOBAR / HTTP/1.1\r\nHost: a\r\n\r\n"));
        expect(state.errors.length).toBeGreaterThanOrEqual(1);
    });

    it("Invalid response protocol → 에러", () => {
        const { pipe, state } = makePipe(MessageType.Response);
        pipe.write(Buffer.from("FOO/1.1 200 OK\r\n\r\n"));
        expect(state.errors.length).toBeGreaterThanOrEqual(1);
    });

    it("reset() 동작", () => {
        const { pipe } = makePipe();
        pipe.write(Buffer.from("GET /x HTTP/1.1\r\nHost: a\r\n\r\n"));
        pipe.reset(MessageType.Request);
        expect(pipe.bufferSize).toBe(0);
        expect(pipe.messageType).toBe(MessageType.Request);
    });
});
