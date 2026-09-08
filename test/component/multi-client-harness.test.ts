import net from 'net';
import {once} from 'events';
import fs from 'fs';
import {createTunnelHarness} from '../helpers/tunnelHarness';
import * as network from '../helpers/network';
import * as runtime from '../helpers/runtime';
import {until} from './server/legacy-handler-id-fixture';
import TTTClient from '../../src/client/TTTClient';
import {CertificationStore} from '../../src/server/CertificationStore';
import ServerOptionStore from '../../src/server/ServerOptionStore';
const specs = [{clientId: 'A', clientSecret: 'owned-A'}, {clientId: 'B', clientSecret: 'owned-B'}];
jest.setTimeout(30_000);

test('actual two authenticated identities own distinct endpoints and first response bytes', async () => {
    const peers: net.Server[] = [], sockets: net.Socket[] = [], requests: Buffer[][] = [[], []];
    let h: any;
    try {
        const clients = [];
        for(let index = 0; index < 2; index++) {
            const peer = net.createServer(socket => {
                sockets.push(socket); socket.on('error', () => {});
                const parts: Buffer[] = []; let ended = false;
                socket.on('data', bytes => {
                    parts.push(Buffer.from(bytes)); const payload = Buffer.concat(parts);
                    if(payload.length >= 7 && !ended) { ended = true; requests[index].push(payload); socket.end(payload); }
                });
            });
            peers.push(peer); peer.listen(0, '127.0.0.1'); await once(peer, 'listening');
            clients.push({...specs[index], tunnelingOptionOverride: {destinationPort: (peer.address() as net.AddressInfo).port}});
        }
        h = await createTunnelHarness({clients} as any);
        await h.start();
        expect(h.getServer().clientStatus().map((s: any) => s.clientId).sort()).toEqual(['A', 'B']);
        expect(h.clients).toHaveLength(2); expect(new Set(h.clients.map((c: any) => c.endpointPort)).size).toBe(2);
        expect(h.forwardPort).toBe(h.clients[0].forwardPort);
        expect(ServerOptionStore.instance.serverOption.tunnelingOptions.map(option => option.allowedClientIds)).toEqual([['A'], ['B']]);
        expect(await Promise.all([h.sendAndReceive('first-A', 'A'), h.sendAndReceive('first-B', 'B')])).toEqual([Buffer.from('first-A'), Buffer.from('first-B')]);
        expect(requests).toEqual([[Buffer.from('first-A')], [Buffer.from('first-B')]]);
        const exchange = jest.spyOn(network, 'sendTcpAndReceiveOnce');
        try {
        await expect(h.sendAndReceive('bad')).rejects.toThrow(/client/i);
        await expect(h.sendAndReceive('bad', 'unknown')).rejects.toThrow(/client/i);
        await h.stopClient('A'); await h.stopClient('A');
        await expect(h.sendAndReceive('bad', 'A')).rejects.toThrow(/stopped/i);
        await expect(h.stopClient('unknown')).rejects.toThrow(/client/i);
        expect(exchange).not.toHaveBeenCalled();
        } finally { exchange.mockRestore(); }
        await h.restartServer(); expect(h.getServer().clientStatus().map((s: any) => s.clientId)).toEqual(['B']);
        expect(await h.sendAndReceive('after-restart-B', 'B')).toEqual(Buffer.from('after-restart-B'));
    } finally { await h?.dispose(); sockets.forEach(socket => socket.destroy());
        await Promise.all(peers.map(peer => new Promise<void>(resolve => peer.close(() => resolve())))); }
});

test('explicit singleton keeps no-ID send compatibility', async () => {
    const h = await createTunnelHarness({clients: [specs[0]]} as any);
    try { await h.start(); expect(await h.sendAndReceive('singleton')).toEqual(Buffer.from('singleton')); }
    finally { await h.dispose(); }
});

test.each([{clients: []}, {clients: [specs[0], specs[0]]}, {clients: specs, clientName: 'old'},
    {clients: specs, serverOptionOverride: {trustedClients: []}},
    {clients: [{...specs[0], tunnelingOptionOverride: {allowedClientIds: ['B']}}]}])('conflicting fixture %j rejects before resource allocation', async options => {
    const create = jest.spyOn(runtime, 'createTestRoot'); let h: any;
    try { await expect(createTunnelHarness(options as any).then(value => { h = value; return value; })).rejects.toThrow(); expect(create).not.toHaveBeenCalled(); }
    finally { await h?.dispose(); create.mockRestore(); }
});

const holdFiniteRequest = (socket: net.Socket, expected: Buffer, observed: (bytes: Buffer) => void,
    complete: (bytes: Buffer, release: () => void) => void) => {
    const parts: Buffer[] = []; let received = 0, ready = false, released = false;
    socket.on('data', bytes => {
        observed(bytes);
        if(ready) return;
        parts.push(Buffer.from(bytes)); received += bytes.length;
        if(received < expected.length) return;
        ready = true; const payload = Buffer.concat(parts);
        complete(payload, () => { if(released) return; released = true; socket.end(payload); });
    });
};

