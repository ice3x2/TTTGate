import http from 'node:http';
import SocketState from '../../src/util/SocketState';
import {withHttpDuplex} from './http-duplex-fixture';
const limit = 16 * 1024 * 1024;
const request = 'GET / HTTP/1.1\r\nHost: public.example\r\n\r\n';
const bad = 'GET /bad HTTP/1.1\r\nHost: a\r\nHost: b\r\n\r\n';
const error502 = 'HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n';
const header = (size: number, extra = '') => `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n${extra}Content-Length: ${size}\r\n\r\n`;
const chunk = (body: Buffer) => Buffer.concat([Buffer.from(body.length.toString(16) + '\r\n'), body, Buffer.from('\r\n')]);
function observeHttp(f: any, method = 'GET') {
    const agent = new http.Agent({keepAlive: true}); agent.createConnection = () => f.client;
    const state = {status: 0, end: false, complete: false, aborted: false, bytes: 0};
    const req = http.request({host: 'public.example', method, agent}, res => {
        state.status = res.statusCode!; res.on('data', data => state.bytes += data.length);
        res.on('aborted', () => { state.aborted = true; state.complete = res.complete; });
        res.on('error', () => {}); res.on('end', () => { state.end = true; state.complete = res.complete; });
    }); req.on('error', () => {}); req.end();
    return {state, request: req, close: () => agent.destroy()};
}
function responseCompletion(req: http.ClientRequest, deadline: number) {
    let response: http.IncomingMessage | undefined, ended = false;
    let timer: NodeJS.Timeout | undefined;
    let fail: (error: Error) => void;
    let finish: () => void;
    const closed = () => { if (!ended) fail(new Error('Response closed before end')); };
    const aborted = () => fail(new Error('Response aborted before end'));
    const onResponse = (res: http.IncomingMessage) => {
        response = res;
        res.once('error', fail); res.once('aborted', aborted);
        res.once('close', closed); res.once('end', finish);
    };
    const dispose = () => {
        clearTimeout(timer);
        req.off('error', fail!); req.off('close', closed); req.off('response', onResponse);
        response?.off('error', fail!); response?.off('aborted', aborted);
        response?.off('close', closed); response?.off('end', finish!);
    };
    const done = new Promise<void>((resolve, reject) => {
        fail = error => { dispose(); reject(error); };
        finish = () => { ended = true; dispose(); resolve(); };
        req.once('error', fail); req.once('close', closed); req.once('response', onResponse);
        timer = setTimeout(() => fail(new Error('Response completion deadline exceeded')), Math.max(0, deadline - Date.now()));
    });
    return {done, dispose};
}

test('known oversized eligible length produces completed Node502 before original header/body with upstream still open', async () => withHttpDuplex(async f => {
    const client = observeHttp(f);
    try {
        await f.until(() => f.requests().length > 0);
        f.upstream.write(header(limit + 1));
        await f.until(() => client.state.end);
        expect(client.state).toEqual({status: 502, end: true, complete: true, aborted: false, bytes: 0});
        expect(f.responses().toString()).toBe(error502);
        await f.until(() => f.ownerCalls() === 1);
        expect((f.handler as any)._bodyBuffer.length).toBe(0);
    } finally { client.close(); }
}, true));

test('committed chunked limit+1 aborts Node response without another upstream write or success terminator', async () => withHttpDuplex(async f => {
    const client = observeHttp(f);
    try {
        await f.until(() => f.requests().length > 0);
        f.upstream.write('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n');
        for(let i = 0; i < 4; i++) f.upstream.write(chunk(Buffer.alloc(limit / 4, 65)));
        f.upstream.write(chunk(Buffer.from('X')));
        await f.until(() => client.state.aborted);
        expect(client.state).toEqual({status: 200, end: false, complete: false, aborted: true, bytes: 0});
        expect(f.responses().toString()).not.toMatch(/502|400|AAAA|0\r\n\r\n$/);
        await f.until(() => f.ownerCalls() === 1);
        expect((f.handler as any)._bodyBuffer.length).toBe(0);
    } finally { client.close(); }
}, true));

