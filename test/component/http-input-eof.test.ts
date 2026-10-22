import {HttpPipe, MessageType} from '../../src/server/http/HttpPipe';
import {withHttpDuplex} from './http-duplex-fixture';

function fixture() {
    const pipe = new HttpPipe();
    pipe.reset(MessageType.Response);
    const body: Buffer[] = [];
    const errors: Error[] = [];
    let ended = 0;
    pipe.onHeaderCallback = () => {};
    pipe.onDataCallback = data => { body.push(data); return true; };
    pipe.onErrorCallback = error => errors.push(error);
    pipe.onEndCallback = () => { ended++; };
    return {pipe, body, errors, ended: () => ended};
}

test.each(['HTTP/1.0', 'HTTP/1.1'])('close-delimited %s ends only on explicit EOF', version => {
    const f = fixture();
    f.pipe.write(Buffer.from(`${version} 200 OK\r\n\r\nabc`));
    expect(f.ended()).toBe(0);
    expect(Buffer.concat(f.body).toString()).toBe('abc');
    (f.pipe as any).endInput();
    (f.pipe as any).endInput();
    expect(f.ended()).toBe(1);
    expect(f.errors).toHaveLength(0);
});

test.each([
    'HTTP/1.1 200 OK\r\nContent-Type:',
    'HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nabc',
    'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nabc',
    'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nX: y\r\n'
])('incomplete framed input aborts at EOF: %s', input => {
    const f = fixture(); f.pipe.write(Buffer.from(input));
    (f.pipe as any).endInput(); (f.pipe as any).endInput();
    expect(f.errors).toHaveLength(1); expect(f.ended()).toBe(0);
});

test.each([100, 204, 304])('status %s excludes body without framing', status => {
    const f = fixture(); f.pipe.write(Buffer.from(`HTTP/1.1 ${status} Status\r\n\r\n`));
    (f.pipe as any).endInput();
    expect(f.ended()).toBe(1); expect(f.errors).toHaveLength(0);
});

test.each(['HTTP/1.0', 'HTTP/1.1'])('unframed %s POST request has no EOF-delimited body', version => {
    const f = fixture(); f.pipe.reset(MessageType.Request);
    f.pipe.write(Buffer.from(`POST / ${version}\r\nHost: local\r\n\r\n`));
    expect(f.ended()).toBe(1);
});

test.each(['HTTP/1.0', 'HTTP/1.1'])('binary %s EOF preserves bytes', async version => withHttpDuplex(async f => {
    const body = Buffer.from([0, 255, 128, 13, 10]);
    const head = Buffer.from(`${version} 200 OK\r\nContent-Type: application/octet-stream\r\n\r\n`);
    f.handler.sendData(Buffer.concat([head, body]));
    f.handler.endResponseInput();
    await f.until(() => f.handler.isOutputDrained);
    f.handler.end_(); await f.until(() => f.client.destroyed);
    expect(f.responses().subarray(-body.length)).toEqual(body);
}, true));

test('close-delimited rewrite exceeds 16MiB by aborting without success terminator', async () => withHttpDuplex(async f => {
    f.handler.sendData(Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n'));
    for(let i = 0; i < 4; i++) f.handler.sendData(Buffer.alloc(4 * 1024 * 1024, 65));
    f.handler.sendData(Buffer.from('X')); f.handler.endResponseInput();
    await f.until(() => f.client.destroyed);
    expect(f.responses().toString()).not.toMatch(/AAAA|0\r\n\r\n$/);
    expect(f.ownerCalls()).toBe(1);
}, true));

test('EOF finishes complete chunk input deferred by parser recursion budget', () => {
    const f = fixture();
    f.pipe.write(Buffer.from('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n' + '1\r\na\r\n'.repeat(1500) + '0\r\n\r\n'));
    f.pipe.endInput();
    expect(f.errors).toHaveLength(0); expect(f.ended()).toBe(1);
});
