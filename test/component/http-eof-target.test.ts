import net from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {ExternalPortServerPool} from '../../src/server/ExternalPortServerPool';
import {getFreePort} from '../helpers/network';

const header = Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n');
async function withPool(check: (f: any) => Promise<void>) {
    const pool = ExternalPortServerPool.create([]), port = await getFreePort();
    let id = 0, client: net.Socket | undefined;
    const output: Buffer[] = [];
    pool.OnNewSessionCallback = value => { id = value; };
    const until = async (predicate: () => boolean) => {
        const end = Date.now() + 2000;
        while(!predicate()) { if(Date.now() > end) throw new Error('EOF target condition timed out'); await delay(5); }
    };
    try {
        await pool.startServer({forwardPort: port, protocol: 'http', destinationAddress: 'internal.example', destinationPort: 80,
            keepAlive: 0, httpOption: {rewriteHostInTextBody: true}});
        client = net.createConnection({host: '127.0.0.1', port}); client.on('error', () => {});
        client.on('data', data => output.push(data)); await once(client, 'connect');
        client.write('GET / HTTP/1.1\r\nHost: public.example\r\n\r\n');
        await until(() => !!id && (pool as any)._handlerMap.get(id)?.receiveLength > 0);
        const handler = (pool as any)._handlerMap.get(id);
        await check({pool, id, handler, client, until, output: () => Buffer.concat(output), map: (pool as any)._handlerMap});
    } finally { client?.destroy(); await pool.stopAll(); }
}

test.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('invalid HTTP EOF target %s aborts owner', async target => withPool(async f => {
    f.pool.send(f.id, header); f.pool.closeSession(f.id, target);
    await f.until(() => f.client.destroyed);
    expect(f.output().toString()).not.toContain('0\r\n\r\n');
}));

test.each(['conflict', 'below', 'overshoot'])('HTTP EOF %s does not flush buffered body', async mode => withPool(async f => {
    f.pool.send(f.id, header);
    if(mode === 'below') f.pool.closeSession(f.id, header.length - 1);
    else {
        f.pool.closeSession(f.id, header.length + 2);
        if(mode === 'conflict') f.pool.closeSession(f.id, header.length + 3);
        else f.pool.send(f.id, Buffer.from('abc'));
    }
    await f.until(() => f.client.destroyed);
    expect(f.output().toString()).not.toMatch(/abc|0\r\n\r\n$/);
}));

test('equal duplicate and missing final byte finalize once at exact input length', async () => withPool(async f => {
    const eof = jest.spyOn(f.handler, 'endResponseInput');
    f.pool.send(f.id, header); f.pool.closeSession(f.id, header.length + 3);
    f.pool.closeSession(f.id, header.length + 3); f.pool.send(f.id, Buffer.from('ab'));
    await delay(20); expect(eof).not.toHaveBeenCalled(); expect(f.handler.closeInitiated).toBe(false);
    f.pool.send(f.id, Buffer.from('c'));
    await f.until(() => f.client.destroyed);
    expect(eof).toHaveBeenCalledTimes(1);
    expect(f.handler.responseInputLength).toBe(header.length + 3);
    expect(f.output().toString()).toContain('3\r\nabc\r\n0\r\n\r\n');
}));

test('native output pressure delays close and stale progress cannot close replacement', async () => withPool(async f => {
    f.client.pause();
    const body = Buffer.alloc(8 * 1024 * 1024, 65);
    f.pool.send(f.id, header); f.pool.send(f.id, body);
    f.pool.closeSession(f.id, header.length + body.length);
    expect(f.handler.responseInputLength).toBe(header.length + body.length);
    expect(f.handler.isOutputDrained).toBe(false); expect(f.handler.closeInitiated).toBe(false);
    f.client.resume(); await f.until(() => f.client.destroyed);
    expect(f.output().toString().endsWith('0\r\n\r\n')).toBe(true);
    const replacement = {closeWait: true, closeInitiated: false}; f.map.set(f.id, replacement);
    f.pool.closeSession(f.id + 1, 0);
    await delay(20); expect(replacement.closeInitiated).toBe(false); f.map.delete(f.id);
}));

test('header completion cannot account for a buffered close-delimited body', async () => withPool(async f => {
    f.pool.send(f.id, Buffer.concat([header, Buffer.from('abc')]));
    await f.until(() => f.handler.isOutputDrained);
    expect(f.handler.sendLength).toBe(header.length);
    expect(f.handler.responseInputLength).toBe(header.length + 3);
}));

test('abort under native pressure invalidates captured progress and prevents graceful close', async () => withPool(async f => {
    const end = jest.spyOn(f.handler, 'end_'), eof = jest.spyOn(f.handler, 'endResponseInput');
    const progress = f.handler.onOutputProgress;
    f.client.pause(); f.pool.send(f.id, header);
    const body = Buffer.alloc(8 * 1024 * 1024, 65); f.pool.send(f.id, body);
    f.pool.closeSession(f.id, header.length + body.length);
    expect(f.handler.isOutputDrained).toBe(false);
    f.pool.closeSession(f.id, header.length + body.length + 1);
    progress(); progress(); f.client.resume();
    await f.until(() => f.client.destroyed);
    expect(eof).toHaveBeenCalledTimes(1); expect(end).not.toHaveBeenCalled();
    const replacement = {closeInitiated: false}; f.map.set(f.id, replacement);
    progress(); await delay(20); expect(replacement.closeInitiated).toBe(false); f.map.delete(f.id);
}));

test('force abort before input EOF never flushes the buffered response', async () => withPool(async f => {
    const eof = jest.spyOn(f.handler, 'endResponseInput'), end = jest.spyOn(f.handler, 'end_');
    const progress = f.handler.onOutputProgress;
    f.pool.send(f.id, Buffer.concat([header, Buffer.from('abc')]));
    f.pool.closeSession(f.id, header.length + 4);
    (f.pool as any).closeIfSatisfiedLength(f.handler, true); progress();
    await f.until(() => f.client.destroyed);
    expect(eof).not.toHaveBeenCalled(); expect(end).not.toHaveBeenCalled();
    expect(f.output().toString()).not.toMatch(/abc|0\r\n\r\n$/);
}));

test('zero input closes idle parser and safe large target remains pending', async () => {
    await withPool(async f => { f.pool.closeSession(f.id, 0); await f.until(() => f.client.destroyed); });
    await withPool(async f => {
        f.pool.closeSession(f.id, Number.MAX_SAFE_INTEGER);
        expect(f.handler.endLength).toBe(Number.MAX_SAFE_INTEGER);
        expect(f.handler.closeInitiated).toBe(false); expect(f.handler.responseInputEnded).toBe(false);
    });
});
