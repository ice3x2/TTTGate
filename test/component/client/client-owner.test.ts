import net from 'node:net';
import {once} from 'node:events';
import {withClient} from './data-terminal-fixture';
import {until} from '../server/legacy-handler-id-fixture';
import {TTTClientRuntimeRegistry} from '../../../src/client/TTTClientRuntime';
import SocketState from '../../../src/util/SocketState';
import {CtrlPacketStreamer, CtrlCmd} from '../../../src/commons/CtrlPacket';
import ServerOptionStore from '../../../src/server/ServerOptionStore';

jest.setTimeout(30_000);

test.each(['closed', 'endpoint-close', 'endpoint-terminate', 'endpoint-receive', 'tunnel-send'])('old upper %s cannot alter a real scheduled replacement', async kind => withClient(async h => {
    const old = h.tunnel, oldPool = h.client._endPointClientPool;
    const ctrl = old._onCtrlStateCallback, endpointClose = old._onEndPointCloseCallback;
    const endpointState = oldPool._onEndPointClientStateChangeCallback, terminate = oldPool._onEndPointTerminateCallback;
    const receive = old._onReceiveDataCallback;
    try {
    old._ctrlHandler.socket.destroy();
    await until(() => h.client._tunnelClient !== old && h.client._isOnline, 'Real scheduler replacement did not authenticate');
    const fresh = h.client._tunnelClient, freshPool = h.client._endPointClientPool;
    const socket = await h.echo('fresh-before-old');
    const handler = [...fresh._activatedSessionDataHandlerMap.values()][0] as any, sid = handler.sessionID;
    const endpoint = freshPool._endPointClientMap.get(sid);
    const received: Buffer[] = []; socket.on('data', bytes => received.push(Buffer.from(bytes)));
    if(kind === 'closed') ctrl(old, 'closed', new Error('owned stale upper callback'));
    if(kind === 'endpoint-close') endpointClose(sid, 0);
    if(kind === 'endpoint-terminate') terminate(sid);
    if(kind === 'endpoint-receive') endpointState(sid, SocketState.Receive, {data: Buffer.from('STALE'), receiveLength: 0});
    if(kind === 'tunnel-send') receive(sid, Buffer.from('STALE'));
    expect(h.client._isOnline).toBe(true); expect(h.client._reconnectTimer).toBeUndefined();
    expect(fresh._activatedSessionDataHandlerMap.get(sid)).toBe(handler);
    expect(freshPool._endPointClientMap.get(sid)).toBe(endpoint);
    socket.write('fresh-after-old');
    await until(() => Buffer.concat(received).includes('fresh-after-old'), 'Fresh echo lost after old upper callback');
    expect(Buffer.concat(received).toString()).toBe('fresh-after-old');
    await h.sibling.roundtrip(h.siblingSession, 'independent-sibling');
    expect(h.client._tunnelClient).toBe(fresh);
    } finally { oldPool.dispose(); old.destroy(); }
}));

test('explicit start retires real old resources before replacement connection callbacks', async () => withClient(async h => {
    const old = h.tunnel, pool = h.client._endPointClientPool;
    const control = old._ctrlHandler, data = [...old._activatedSessionDataHandlerMap.values()] as any[];
    try {
    h.client.start();
    expect(control.socket.destroyed).toBe(true);
    expect(data.every(handler => handler.socket.destroyed)).toBe(true);
    expect(pool._endPointClientMap.size).toBe(0);
    await until(() => h.client._isOnline, 'Explicit start replacement not online');
    await h.echo('explicit-fresh');
    } finally { pool.dispose(); old.destroy(); }
}));

test('stop cancels the creating scheduler and ignores its saved callback after real deadline', async () => withClient(async h => {
    const runtime = TTTClientRuntimeRegistry.current();
    let callback: (() => void) | undefined, scheduled: NodeJS.Timeout | undefined, clears = 0, fired = 0;
    const scheduler = {...runtime.scheduler,
        setTimeout: (fn: () => void, ms: number) => { callback = fn; scheduled = runtime.scheduler.setTimeout(() => { fired++; fn(); }, ms); return scheduled; },
        clearTimeout: (handle: NodeJS.Timeout | undefined) => { clears++; runtime.scheduler.clearTimeout(handle); }};
    TTTClientRuntimeRegistry.configure({scheduler, reconnectIntervalMs: 100});
    try {
        h.tunnel._ctrlHandler.socket.destroy();
        await until(() => callback !== undefined, 'Real close did not schedule reconnect');
        TTTClientRuntimeRegistry.configure({scheduler: runtime.scheduler});
        const old = h.client._tunnelClient;
        h.client.stop();
        expect(clears).toBe(1);
        await new Promise<void>(resolve => runtime.scheduler.setTimeout(resolve, 150));
        expect(fired).toBe(0);
        callback!();
        expect(h.client._tunnelClient).toBe(old); expect(h.client._stopped).toBe(true);
        expect(h.client._isOnline).toBe(false); expect(h.client._reconnectTimer).toBeUndefined();
        h.client.stop();
    } finally { runtime.scheduler.clearTimeout(scheduled); TTTClientRuntimeRegistry.configure(runtime); }
}));


