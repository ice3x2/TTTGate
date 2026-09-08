import http from 'node:http';
import zlib from 'node:zlib';
import {withHttpDuplex} from './http-duplex-fixture';
import HttpUtil from '../../src/server/http/HttpUtil';

const plain = Buffer.from('http://internal.example/path');
const encoders: Record<string, (data: Buffer) => Buffer> = {identity: x => x, gzip: zlib.gzipSync, deflate: zlib.deflateSync, br: zlib.brotliCompressSync};
const decoders: Record<string, (data: Buffer) => Buffer> = {identity: x => x, gzip: zlib.gunzipSync, deflate: zlib.inflateSync, br: zlib.brotliDecompressSync};
const opaque = Buffer.from([0xb0, 0xa1, 0xff, 0, 0x80]);
const cases = [
    {name: 'euc-kr', type: 'text/plain; charset=euc-kr', encoding: '', body: opaque},
    {name: 'zstd', type: 'text/plain', encoding: 'zstd', body: opaque},
    {name: 'multiple', type: 'text/plain', encoding: 'br, gzip', body: opaque},
    {name: 'duplicate charset', type: 'text/plain; charset=UTF-8; charset=UTF-8', encoding: '', body: plain},
    {name: 'empty charset', type: 'text/plain; charset=', encoding: '', body: plain},
];

async function actualExchange(f: any, body: Buffer, type: string, encoding: string, chunked: boolean, rewrite: boolean, codec = 'identity') {
    const agent = new http.Agent({keepAlive: true});
    agent.createConnection = () => f.client;
    const request = (url: string) => new Promise<{body: Buffer; complete: boolean; headers: http.IncomingHttpHeaders}>( (resolve, reject) => {
        const req = http.get({host: 'public.example', path: url, agent}, response => {
            const bytes: Buffer[] = []; response.on('data', chunk => bytes.push(chunk));
            response.on('error', reject); response.on('aborted', () => reject(new Error('Unexpected HTTP abort')));
            response.on('end', () => resolve({body: Buffer.concat(bytes), complete: response.complete, headers: response.headers}));
        }); req.on('error', reject);
    });
    try {
        const result = request('/first');
        await f.until(() => f.requests().includes('/first'));
        const header = `HTTP/1.1 200 OK\r\nContent-Type: ${type}\r\n${encoding ? `Content-Encoding: ${encoding}\r\n` : ''}${chunked ? 'Transfer-Encoding: chunked' : `Content-Length: ${body.length}`}\r\nX-Note: public.example/internal.example\r\n\r\n`;
        const framed = chunked ? Buffer.concat([Buffer.from(body.length.toString(16) + '\r\n'), body, Buffer.from('\r\n0\r\n\r\n')]) : body;
        f.upstream.write(Buffer.concat([Buffer.from(header), framed]));
        const received = await result;
        expect(received.complete).toBe(true);
        expect(received.headers['content-type']).toBe(type);
        expect(received.headers['x-note']).toBe('public.example/internal.example');
        if(rewrite) expect(decoders[codec](received.body).toString()).toBe('http://public.example/path');
        else {
            expect(received.body).toEqual(body);
            expect(received.headers['content-length']).toBe(chunked ? undefined : String(body.length));
            expect(received.headers['transfer-encoding']).toBe(chunked ? 'chunked' : undefined);
            expect(f.responses()).toEqual(Buffer.concat([Buffer.from(header), framed]));
        }
        const next = request('/second'); await f.until(() => f.requests().includes('/second'));
        f.upstream.write('HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 2\r\n\r\nOK');
        expect(await next).toMatchObject({body: Buffer.from('OK'), complete: true});
        expect((f.handler as any)._pendingRequests).toHaveLength(0);
        expect(f.upstream.destroyed).toBe(false);
    } finally { agent.destroy(); }
}

test.each(cases.flatMap(value => [false, true].map(chunked => ({...value, chunked}))))(
    'opaque $name preserves bytes/framing and Node completion chunked=$chunked', async item => withHttpDuplex(
        f => actualExchange(f, item.body, item.type, item.encoding, item.chunked, false), true));

test.each(['identity', 'gzip', 'deflate', 'br'])('supported %s UTF8 has actual decoded replacement and finite Node completion', async codec => withHttpDuplex(
    f => actualExchange(f, encoders[codec](plain), 'text/plain; charset="uTf-8"', ' ' + codec.toUpperCase() + ' ', false, true, codec), true));

