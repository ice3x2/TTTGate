import net from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {ExternalPortServerPool} from '../../src/server/ExternalPortServerPool';
import {getFreePort} from '../helpers/network';

// #284 — 요청보다 먼저 세션이 실패해도, 뒤이어 온 요청에 502 로 답하고 핸들러와 세션 계수를 정리한다.
const until = async (predicate: () => boolean) => {
    const end = Date.now() + 5000;
    while(!predicate()) { if(Date.now() > end) throw new Error('bad gateway condition timed out'); await delay(5); }
};

test('a session that fails before the request answers 502 and releases the handler and the session count', async () => {
    const pool = ExternalPortServerPool.create([]), port = await getFreePort();
    let id = 0;
    pool.OnNewSessionCallback = value => { id = value; };
    const output: Buffer[] = [];
    let client: net.Socket | undefined;
    try {
        await pool.startServer({forwardPort: port, protocol: 'http', destinationAddress: 'internal.example', destinationPort: 80, keepAlive: 0});
        client = net.createConnection({host: '127.0.0.1', port});
        client.on('error', () => {});
        client.on('data', data => output.push(data));
        await once(client, 'connect');
        await until(() => !!id && (pool as any)._handlerMap.has(id));
        expect(pool.getServerStatus(port).sessions).toBe(1);

        pool.closeSession(id, 0);
        client.write('GET / HTTP/1.1\r\nHost: public.example\r\n\r\n');

        await until(() => client!.readableEnded || client!.destroyed);
        expect(Buffer.concat(output).toString('latin1')).toMatch(/^HTTP\/1\.1 502 Bad Gateway\r\n/);
        await until(() => !(pool as any)._handlerMap.has(id));
        expect(pool.getServerStatus(port).sessions).toBe(0);
    } finally {
        client?.destroy();
        await pool.stopAll();
    }
});