test.each([false, true])('exact encoded limit completes finite Node response chunked=%s', async chunked => {
    const deadline = Date.now() + 4500;
    return withHttpDuplex(async f => {
        const client = observeHttp(f);
        try {
            await f.until(() => f.requests().length > 0);
            const completion = responseCompletion(client.request, deadline);
            try {
                const body = Buffer.alloc(limit, 65);
                f.upstream.write(chunked ? 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n' : header(limit));
                f.upstream.write(chunked ? Buffer.concat([chunk(body), Buffer.from('0\r\n\r\n')]) : body);
                await completion.done;
                expect(client.state).toEqual({status: 200, end: true, complete: true, aborted: false, bytes: limit});
            } finally {
                completion.dispose();
            }
        } finally { client.close(); }
    }, true);
});

test('stalled finite response rejects and cleans up before the existing case budget', async () => {
    const started = Date.now();
    let ownedClient: any;
    await withHttpDuplex(async f => {
        ownedClient = f.client;
        const client = observeHttp(f);
        let completion: ReturnType<typeof responseCompletion> | undefined;
        let guard: NodeJS.Timeout | undefined;
        try {
            await f.until(() => f.requests().length > 0);
            const errorsBefore = client.request.listenerCount('error');
            completion = responseCompletion(client.request, started + 4500);
            const result = completion.done.then(() => 'unexpected success', error => error.message);
            f.upstream.write(header(2) + 'A'); // Real peer keeps the final body byte pending.
            const outcome = await Promise.race([result, new Promise<string>(resolve => {
                guard = setTimeout(() => resolve('external cleanup guard'), Math.max(0, started + 4700 - Date.now()));
            })]);
            expect(outcome).toBe('Response completion deadline exceeded');
            expect(client.request.listenerCount('error')).toBe(errorsBefore);
        } finally {
            clearTimeout(guard); completion?.dispose(); client.close();
        }
    });
    expect(ownedClient.destroyed).toBe(true);
});

test.each([false, true])('body limit cancels pending400 and coalesced later response postcommit=%s', async committed => withHttpDuplex(async f => {
    f.client.write(request + request + bad);
    await f.until(() => (f.handler as any)._inputRejected);
    const first = 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK';
    if(!committed) f.upstream.write(first + header(limit + 1) + 'INTERNAL' + first);
    else {
        f.upstream.write(first + 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n');
        f.upstream.write(Buffer.concat([chunk(Buffer.alloc(limit, 65)), chunk(Buffer.from('X')), Buffer.from('0\r\n\r\n' + first)]));
    }
    await f.until(() => f.client.destroyed && f.ownerCalls() === 1);
    if(!committed) expect(f.responses().toString()).toBe(first + error502);
    else expect(f.responses().toString()).not.toMatch(/400|502|AAAA/);
    expect((f.handler as any)._pendingRequests).toHaveLength(0);
    expect(f.ownerCalls()).toBe(1);
    f.handler.sendData(Buffer.from(first)); f.handler.destroy(); expect(f.ownerCalls()).toBe(1);
}, true));

test.each(['HEAD', 'bypass'])('oversized advertised length does not newly reject %s', async mode => withHttpDuplex(async f => {
    const client = observeHttp(f, mode === 'HEAD' ? 'HEAD' : 'GET');
    try {
        await f.until(() => f.requests().length > 0);
        f.upstream.write(header(limit + 1, mode === 'bypass' ? 'Content-Encoding: zstd\r\n' : ''));
        if(mode === 'bypass') f.upstream.write(Buffer.alloc(limit + 1, 65));
        await f.until(() => client.state.end);
        expect(client.state.status).toBe(200); expect(client.state.complete).toBe(true);
        expect(client.state.bytes).toBe(mode === 'HEAD' ? 0 : limit + 1);
    } finally { client.close(); }
}, true));

test('502 send failure closes only its owner once while a real sibling response completes', async () => withHttpDuplex(async f => withHttpDuplex(async sibling => {
    const raw = (f.handler as any)._socketHandler, send = raw.sendData;
    let rejected = 0;
    raw.sendData = function(data: Buffer, callback?: (handler: unknown, success: boolean) => void) {
        if(data.equals(Buffer.from(error502))) { rejected++; callback?.(this, false); return; }
        return send.call(this, data, callback);
    };
    try {
        f.client.write(request); await f.until(() => f.requests().length > 0);
        f.upstream.write(header(limit + 1));
        await f.until(() => f.client.destroyed && f.ownerCalls() === 1);
        expect(rejected).toBe(1); expect(f.responses()).toHaveLength(0);
        expect((f.handler as any)._pendingRequests).toHaveLength(0);
        sibling.client.write(request); await sibling.until(() => sibling.requests().length > 0);
        sibling.upstream.write('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK');
        await sibling.until(() => sibling.responses().toString().endsWith('OK'));
        expect(sibling.ownerCalls()).toBe(0);
        f.handler.sendData(Buffer.from(header(limit + 1))); f.handler.destroy();
        expect(rejected).toBe(1); expect(f.ownerCalls()).toBe(1);
    } finally { raw.sendData = send; }
}), true));


test('precommit502 blocks new requests while declared terminal write completion and end are held', async () => withHttpDuplex(async f => {
    const raw = (f.handler as any)._socketHandler;
    const send = raw.sendData, end = raw.end_, receive = raw._event;
    let complete: (() => void) | undefined, endCalls = 0, incoming = 0;
    raw.sendData = function(data: Buffer, callback?: (handler: unknown, success: boolean) => void) {
        if(data.equals(Buffer.from(error502))) {
            return send.call(this, data, (handler: unknown, success: boolean) => { complete = () => callback?.(handler, success); });
        }
        return send.call(this, data, callback);
    };
    // Declared completion/end barrier, not an OS backpressure failure claim.
    raw.end_ = () => { endCalls++; };
    raw.onSocketEvent = (...args: any[]) => { const result = receive(...args); if(args[1] === SocketState.Receive) incoming += args[2].length; return result; };
    try {
        f.client.write(request); await f.until(() => f.requests().length === Buffer.byteLength(request.replace('public.example', 'internal.example')));
        const original = Buffer.from(f.requests());
        f.upstream.write(header(limit + 1));
        await f.until(() => complete !== undefined && f.responses().toString() === error502 && endCalls === 1);
        expect(f.client.readableEnded).toBe(false);
        const later = 'GET /late-after502 HTTP/1.1\r\nHost: public.example\r\n\r\n';
        const before = incoming;
        let forwarded = 0;
        const upstream = (f.handler as any)._event;
        f.handler.onSocketEvent = (...args: any[]) => { if(args[1] === SocketState.Receive) forwarded += args[2].length; return upstream(...args); };
        f.client.write(later + later);
        await f.until(() => incoming === before + 2*Buffer.byteLength(later));
        if(forwarded > 0) await f.until(() => f.requests().includes('/late-after502'));
        expect(f.requests()).toEqual(original); expect(forwarded).toBe(0);
        f.handler.sendData(Buffer.from(header(limit + 1) + 'TAIL'));
        expect(f.responses().toString()).toBe(error502);
        complete!(); raw.end_ = end; end.call(raw);
        await f.until(() => f.client.destroyed && f.ownerCalls() === 1);
        expect((f.handler as any)._pendingRequests).toHaveLength(0);
        expect((f.handler as any)._inputRejected).toBe(false); expect((f.handler as any)._rejectionSent).toBe(false);
        f.handler.destroy(); expect(f.ownerCalls()).toBe(1);
    } finally { raw.sendData = send; raw.end_ = end; raw.onSocketEvent = receive; }
}, true));