test.each([false, true])('absent charset and coding retains supported rewrite chunked=%s', async chunked => withHttpDuplex(
    f => actualExchange(f, plain, 'text/plain', '', chunked, true), true));

test.each([
    ['text/plain', undefined, true], ['text/plain; charset=UTF-8', 'gzip', true],
    ['text/plain; charset="UTF-8"', 'identity', true], ['text/plain; charset="UTF-8', undefined, false],
    ['text/plain; charset', undefined, false], ['text/plain; charset=""', undefined, false],
    ['text/plain', '', false], ['text/plain', 'gzip, br', false], ['text/plain; charset=utf8', undefined, false],
])('explicit eligibility %s / %s', (type, encoding, expected) => {
    const headers: any[] = [{name: 'Content-Type', value: type}];
    if(encoding !== undefined) headers.push({name: 'Content-Encoding', value: encoding});
    expect((HttpUtil as any).canRewriteTextEncoding({headers})).toBe(expected);
});
test('duplicate header fields are ambiguous even if equal', () => {
    for(const name of ['Content-Type', 'Content-Encoding']) {
        const value = name === 'Content-Type' ? 'text/plain' : 'gzip';
        expect((HttpUtil as any).canRewriteTextEncoding({headers: [{name, value}, {name: name.toLowerCase(), value}]})).toBe(false);
    }
});

test.each([false, true])('live finite sibling completes while opaque response remains in progress chunked=%s', async chunked => withHttpDuplex(async opaqueConnection => {
    await withHttpDuplex(async sibling => {
        const agent = new http.Agent({keepAlive: true});
        agent.createConnection = () => opaqueConnection.client;
        const bytes: Buffer[] = [];
        let response: http.IncomingMessage | undefined, ended = false, failure: Error | undefined;
        try {
            const request = http.get({host: 'public.example', path: '/opaque-overlap', agent}, incoming => {
                response = incoming;
                incoming.on('data', part => bytes.push(Buffer.from(part)));
                incoming.on('end', () => { ended = true; });
                incoming.on('error', error => { failure = error; });
                incoming.on('aborted', () => { failure = new Error('Opaque overlap response unexpectedly aborted'); });
            });
            request.on('error', error => { failure = error; });
            const check = (condition: () => boolean) => opaqueConnection.until(() => {
                if(failure) throw failure;
                return condition();
            });
            await check(() => opaqueConnection.requests().includes('/opaque-overlap'));
            const header = 'HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=euc-kr\r\nContent-Encoding: zstd\r\n' +
                (chunked ? 'Transfer-Encoding: chunked' : `Content-Length: ${opaque.length}`) + '\r\n\r\n';
            const prefix = chunked ? Buffer.concat([Buffer.from('1\r\n'), opaque.subarray(0, 1), Buffer.from('\r\n')]) : opaque.subarray(0, 1);
            opaqueConnection.upstream.write(Buffer.concat([Buffer.from(header), prefix]));
            await check(() => Buffer.concat(bytes).length === 1);
            expect(ended).toBe(false); expect(response!.complete).toBe(false);
            // Existing actualExchange proves the distinct sibling's Node end/complete,
            // exact decoded body and a second finite exchange while A is held partial.
            await actualExchange(sibling, plain, 'text/plain', '', false, true);
            expect(failure).toBeUndefined(); expect(ended).toBe(false);
            expect(response!.complete).toBe(false); expect(Buffer.concat(bytes)).toEqual(opaque.subarray(0, 1));
            expect(opaqueConnection.upstream.destroyed).toBe(false);
            const rest = opaque.subarray(1);
            const suffix = chunked ? Buffer.concat([Buffer.from(rest.length.toString(16) + '\r\n'), rest, Buffer.from('\r\n0\r\n\r\n')]) : rest;
            opaqueConnection.upstream.write(suffix);
            await check(() => ended);
            expect(response!.complete).toBe(true); expect(Buffer.concat(bytes)).toEqual(opaque);
            expect(response!.headers['content-type']).toBe('text/plain; charset=euc-kr');
            expect(response!.headers['content-encoding']).toBe('zstd');
            expect(opaqueConnection.responses()).toEqual(Buffer.concat([Buffer.from(header), prefix, suffix]));
            expect(opaqueConnection.upstream.destroyed).toBe(false);
        } finally { agent.destroy(); }
    }, true);
}, true));
