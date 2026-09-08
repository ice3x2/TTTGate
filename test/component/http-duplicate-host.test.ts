import {withHttpDuplex} from './http-duplex-fixture';
import {HttpPipe, MessageType} from '../../src/server/http/HttpPipe';

const get = (path: string) => `GET /${path} HTTP/1.1\r\nHost: public.example\r\n\r\n`;
const bad = (second = 'other') => `POST /bad HTTP/1.1\r\nHost: public.example\r\nhOsT: ${second}\r\nContent-Length: 4\r\n\r\nBODY${get('tail')}`;
const ok = (body: string) => `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
const reject = 'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n';

test('owned peer closes while rejection waits without a late400 or repeated cleanup', async () => withHttpDuplex(async f => {
    f.client.write(get('waiting') + bad());
    await f.until(() => (f.handler as any)._inputRejected === true);
    expect((f.handler as any)._pendingRequests).toHaveLength(1);
    expect(f.responses()).toHaveLength(0);
    f.client.destroy();
    await f.until(() => f.ownerCalls() === 1 && f.upstream.destroyed);
    expect((f.handler as any)._pendingRequests).toHaveLength(0);
    expect((f.handler as any)._inputRejected).toBe(false);
    expect((f.handler as any)._rejectionSent).toBe(false);
    // A late finite response callback after real terminal cleanup is ignored.
    f.handler.sendData(Buffer.from(ok('late')));
    f.handler.destroy();
    expect(f.responses()).toHaveLength(0);
    expect(f.ownerCalls()).toBe(1);
}));

test('declared400 write failure destroys the owner once and clears rejection state', async () => withHttpDuplex(async f => {
    const raw = (f.handler as any)._socketHandler;
    const send = raw.sendData;
    let rejectedWrites = 0;
    // Explicit callback fault injection, not a claim of a reproduced OS write error.
    raw.sendData = function(data: Buffer, callback?: (handler: unknown, success: boolean) => void) {
        if(data.equals(Buffer.from(reject))) {
            rejectedWrites++;
            callback?.(this, false);
            return;
        }
        return send.call(this, data, callback);
    };
    try {
        f.client.write(bad());
        await f.until(() => f.client.destroyed && f.ownerCalls() === 1);
        expect(raw.socket.destroyed).toBe(true);
        expect(rejectedWrites).toBe(1);
        expect((f.handler as any)._pendingRequests).toHaveLength(0);
        expect((f.handler as any)._inputRejected).toBe(false);
        expect((f.handler as any)._rejectionSent).toBe(false);
        expect(f.requests()).toHaveLength(0);
        expect(f.responses()).toHaveLength(0);
        f.handler.sendData(Buffer.from(ok('late')));
        f.handler.destroy();
        expect(rejectedWrites).toBe(1);
        expect(f.ownerCalls()).toBe(1);
    } finally { raw.sendData = send; }
}));

test.each(['other', 'public.example'])('duplicate %s gets exact400 without forwarding body/tail', async second => withHttpDuplex(async f => {
    f.client.write(bad(second));
    await f.until(() => f.client.readableEnded);
    expect(f.responses().toString()).toBe(reject); expect(f.requests().length).toBe(0);
    await f.until(() => f.ownerCalls() === 1);
    expect((f.handler as any)._pendingRequests.length).toBe(0);
    expect((f.handler as any)._inputRejected).toBe(false);
    expect((f.handler as any)._rejectionSent).toBe(false);
}));

test('request rejection callback once before any header and no retained repeated input', () => {
    const pipe = HttpPipe.createHttpRequestPipe() as any;
    const reasons: string[] = []; let headers = 0, bodies = 0;
    pipe.onRequestRejected = (reason: string) => reasons.push(reason);
    pipe.onHeaderCallback = () => headers++;
    pipe.onDataCallback = () => { bodies++; return true; };
    const frame = Buffer.from(bad());
    const boundary = frame.indexOf('hOsT') + 2;
    pipe.write(frame.subarray(0, boundary)); expect(reasons).toHaveLength(0); expect(headers).toBe(0);
    pipe.write(frame.subarray(boundary)); pipe.write(Buffer.from(bad()));
    expect(reasons).toEqual(['duplicate-host']); expect({headers, bodies, bytes: pipe.bufferSize}).toEqual({headers: 0, bodies: 0, bytes: 0});
});

test.each([false, true])('all prior finite responses precede400 chunked=%s with informational and response tail', async chunked => withHttpDuplex(async f => {
    f.client.write(get('one') + get('two'));
    await f.until(() => f.requests().toString().endsWith('Host: internal.example\r\n\r\n') && f.requests().includes('/two'));
    const info = 'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 103 Early Hints\r\n\r\n';
    const first = chunked ? 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nAB\r\n0\r\n\r\n' : ok('AB');
    const split = chunked ? first.indexOf('0\r\n\r\n') : first.indexOf('AB') + 1;
    f.upstream.write(info + first.slice(0, split));
    await f.until(() => f.responses().includes(first.slice(0, split)));
    f.client.write(bad());
    // Request parser buffer/rejection observer is supplemental; all response evidence uses real sockets.
    await f.until(() => (f.handler as any)._inputRejected === true);
    expect(f.requests().toString()).not.toContain('/bad');
    expect(f.responses().toString()).not.toContain('400');
    f.upstream.write(first.slice(split) + ok('SECOND') + ok('UNSOLICITED'));
    await f.until(() => f.client.readableEnded);
    expect(f.responses().toString()).toBe(info + first + ok('SECOND') + reject);
    expect(f.requests().toString()).not.toContain('/tail');
}));

test('accepted101 with rejection pending closes before raw response', async () => withHttpDuplex(async f => {
    f.client.write('GET /ws HTTP/1.1\r\nHost: public.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n' + bad());
    await f.until(() => f.requests().includes('/ws'));
    f.upstream.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nRAW');
    await f.until(() => f.client.destroyed);
    expect(f.responses().length).toBe(0); expect(f.requests().toString()).not.toContain('/bad');
}));

test('finite rewritten response finishes before400', async () => withHttpDuplex(async f => {
    f.client.write(get('one') + bad());
    await f.until(() => (f.handler as any)._inputRejected === true);
    const body = 'http://internal.example/path';
    f.upstream.write(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
    await f.until(() => f.client.readableEnded);
    expect(f.responses().toString()).toContain('http://public.example/path');
    expect(f.responses().toString()).toMatch(/0\r\n\r\nHTTP\/1.1 400 Bad Request/);
    expect(f.responses().toString().endsWith(reject)).toBe(true);
}, true));


test('response duplicate Host and missing request Host keep their existing parser policy', () => {
    const responsePipe = new HttpPipe(); responsePipe.reset(MessageType.Response);
    let responseHeaders = 0;
    responsePipe.onHeaderCallback = () => responseHeaders++;
    responsePipe.write(Buffer.from('HTTP/1.1 200 OK\r\nHost: a\r\nHost: b\r\nContent-Length: 0\r\n\r\n'));
    expect(responseHeaders).toBe(1);
    const request = HttpPipe.createHttpRequestPipe(); let requestHeaders = 0;
    request.onHeaderCallback = () => requestHeaders++;
    request.write(Buffer.from('GET / HTTP/1.1\r\n\r\n'));
    expect(requestHeaders).toBe(1);
});
