import net from 'node:net';
import {once} from 'node:events';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withLegacyIds, until} from '../server/legacy-handler-id-fixture';
import TTTClient from '../../../src/client/TTTClient';
import ServerOptionStore from '../../../src/server/ServerOptionStore';
import {TTTClientRuntimeRegistry} from '../../../src/client/TTTClientRuntime';
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer} from '../../../src/commons/CtrlPacket';
import SocketState from '../../../src/util/SocketState';
import {DEFAULT_KEY} from '../../../src/types/TunnelingOption';

jest.setTimeout(30_000);
async function withClient(check: (h: any) => Promise<void>) {
    await withLegacyIds(async f => {
        TTTClientRuntimeRegistry.configure({reconnectIntervalMs: 100});
        const client = TTTClient.create({host: '127.0.0.1', port: f.server.tunnelServer.port, tls: false,
            key: DEFAULT_KEY, name: 'wide', clientId: 'wide', clientSecret: 'fixture-wide-secret',
            allowLegacyFallback: false, keepAlive: 0});
        const sockets: net.Socket[] = [];
        try {
            client.start();
            const tunnel = (client as any)._tunnelClient;
            await until(() => (client as any)._isOnline, 'Actual client did not authenticate');
            const sibling = await f.peer(); const siblingSession = await sibling.open(); await sibling.complete(siblingSession);
            const echo = async (marker: string) => {
                const port = ServerOptionStore.instance.serverOption.tunnelingOptions[1].forwardPort;
                const socket = net.createConnection({host: '127.0.0.1', port}); sockets.push(socket);
                socket.on('error', () => {}); await once(socket, 'connect');
                const data: Buffer[] = []; socket.on('data', bytes => data.push(bytes)); socket.write(marker);
                await until(() => Buffer.concat(data).toString() === marker, 'Actual wide endpoint echo failed');
                return socket;
            };
            await echo('before-framing');
            const pool = [...((f.server.tunnelServer as any)._clientHandlerPoolMap.values())].find((p: any) => !p.legacyMode) as any;
            await check({client, tunnel, pool, sibling, siblingSession, echo, sockets});
        } finally { sockets.forEach(socket => socket.destroy()); client.stop(); }
    });
}

test.each(['prefix', 'command', 'length', 'overflow'])('actual %s failure stays at client protocol boundary, cleans once and scheduled reconnect echoes', async mode => withClient(async h => {
    const old = h.tunnel._ctrlHandler;
    const procError = old.procError;
    let generic = 0, closed = 0;
    old.procError = function(...args: any[]) { generic++; return procError.apply(this, args); };
    const callback = h.tunnel._onCtrlStateCallback;
    const cleanup: any[] = [];
    h.tunnel._onCtrlStateCallback = (client: any, state: string, error: Error) => {
        if(state === 'closed') { closed++; cleanup.push({handlers: h.tunnel._activatedSessionDataHandlerMap.size,
            queues: h.tunnel._waitBufferQueueMap.size, bytes: h.tunnel._waitBufferBytesTotal, error}); }
        callback(client, state, error);
    };
    const malformed = CtrlPacket.createSyncCtrl().toBuffer();
    if(mode === 'prefix') malformed[0] ^= 255;
    if(mode === 'command') malformed[CtrlPacket.PREFIX_LEN] = 255;
    if(mode === 'length') malformed.writeUInt32BE(64001, CtrlPacket.HEADER_LEN - 4);
    // Existing configurable streamer limit gives deterministic actual receive overflow without a large write.
    if(mode === 'overflow') old.packetStreamer = new CtrlPacketStreamer({maxPendingBytes: 8});
    h.pool._controlHandler.sendData(malformed);
    await until(() => closed > 0, 'Malformed frame did not terminate current control owner');
    await until(() => h.client._tunnelClient !== h.tunnel && h.client._isOnline, 'Existing scheduler did not reconnect');
    await h.echo('after-framing');
    await h.sibling.roundtrip(h.siblingSession, 'unaffected-sibling');
    expect(generic).toBe(0); expect(closed).toBe(1);
    expect(cleanup).toEqual([{handlers: 0, queues: 0, bytes: 0, error: expect.any(Error)}]);
}));

