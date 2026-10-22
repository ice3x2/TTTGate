import {withHttpDuplex} from "./http-duplex-fixture";

const get = (url: string, host = "public.example") => `GET /${url} HTTP/1.1\r\nHost: ${host}\r\n\r\n`;
const response = (body: string) => `HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

test("next request during partial response cannot corrupt response body", async () => withHttpDuplex(async f => {
    f.client.write(get("one")); await f.until(() => f.requests().includes("GET /one"));
    f.upstream.write("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nAAAAA");
    await f.until(() => f.responses().includes("AAAAA"));
    f.client.write(get("two")); await f.until(() => f.requests().includes("GET /two"));
    f.upstream.write("BBBBB" + response("SECOND"));
    await f.until(() => f.responses().includes("SECOND"));
    expect(f.responses().toString()).toBe(response("AAAAABBBBB") + response("SECOND"));
}));

test.each([false, true])("two requests before any response survive coalescing=%s", async coalesced => withHttpDuplex(async f => {
    f.client.write(get("one") + (coalesced ? get("two") : ""));
    await f.until(() => f.requests().includes("GET /one"));
    if(!coalesced) f.client.write(get("two"));
    await f.until(() => f.requests().includes("GET /two"));
    f.upstream.write(response("FIRST") + response("SECOND"));
    await f.until(() => f.responses().includes("SECOND"));
    expect(f.responses().toString()).toBe(response("FIRST") + response("SECOND"));
}));

test("100 Continue associates at headers while request body is still pending", async () => withHttpDuplex(async f => {
    f.client.write("POST /upload HTTP/1.1\r\nHost: first.example\r\nExpect: 100-continue\r\nContent-Length: 6\r\n\r\n");
    await f.until(() => f.requests().includes("Expect:"));
    f.upstream.write("HTTP/1.1 100 Continue\r\n\r\n");
    await f.until(() => f.responses().includes("100 Continue\r\n\r\n"));
    f.client.write("ABC"); await f.until(() => f.requests().includes("ABC"));
    f.client.write("DEF" + get("next")); await f.until(() => f.requests().includes("GET /next"));
    f.upstream.write(response("ONE") + response("TWO"));
    await f.until(() => f.responses().includes("TWO"));
    expect(f.requests().toString()).toContain("\r\n\r\nABCDEFGET /next");
    expect(f.responses().toString()).toBe("HTTP/1.1 100 Continue\r\n\r\n" + response("ONE") + response("TWO"));
}));

test("early final rejection does not consume unfinished upload bytes as response", async () => withHttpDuplex(async f => {
    f.client.write("POST /upload HTTP/1.1\r\nHost: public.example\r\nContent-Length: 6\r\n\r\nABC");
    await f.until(() => f.requests().includes("ABC"));
    f.upstream.write("HTTP/1.1 413 Content Too Large\r\nContent-Length: 0\r\n\r\n");
    await f.until(() => f.responses().includes("413"));
    f.client.write("DEF" + get("next")); await f.until(() => f.requests().includes("GET /next"));
    f.upstream.write(response("OK")); await f.until(() => f.responses().includes("\r\n\r\nOK"));
    expect(f.requests().toString()).toContain("ABCDEFGET /next");
    expect(f.responses().toString()).not.toContain("DEF");
}));

test("response rewrite context remains tied to its request across 1xx and later headers", async () => withHttpDuplex(async f => {
    f.client.write(get("first", "first.example") + get("second", "second.example"));
    await f.until(() => f.requests().includes("GET /second"));
    const text = "http://internal.example/path";
    const html = `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${text.length}\r\n\r\n${text}`;
    f.upstream.write("HTTP/1.1 103 Early Hints\r\n\r\n" + html + html);
    await f.until(() => f.responses().includes("second.example/path"));
    expect(f.responses().toString()).toContain("first.example/path");
    expect(f.responses().toString()).not.toContain("internal.example/path");
}, true));

test("128 pending slots admit requests, 129th is not forwarded and closes without response", async () => withHttpDuplex(async f => {
    f.client.write(Array.from({length: 128}, (_, i) => get(String(i))).join(""));
    await f.until(() => f.requests().includes("GET /127 "));
    f.client.write(get("overflow")); await f.until(() => f.client.destroyed);
    expect(f.requests().toString()).not.toContain("overflow");
    expect(f.responses().length).toBe(0);
    expect(f.ownerCalls()).toBe(1);
}));

test("final responses release pending slots and termination releases the owner", async () => withHttpDuplex(async f => {
    f.client.write(Array.from({length: 128}, (_, i) => get(String(i))).join(""));
    await f.until(() => f.requests().includes("GET /127 "));
    f.upstream.write(Array.from({length: 128}, () => response("x")).join(""));
    await f.until(() => f.responses().toString().split("200 OK").length === 129);
    f.client.write(get("reused")); await f.until(() => f.requests().includes("GET /reused "));
    f.client.destroy(); await f.until(() => f.ownerCalls() === 1);
}));

test("split headers and body preserve the next-message tail", async () => withHttpDuplex(async f => {
    f.client.write("GET /one HTTP/1.1\r\nHost: public.example\r\n");
    f.client.write("\r\n" + get("two")); await f.until(() => f.requests().includes("GET /two"));
    f.upstream.write("HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nA");
    await f.until(() => f.responses().includes("\r\n\r\nA"));
    f.upstream.write("BCDHTTP/1.1 200 OK\r\nContent-Length: 2\r\n");
    f.upstream.write("\r\nEF"); await f.until(() => f.responses().includes("\r\n\r\nEF"));
    expect(f.responses().toString()).toBe(response("ABCD") + response("EF"));
}));

test("HEAD response with a representation length does not consume the next response or emit a body", async () => withHttpDuplex(async f => {
    f.client.write("HEAD /one HTTP/1.1\r\nHost: public.example\r\n\r\n" + get("two"));
    await f.until(() => f.requests().includes("GET /two"));
    const head = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 100\r\n\r\n";
    f.upstream.write(head + response("SECOND"));
    await f.until(() => f.responses().includes("SECOND"));
    expect(f.responses().toString()).toBe(head + response("SECOND"));
}, true));

test("upgraded connection forwards binary bytes in both directions without HTTP parsing", async () => withHttpDuplex(async f => {
    f.client.write("GET /socket HTTP/1.1\r\nHost: public.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
    await f.until(() => f.requests().includes("Sec-WebSocket-Version"));
    const upgrade = "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n";
    const inbound = Buffer.from([0x82, 3, 0, 0xff, 0x81]);
    f.upstream.write(Buffer.concat([Buffer.from(upgrade), inbound]));
    await f.until(() => f.responses().includes(inbound));
    const outbound = Buffer.from([0x82, 2, 0xfe, 0]);
    f.client.write(outbound); await f.until(() => f.requests().includes(outbound));
    expect(f.responses().subarray(-inbound.length)).toEqual(inbound);
    expect(f.requests().subarray(-outbound.length)).toEqual(outbound);
}));

test.each([false, true])("rejected WebSocket upgrade keeps the next Host request in the HTTP response FIFO (pipelined=%s)", async pipelined => withHttpDuplex(async f => {
    f.client.write("GET /socket HTTP/1.1\r\nHost: rejected.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
    await f.until(() => f.requests().includes("Sec-WebSocket-Version"));
    expect(f.handler.isWebSocket).toBe(false);
    if(pipelined) {
        f.client.write(get("normal", "next.example"));
        await f.until(() => f.requests().includes("GET /normal"));
    }
    const rejected = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n";
    f.upstream.write(rejected);
    await f.until(() => f.responses().includes("403 Forbidden"));
    if(!pipelined) f.client.write(get("normal", "next.example"));
    await f.until(() => f.requests().includes("GET /normal"));
    const body = "http://internal.example/after-rejection";
    f.upstream.write(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
    await f.until(() => f.responses().includes("/after-rejection"));
    expect(f.requests().toString()).not.toContain("Host: next.example");
    expect(f.responses().toString()).toContain("http://next.example/after-rejection");
    expect(f.responses().toString()).not.toContain("http://rejected.example/after-rejection");
    expect(f.handler.isWebSocket).toBe(false);
}, true));

test("accepted upgrade EOF clears contexts, closes upstream and notifies its owner once", async () => withHttpDuplex(async f => {
    f.client.write("GET /socket HTTP/1.1\r\nHost: public.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
    await f.until(() => f.requests().includes("Sec-WebSocket-Version"));
    f.upstream.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
    await f.until(() => f.responses().includes("101 Switching Protocols"));
    expect(f.handler.isWebSocket).toBe(true);
    f.client.destroy();
    await f.until(() => f.ownerCalls() === 1);
    expect((f.handler as any)._pendingRequests).toHaveLength(0);
    expect(f.handler.isWebSocket).toBe(false);
    await f.until(() => f.upstream.destroyed);
    f.handler.destroy();
    expect(f.ownerCalls()).toBe(1);
}));