test('held endpoint waits for complete request after an observed split prefix', async () => {
    const expected = Buffer.from('held-B-bytes'), sockets: net.Socket[] = [];
    const chunks: Buffer[] = []; let completed: Buffer | undefined, release: (() => void) | undefined, count = 0;
    const server = net.createServer(socket => {
        sockets.push(socket); socket.on('error', () => {});
        holdFiniteRequest(socket, expected, bytes => chunks.push(Buffer.from(bytes)), (bytes, finish) => { count++; completed = bytes; release = finish; });
    });
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const client = net.createConnection({host: '127.0.0.1', port: (server.address() as net.AddressInfo).port});
        sockets.push(client); client.on('error', () => {}); await once(client, 'connect');
        const response: Buffer[] = []; client.on('data', data => response.push(Buffer.from(data)));
        client.write(expected.subarray(0, 3));
        await until(() => Buffer.concat(chunks).length === 3, 'Actual prefix not observed');
        expect(release).toBeUndefined(); expect(count).toBe(0);
        client.write(expected.subarray(3));
        await until(() => !!release, 'Complete request not observed');
        expect(completed).toEqual(expected); expect(count).toBe(1);
        const ended = once(client, 'end'); release!(); await ended;
        expect(Buffer.concat(response)).toEqual(expected);
    } finally { sockets.forEach(socket => socket.destroy()); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('held B response remains on its real owner while A stops', async () => {
    const sockets: net.Socket[] = []; let release: (() => void) | undefined, requests = 0;
    const endpoint = net.createServer(socket => {
        sockets.push(socket); socket.on('error', () => {});
        holdFiniteRequest(socket, Buffer.from('held-B-bytes'), () => {}, (bytes, finish) => { expect(bytes).toEqual(Buffer.from('held-B-bytes')); requests++; release = finish; });
    });
    endpoint.listen(0, '127.0.0.1'); await once(endpoint, 'listening');
    const h: any = await createTunnelHarness({clients: [specs[0], {...specs[1], tunnelingOptionOverride: {destinationPort: (endpoint.address() as net.AddressInfo).port}}]} as any);
    let result: Promise<Buffer> | undefined;
    try {
        await h.start(); const server = h.getServer().tunnelServer as any;
        const b = [...server._clientHandlerPoolMap.values()].find((pool: any) => pool.clientId === 'B') as any;
        result = h.sendAndReceive('held-B-bytes', 'B'); result.catch(() => {});
        await until(() => !!release, 'Actual B bytes never reached endpoint');
        const handlers = [...b._activatedSessionHandlerMap_.values()];
        await h.stopClient('A');
        expect([...server._clientHandlerPoolMap.values()].includes(b)).toBe(true);
        expect([...b._activatedSessionHandlerMap_.values()]).toEqual(handlers);
        expect(h.getServer().clientStatus().map((s: any) => s.clientId)).toEqual(['B']);
        release!(); expect(await result).toEqual(Buffer.from('held-B-bytes')); expect(requests).toBe(1);
    } finally { sockets.forEach(socket => socket.destroy()); await result?.catch(() => {}); await h.dispose(); await new Promise<void>(resolve => endpoint.close(() => resolve())); }
});

test('second client start failure cleans earlier actual clients and root without hiding original error', async () => {
    const original = TTTClient.prototype.start, clients: any[] = [], failure = new Error('owned-second-start');
    const listeners: net.Server[] = [], sockets: net.Socket[] = [], listen = net.Server.prototype.listen;
    const listenSpy = jest.spyOn(net.Server.prototype, 'listen').mockImplementation(function(this: net.Server, ...args: any[]) {
        listeners.push(this); return (listen as any).apply(this, args);
    });
    const spy = jest.spyOn(TTTClient.prototype, 'start').mockImplementation(function(this: TTTClient) {
        clients.push(this);
        if(clients.length === 2) throw failure;
        const result = original.call(this);
        const socket = (this as any)._tunnelClient?._ctrlHandler?.socket;
        expect(socket).toBeInstanceOf(net.Socket);
        sockets.push(socket);
        return result;
    });
    let h: any;
    try {
        h = await createTunnelHarness({clients: specs} as any);
        await expect(h.start()).rejects.toBe(failure);
        expect(clients).toHaveLength(2);
        expect(clients[0]._stopped).toBe(true);
        expect(sockets).toHaveLength(1);
        expect(sockets.every(socket => socket.destroyed)).toBe(true);
        expect(listeners.length).toBeGreaterThan(0);
        expect(listeners.every(server => server.listening === false)).toBe(true);
        expect(fs.existsSync(h.rootDir)).toBe(false);
    } finally { spy.mockRestore(); listenSpy.mockRestore(); await h?.dispose(); }
});

test('factory failure after real endpoint creation disposes that endpoint and root', async () => {
    const load = jest.spyOn(CertificationStore.prototype, 'load').mockRejectedValue(new Error('owned-cert-setup'));
    const endpoints: any[] = [], roots: any[] = []; const echo = network.startEchoServer, create = runtime.createTestRoot;
    const echoSpy = jest.spyOn(network, 'startEchoServer').mockImplementation(async () => { const value = await echo(); endpoints.push(value); return value; });
    const rootSpy = jest.spyOn(runtime, 'createTestRoot').mockImplementation(async (...args) => { const value = await create(...args); roots.push(value); return value; });
    const listeners: net.Server[] = [], listen = net.Server.prototype.listen;
    const listenSpy = jest.spyOn(net.Server.prototype, 'listen').mockImplementation(function(this: net.Server, ...args: any[]) {
        listeners.push(this); return (listen as any).apply(this, args);
    });
    try {
        await expect(createTunnelHarness({clients: specs} as any)).rejects.toThrow('owned-cert-setup');
        expect(endpoints.length).toBeGreaterThan(0); expect(roots.every(root => !fs.existsSync(root.rootDir))).toBe(true);
        expect(listeners.every(server => !server.listening)).toBe(true);
    } finally { load.mockRestore(); echoSpy.mockRestore(); rootSpy.mockRestore(); listenSpy.mockRestore();
        if(roots.some(root => fs.existsSync(root.rootDir))) { for(const endpoint of endpoints) await endpoint.close(); for(const root of roots) await runtime.cleanupTestRoot(root); }
    }
});