test('real queued endpoint payload is cleared once at malformed control teardown and never replayed after scheduled reconnect', async () => {
    const evidence = mkdtempSync(join(tmpdir(), 'control45-queued-'));
    const facts: any = {};
    try {
        await withClient(async h => {
            const marker = 'owned-endpoint-waiting-payload-45';
            const endpointSockets: net.Socket[] = [];
            const endpoint = net.createServer(socket => {
                endpointSockets.push(socket);
                socket.on('error', () => {});
                socket.write(marker);
            });
            endpoint.listen(0, '127.0.0.1'); await once(endpoint, 'listening');
            const old = h.tunnel._ctrlHandler, send = old.sendData;
            const openEndpoint = h.tunnel._onConnectEndPointCallback;
            const stateCallback = h.tunnel._onCtrlStateCallback;
            const procError = old.procError;
            let generic = 0, closed = 0, held: {sessionID: number; packet: Buffer} | undefined;
            const cleanup: any[] = [], sent: Buffer[] = [];
            let waitState: any, queuedHandler: any;
            const received: Buffer[] = [];
            // Route only this owned session through the actual EndpointPool to a real greeting endpoint.
            h.tunnel._onConnectEndPointCallback = (id: number, opt: any) =>
                openEndpoint(id, {...opt, port: (endpoint.address() as net.AddressInfo).port});
            // Hold the real success packet and its callback before OnlineSession/ACK, without faking success.
            old.sendData = function(data: Buffer, callback: any) {
                if(data[CtrlPacket.PREFIX_LEN] === CtrlCmd.SuccessOfOpenSession) {
                    const packets = new CtrlPacketStreamer().readCtrlPacketList(data);
                    held = {sessionID: packets[0].sessionID, packet: Buffer.from(data)};
                    return;
                }
                return send.call(this, data, callback);
            };
            old.procError = function(...args: any[]) { generic++; return procError.apply(this, args); };
            h.tunnel._onCtrlStateCallback = (client: any, state: string, error: Error) => {
                if(state === 'closed') {
                    closed++;
                    cleanup.push({handlers: h.tunnel._activatedSessionDataHandlerMap.size,
                        queues: h.tunnel._waitBufferQueueMap.size, bytes: h.tunnel._waitBufferBytesTotal,
                        retainedBytes: waitState?.bytes, retainedQueue: waitState?.queue.size(),
                        dataDestroyed: queuedHandler?.socket.destroyed, controlDestroyed: old.socket.destroyed,
                        error: error instanceof Error});
                }
                stateCallback(client, state, error);
            };
            try {
                const forwardPort = ServerOptionStore.instance.serverOption.tunnelingOptions[1].forwardPort;
                const forward = net.createConnection({host: '127.0.0.1', port: forwardPort});
                h.sockets.push(forward); forward.on('error', () => {});
                forward.on('data', bytes => received.push(Buffer.from(bytes)));
                await once(forward, 'connect');
                await until(() => !!held && h.tunnel._waitBufferBytesTotal > 0, 'Actual endpoint payload did not enter waiting queue');
                waitState = h.tunnel._waitBufferQueueMap.get(held!.sessionID);
                queuedHandler = h.tunnel._activatedSessionDataHandlerMap.get(held!.sessionID);
                const dataSend = queuedHandler.sendData;
                queuedHandler.sendData = function(data: Buffer, ...args: any[]) {
                    sent.push(Buffer.from(data)); return dataSend.call(this, data, ...args);
                };
                facts.before = {bytes: h.tunnel._waitBufferBytesTotal, queueBytes: waitState.bytes,
                    marker: Buffer.concat(waitState.queue._queue).toString(), handlers: h.tunnel._activatedSessionDataHandlerMap.size,
                    queues: h.tunnel._waitBufferQueueMap.size, endpointConnections: endpointSockets.length,
                    heldCommand: held!.packet[CtrlPacket.PREFIX_LEN], forwardBytes: Buffer.concat(received).length};
                expect(facts.before.marker).toBe(marker);
                expect(facts.before.bytes).toBe(Buffer.byteLength(marker));
                expect(facts.before.queueBytes).toBe(Buffer.byteLength(marker));
                expect(facts.before.endpointConnections).toBe(1);
                expect(facts.before.forwardBytes).toBe(0);
                const malformed = CtrlPacket.createSyncCtrl().toBuffer(); malformed[0] ^= 255;
                h.pool._controlHandler.sendData(malformed);
                await until(() => closed > 0, 'Malformed frame did not terminate queued owner');
                facts.cleanup = cleanup;
                // Cancel the held old-owner packet; restore delegates before the genuine scheduled replacement.
                old.sendData = send; h.tunnel._onConnectEndPointCallback = openEndpoint;
                await until(() => h.client._tunnelClient !== h.tunnel && h.client._isOnline, 'Existing scheduler did not reconnect queued owner');
                const fresh = await h.echo('fresh-after-queued-framing');
                const lateFresh: Buffer[] = []; fresh.on('data', bytes => lateFresh.push(Buffer.from(bytes)));
                await h.sibling.roundtrip(h.siblingSession, 'sibling-after-queued-framing');
                facts.after = {generic, closed, oldSent: Buffer.concat(sent).toString(), oldForward: Buffer.concat(received).toString(),
                    lateFresh: Buffer.concat(lateFresh).toString(), oldBytes: h.tunnel._waitBufferBytesTotal,
                    oldQueues: h.tunnel._waitBufferQueueMap.size, oldHandlers: h.tunnel._activatedSessionDataHandlerMap.size,
                    freshEcho: true, siblingEcho: true, endpointDestroyed: endpointSockets.every(socket => socket.destroyed)};
                expect(facts.after).toEqual({generic: 0, closed: 1, oldSent: '', oldForward: '', lateFresh: '',
                    oldBytes: 0, oldQueues: 0, oldHandlers: 0, freshEcho: true, siblingEcho: true, endpointDestroyed: true});
                expect(cleanup).toEqual([{handlers: 0, queues: 0, bytes: 0, retainedBytes: 0, retainedQueue: 0,
                    dataDestroyed: true, controlDestroyed: true, error: true}]);
            } finally {
                old.sendData = send; h.tunnel._onConnectEndPointCallback = openEndpoint;
                endpointSockets.forEach(socket => socket.destroy());
                await new Promise<void>(resolve => endpoint.close(() => resolve()));
            }
        });
    } catch(error) { facts.failure = String(error); throw error; }
    finally {
        writeFileSync(join(evidence, 'facts.json'), JSON.stringify(facts, null, 2));
        process.stdout.write(`Queued control evidence: ${evidence}\n`);
    }
});

test('late terminal event from replaced real control handler cannot clear the replacement', async () => withClient(async h => {
    const old = h.tunnel._ctrlHandler; let closed = 0;
    const callback = h.tunnel._onCtrlStateCallback;
    h.tunnel._onCtrlStateCallback = (...args: any[]) => { if(args[1] === 'closed') closed++; callback(...args); };
    h.pool._controlHandler.endImmediate();
    await until(() => h.client._tunnelClient !== h.tunnel && h.client._isOnline, 'Scheduler did not replace control');
    const replacement = h.client._tunnelClient._ctrlHandler, before = closed;
    // Explicit delayed callback injection with a genuine old handler; no artificial replacement.
    h.tunnel.onCtrlHandlerEvent(old, SocketState.Closed);
    expect(h.client._tunnelClient._ctrlHandler).toBe(replacement); expect(closed).toBe(before);
    await h.echo('after-old-terminal');
    await h.sibling.roundtrip(h.siblingSession, 'sibling-after-old-terminal');
}));
