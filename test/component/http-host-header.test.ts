import {withHttpDuplex} from './http-duplex-fixture';

const response = (body: string) => `HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

// All traffic uses the existing owned real socket fixture; no EOF is needed.
test.each([['Host', 'a'], ['hOsT', 'a'], ['Host', 'public.example']])(
    'rewrites only %s for host %s and preserves subsequent finite exchange', async (name, host) => withHttpDuplex(async f => {
        const untouched = `Cookie: sid=aaa\r\nAuthorization: Bearer test-a-only\r\nUser-Agent: Mozilla/5.0\r\nX-Custom: aaa-${host}-aaa\r\n`;
        f.client.write(`GET /one HTTP/1.1\r\n${name}: ${host}\r\n${untouched}\r\n`);
        await f.until(() => f.requests().includes('\r\n\r\n'));
        expect(f.requests().toString()).toBe(`GET /one HTTP/1.1\r\n${name}: internal.example\r\n${untouched}\r\n`);
        f.upstream.write(response('FIRST'));
        await f.until(() => f.responses().length >= Buffer.byteLength(response('FIRST')));
        expect(f.responses().toString()).toBe(response('FIRST'));
        f.client.write('GET /two HTTP/1.1\r\nHost: next.example\r\n\r\n');
        await f.until(() => f.requests().includes('GET /two HTTP/1.1\r\nHost: internal.example\r\n\r\n'));
        f.upstream.write(response('SECOND'));
        await f.until(() => f.responses().length >= Buffer.byteLength(response('FIRST') + response('SECOND')));
        expect(f.responses().toString()).toBe(response('FIRST') + response('SECOND'));
        expect(f.upstream.destroyed).toBe(false);
        expect(f.client.destroyed).toBe(false);
    }));

test('response Host selection preserves unrelated values and existing explicit response policies', async () => withHttpDuplex(async f => {
    f.client.write('GET /one HTTP/1.1\r\nHost: public.example\r\n\r\n');
    await f.until(() => f.requests().includes('\r\n\r\n'));
    const other = 'X-Custom: aaa\r\nAuthorization: Bearer test-a-only\r\n';
    const tail = 'Location: http://public.example/path\r\nSet-Cookie: sid=aaa;  Path=/\r\nContent-Length: 2\r\n\r\nOK';
    f.upstream.write('HTTP/1.1 302 Found\r\nhOsT: a\r\n' + other +
        'Location: http://internal.example/path\r\nSet-Cookie: sid=aaa; Domain=internal.example; Path=/\r\nContent-Length: 2\r\n\r\nOK');
    const expected = 'HTTP/1.1 302 Found\r\nhOsT: public.example\r\n' + other + tail;
    await f.until(() => f.responses().includes('\r\n\r\nOK'));
    expect(f.responses().toString()).toBe(expected);
}));