test('old upper connected callback after stop cannot revive online state', async () => withClient(async h => {
    const old = h.tunnel, callback = old._onCtrlStateCallback;
    h.client.stop(); callback(old, 'connected');
    expect(h.client._stopped).toBe(true); expect(h.client._isOnline).toBe(false);
    expect(h.client._reconnectTimer).toBeUndefined();
}));

test.each(['termination', 'Connected', 'End', 'Closed'] as const)('old endpoint %s callback cannot clear fresh same-owner queued siblings or their aggregate', async state => withClient(async h => {
    const old = h.tunnel, oldPool = h.client._endPointClientPool;
    const oldTerminate = oldPool._onEndPointTerminateCallback;
    const oldState = oldPool._onEndPointClientStateChangeCallback;
    const peers: net.Socket[] = [];
    const greeting = Buffer.from('owned-fresh-queue');
    const server = net.createServer(socket => { peers.push(socket); socket.on('error', () => {}); socket.write(greeting); socket.pipe(socket); });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
        old._ctrlHandler.socket.destroy();
        await until(() => h.client._tunnelClient !== old && h.client._isOnline, 'Scheduled replacement not online');
        const fresh = h.client._tunnelClient, control = fresh._ctrlHandler;
        const originalOpen = fresh._onConnectEndPointCallback, send = control.sendData;
        const held: Array<{sid: number; bytes: Buffer; callback: any}> = [];
        const responses: Buffer[][] = [];
        fresh._onConnectEndPointCallback = (sid: number, option: any) => originalOpen(sid, {...option, port: (server.address() as net.AddressInfo).port});
        control.sendData = function(bytes: Buffer, callback: any) {
            const packet = new CtrlPacketStreamer().readCtrlPacketList(bytes)[0];
            if(packet?.cmd === CtrlCmd.SuccessOfOpenSession) { held.push({sid: packet.sessionID, bytes: Buffer.from(bytes), callback}); return; }
            return send.call(this, bytes, callback);
        };
        try {
            for(let i=0;i<2;i++) {
                const socket = net.createConnection({host: '127.0.0.1', port: ServerOptionStore.instance.serverOption.tunnelingOptions[1].forwardPort});
                h.sockets.push(socket); socket.on('error', () => {}); responses[i] = [];
                socket.on('data', data => responses[i].push(Buffer.from(data)));
                await until(() => held.length === i+1 && fresh._waitBufferBytesTotal === (i+1)*greeting.length, 'Actual greeting not queued');
            }
            const queues = held.map(item => fresh._waitBufferQueueMap.get(item.sid));
            const handlers = held.map(item => fresh._activatedSessionDataHandlerMap.get(item.sid));
            const sync = fresh.syncEndpointSession, close = fresh.closeEndPointSession;
            let syncCalls = 0, closeCalls = 0;
            fresh.syncEndpointSession = function(...args: any[]) { syncCalls++; return sync.apply(this, args); };
            fresh.closeEndPointSession = function(...args: any[]) { closeCalls++; return close.apply(this, args); };
            try {
                // Saved old-pool callback with a matching fresh SID is an explicit identity probe.
                if(state === 'termination') oldTerminate(held[0].sid);
                else oldState(held[0].sid, SocketState[state], {receiveLength: 0});
                expect({syncCalls, closeCalls}).toEqual({syncCalls: 0, closeCalls: 0});
                expect(h.client._tunnelClient).toBe(fresh);
                expect(h.client._reconnectTimer).toBeUndefined();
            } finally { fresh.syncEndpointSession = sync; fresh.closeEndPointSession = close; }
            expect(fresh._waitBufferBytesTotal).toBe(2*greeting.length);
            held.forEach((item,i) => { expect(fresh._waitBufferQueueMap.get(item.sid)).toBe(queues[i]); expect(fresh._activatedSessionDataHandlerMap.get(item.sid)).toBe(handlers[i]); });
            for(const item of held) send.call(control, item.bytes, item.callback);
            await until(() => responses.every(bytes => Buffer.concat(bytes).equals(greeting)), 'Fresh siblings did not deliver exactly once');
            expect(fresh._waitBufferBytesTotal).toBe(0);
            for(let i=0;i<2;i++) h.sockets[h.sockets.length-2+i].write('echo');
            await until(() => responses.every(bytes => Buffer.concat(bytes).equals(Buffer.concat([greeting, Buffer.from('echo')]))), 'Fresh sibling echo failed');
            await h.sibling.roundtrip(h.siblingSession, 'other-owner');
        } finally { fresh._onConnectEndPointCallback = originalOpen; control.sendData = send; }
    } finally { peers.forEach(socket => socket.destroy()); await new Promise<void>(resolve => server.close(() => resolve())); oldPool.dispose(); old.destroy(); }
}));
