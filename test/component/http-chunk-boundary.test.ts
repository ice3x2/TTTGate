import {HttpPipe, MessageType} from "../../src/server/http/HttpPipe";
import {withHttpDuplex} from "./http-duplex-fixture";
import http from "node:http";

const header = "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nTransfer-Encoding: chunked\r\n\r\n";
const bodies = ["0\r\n\r\n", "5\r\nhello\r\n0\r\n\r\n", "5;name=value\r\nhello\r\n0\r\nX-Checksum: abc\r\nX-End: yes\r\n\r\n"];

test.each(bodies)("raw chunked framing is byte-exact across every split: %j", body => {
    for(let split = 0; split <= body.length; split++) {
        const pipe = new HttpPipe(); pipe.reset(MessageType.Response);
        const delivered: Buffer[] = [], errors: Error[] = [];
        let ended = 0;
        pipe.onHeaderCallback = () => {};
        pipe.onDataCallback = data => { delivered.push(Buffer.from(data)); return true; };
        pipe.onEndCallback = () => { ended++; };
        pipe.onErrorCallback = error => errors.push(error);
        pipe.write(Buffer.from(header + body.slice(0, split)));
        pipe.write(Buffer.from(body.slice(split)));
        expect({split, errors: errors.map(error => error.message), ended, bytes: Buffer.concat(delivered).toString()})
            .toEqual({split, errors: [], ended: 1, bytes: body});
    }
});

test.each([false, true])("real chunked response retains trailers and next response tail (split=%s)", async split => withHttpDuplex(async f => {
    f.client.write("GET /one HTTP/1.1\r\nHost: first.example\r\n\r\nGET /two HTTP/1.1\r\nHost: second.example\r\n\r\n");
    await f.until(() => f.requests().includes("GET /two"));
    const chunked = bodies[2];
    if(split) {
        f.upstream.write(header + "5;name=value\r\nhello");
        await f.until(() => f.responses().includes("5;name=value\r\n"));
        f.upstream.write("\r");
        f.upstream.write("\n0\r\nX-Checksum: abc\r\nX-End: yes\r\n\r");
        f.upstream.write("\n");
    } else f.upstream.write(header + chunked);
    const next = "HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nNEXT";
    f.upstream.write(next);
    await f.until(() => f.responses().includes("NEXT"));
    expect(f.responses()).toEqual(Buffer.from(header + chunked + next));
    expect((f.handler as any)._pendingRequests).toHaveLength(0);
}));

test("decoded chunk payload excludes framing and trailers even with byte-at-a-time input", () => {
    const pipe = new HttpPipe(); pipe.reset(MessageType.Response);
    const data: Buffer[] = [];
    let ended = 0;
    pipe.onHeaderCallback = () => pipe.setDeliverPureData(true);
    pipe.onDataCallback = value => { data.push(Buffer.from(value)); return true; };
    pipe.onEndCallback = () => { ended++; };
    pipe.onErrorCallback = error => { throw error; };
    for(const byte of Buffer.from(header + bodies[2])) pipe.write(Buffer.from([byte]));
    expect(Buffer.concat(data)).toEqual(Buffer.from("hello"));
    expect(ended).toBe(1);
});

test.each([bodies[0], bodies[2]])("real chunked request preserves its complete boundary before the next request: %j", async body => withHttpDuplex(async f => {
    const request = "POST /upload HTTP/1.1\r\nHost: public.example\r\nTransfer-Encoding: chunked\r\n\r\n";
    const next = "GET /next HTTP/1.1\r\nHost: public.example\r\n\r\n";
    f.client.write(request + body + next);
    await f.until(() => f.requests().includes("GET /next"));
    expect(f.requests()).toEqual(Buffer.from((request + body + next).replaceAll("Host: public.example", "Host: internal.example")));
}));

test("raw binary chunk payload and terminal CRLF cross real sockets unchanged", async () => withHttpDuplex(async f => {
    f.client.write("GET /image HTTP/1.1\r\nHost: public.example\r\n\r\n");
    await f.until(() => f.requests().includes("GET /image"));
    const expected = Buffer.concat([Buffer.from(header + "3\r\n"), Buffer.from([0, 0xff, 0x80]), Buffer.from("\r\n0\r\n\r\n")]);
    f.upstream.write(expected);
    await f.until(() => f.responses().length >= expected.length);
    expect(f.responses()).toEqual(expected);
}));

test("Node keep-alive HTTP client completes chunked response while upstream stays open", async () => withHttpDuplex(async f => {
    const agent = new http.Agent({keepAlive: true});
    // Attach the real HTTP parser to the fixture's already-connected client socket.
    agent.createConnection = () => f.client;
    const request = http.request({host: "127.0.0.1", port: f.client.remotePort, path: "/image", agent});
    const completed = new Promise<{body: Buffer, trailers: http.IncomingHttpHeaders, complete: boolean, upstreamOpenAtEnd: boolean}>((resolve, reject) => {
        request.once("error", reject);
        request.once("response", response => {
            const chunks: Buffer[] = [];
            response.on("data", data => chunks.push(Buffer.from(data)));
            response.once("error", reject);
            response.once("end", () => resolve({body: Buffer.concat(chunks), trailers: response.trailers,
                complete: response.complete, upstreamOpenAtEnd: !f.upstream.destroyed && !f.upstream.readableEnded && !f.upstream.writableEnded}));
        });
        request.setTimeout(2000, () => request.destroy(new Error("HTTP response did not complete on keep-alive connection")));
    });
    completed.catch(() => {}); // Teardown also observes failures if setup exits early.
    try {
        request.end();
        await f.until(() => f.requests().includes("GET /image"));
        expect(f.requests().toString().toLowerCase()).toContain("connection: keep-alive");
        f.upstream.write(header + bodies[2]); // Deliberately no upstream end()/FIN.
        const result = await completed;
        expect(result).toMatchObject({body: Buffer.from("hello"), complete: true, upstreamOpenAtEnd: true,
            trailers: {"x-checksum": "abc", "x-end": "yes"}});
        expect(f.client.destroyed).toBe(false);
    } finally { request.destroy(); agent.destroy(); await completed.catch(() => {}); }
}));
