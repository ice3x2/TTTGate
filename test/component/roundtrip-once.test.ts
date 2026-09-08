import net from 'net';
import {once} from 'events';
import * as network from '../helpers/network';
import {createTunnelHarness} from '../helpers/tunnelHarness';

async function withPeer(mode: string, check: (peer: {port: number; counts: {connections: number; requests: number}}) => Promise<void>) {
    const sockets: net.Socket[] = [], counts = {connections: 0, requests: 0};
    const server = net.createServer(socket => {
        counts.connections++; const index = counts.connections; sockets.push(socket); socket.on('error', () => {});
        const parts: Buffer[] = []; let replied = false;
        socket.on('data', bytes => {
            parts.push(bytes); const data = Buffer.concat(parts);
            if(data.length < 5 || replied) return; replied = true; counts.requests++;
            if(mode === 'never') { socket.write(data); return; }
            if(mode === 'reset') { socket.resetAndDestroy(); return; }
            socket.end(mode === 'extra' ? Buffer.concat([data, Buffer.from('!')]) : mode === 'first-bad' && index === 1 ? Buffer.from('WRONG') : data);
        });
    });
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        await check({port: (server.address() as net.AddressInfo).port, counts});
    } finally { sockets.forEach(socket => socket.destroy()); await new Promise<void>(resolve => server.close(() => resolve())); }
}

test.each(['good', 'extra', 'never', 'reset'])('once helper actual %s peer contract', async mode => withPeer(mode, async peer => {
    const send = (network as any).sendTcpAndReceiveOnce;
    expect(typeof send).toBe('function');
    const result = send({host: '127.0.0.1', port: peer.port, payload: Buffer.from('hello'), timeoutMs: 500});
    if(mode === 'never' || mode === 'reset') await expect(result).rejects.toThrow();
    else expect(await result).toEqual(Buffer.from(mode === 'extra' ? 'hello!' : 'hello'));
    expect(peer.counts).toEqual({connections: 1, requests: 1});
}));

test.each(['first-bad', 'extra', 'good'])('real tunnel %s response is compared once without retry/truncation', async mode => withPeer(mode, async peer => {
    const harness = await createTunnelHarness({clientName: 'once-client', tunnelingOptionOverride: {destinationPort: peer.port}});
    try {
        await harness.start();
        if(mode === 'good') expect(await harness.sendAndReceive('hello')).toEqual(Buffer.from('hello'));
        else await expect(harness.sendAndReceive('hello')).rejects.toThrow(/mismatch/i);
        expect(peer.counts).toEqual({connections: 1, requests: 1});
    } finally { await harness.dispose(); }
}));
