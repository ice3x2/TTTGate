import net from 'node:net';
import {once} from 'node:events';
import {withClient} from './data-terminal-fixture';
import {until} from '../server/legacy-handler-id-fixture';
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer} from '../../../src/commons/CtrlPacket';
import ServerOptionStore from '../../../src/server/ServerOptionStore';
import SocketState from '../../../src/util/SocketState';
import {SocketHandler} from '../../../src/util/SocketHandler';
import {DataHandlerState} from '../../../src/types/TunnelHandler';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

jest.setTimeout(30_000);
const parse = (data: Buffer) => new CtrlPacketStreamer().readCtrlPacketList(data)[0];
const greeting = 'owned-endpoint-waiting-payload-45'; // 33 actual bytes

function evidence(name: string, facts: unknown) {
    const root = mkdtempSync(join(tmpdir(), `data24-${name}-`));
    writeFileSync(join(root, 'facts.json'), JSON.stringify(facts, null, 2));
    process.stdout.write(`Data terminal evidence: ${root}\n`);
}

test('same-session pending replacement retires A immediately and global stop rejects held A/B Connected callbacks', async () => withClient(async h => {
    const sockets: net.Socket[] = [];
    const accept = net.createServer(socket => { sockets.push(socket); socket.on('error', () => {}); });
    accept.listen(0, '127.0.0.1'); await once(accept, 'listening');
    const original = SocketHandler.connect;
    const attempts: Array<{handler: SocketHandler; release: () => void}> = [];
    const facts: any = {};
    const sid = 900001;
    const control = h.tunnel._ctrlHandler, send = control.sendData;
    let notifications = 0;
    control.sendData = function(bytes: Buffer, callback: any) { notifications++; return send.call(this, bytes, callback); };
    // Actual owned sockets connect; only application delivery of their native Connected callback is held.
    SocketHandler.connect = (_options, event) => original({host: '127.0.0.1', port: (accept.address() as net.AddressInfo).port, tls: false}, (handler, state, data) => {
        if(state === SocketState.Connected) { attempts.push({handler, release: () => event(handler, state, data)}); return; }
        event(handler, state, data);
    });
    try {
        h.tunnel.connectDataHandler(70001, sid, 'owned-A');
        await until(() => attempts.length === 1, 'Actual A connection not observed');
        h.tunnel.connectDataHandler(70002, sid, 'owned-B');
        await until(() => attempts.length === 2, 'Actual B connection not observed');
        facts.beforeStop = {aDestroyed: attempts[0].handler.socket.destroyed, bDestroyed: attempts[1].handler.socket.destroyed,
            active: h.tunnel._activatedSessionDataHandlerMap.has(sid), queued: h.tunnel._waitBufferQueueMap.has(sid)};
        SocketHandler.connect = original;
        h.client.stop();
        facts.afterStop = {aDestroyed: attempts[0].handler.socket.destroyed, bDestroyed: attempts[1].handler.socket.destroyed};
        const beforeRelease = notifications;
        attempts.forEach(attempt => attempt.release());
        facts.afterRelease = {active: h.tunnel._activatedSessionDataHandlerMap.size, queues: h.tunnel._waitBufferQueueMap.size,
            bytes: h.tunnel._waitBufferBytesTotal, pending: h.tunnel._pendingDataAttempts?.size,
            notifications: notifications - beforeRelease};
        expect(facts.beforeStop).toEqual({aDestroyed: true, bDestroyed: false, active: false, queued: false});
        expect(facts.afterStop).toEqual({aDestroyed: true, bDestroyed: true});
        expect(facts.afterRelease).toEqual({active: 0, queues: 0, bytes: 0, pending: 0, notifications: 0});
    } finally {
        evidence('pending', facts);
        SocketHandler.connect = original; control.sendData = send;
        attempts.forEach(attempt => attempt.handler.destroy()); sockets.forEach(socket => socket.destroy());
        await new Promise<void>(resolve => accept.close(() => resolve()));
    }
}));

test('actual server CloseSession settles an owned pending attempt once before a held Connected callback', async () => withClient(async h => {
    const sockets: net.Socket[] = [];
    const accept = net.createServer(socket => { sockets.push(socket); socket.on('error', () => {}); });
    accept.listen(0, '127.0.0.1'); await once(accept, 'listening');
    const original = SocketHandler.connect, connect = h.tunnel.connectDataHandler;
    const close = h.tunnel._onEndPointCloseCallback, receive = h.tunnel.onReceiveFromCtrlHandler;
    const stream = new CtrlPacketStreamer(); let consumed = 0, sid = -1, local = 0;
    let pending: SocketHandler | undefined, release: (() => void) | undefined;
    const facts: any = {};
    h.tunnel.connectDataHandler = (hid: number, id: number, token: string) => {
        sid = id;
        SocketHandler.connect = (_options, event) => original({host: '127.0.0.1', port: (accept.address() as net.AddressInfo).port, tls: false}, (handler, state, data) => {
            if(state === SocketState.Connected) { pending = handler; release = () => event(handler, state, data); return; }
            event(handler, state, data);
        });
        try { return connect.call(h.tunnel, hid, id, token); } finally { SocketHandler.connect = original; }
    };
    h.tunnel.onReceiveFromCtrlHandler = (handler: any, bytes: Buffer) => {
        const result = receive.call(h.tunnel, handler, bytes);
        consumed += stream.readCtrlPacketList(bytes).filter(packet => packet.cmd === CtrlCmd.CloseSession && packet.sessionID === sid).length;
        return result;
    };
    h.tunnel._onEndPointCloseCallback = (id: number, ...args: any[]) => { if(id === sid) local++; close(id, ...args); };
    try {
        const forward = net.createConnection({host: '127.0.0.1', port: ServerOptionStore.instance.serverOption.tunnelingOptions[1].forwardPort});
        h.sockets.push(forward); forward.on('error', () => {}); await once(forward, 'connect');
        await until(() => !!release, 'Actual pending connection not observed');
        expect(h.pool._pendingSessionIDMap.has(sid)).toBe(true);
        expect(h.tunnel._pendingDataAttempts.has(sid)).toBe(true);
        h.pool.sendCloseSession(sid, 0);
        await until(() => consumed === 1, 'Actual pending CloseSession not consumed');
        facts.afterClose = {pending: h.tunnel._pendingDataAttempts.has(sid), destroyed: pending!.socket.destroyed, local};
        release!();
        facts.afterRelease = {active: h.tunnel._activatedSessionDataHandlerMap.has(sid), queued: h.tunnel._waitBufferQueueMap.has(sid), local};
        expect(facts.afterClose).toEqual({pending: false, destroyed: true, local: 1});
        expect(facts.afterRelease).toEqual({active: false, queued: false, local: 1});
    } finally {
        evidence('pending-close', facts);
        SocketHandler.connect = original; h.tunnel.connectDataHandler = connect;
        h.tunnel._onEndPointCloseCallback = close; h.tunnel.onReceiveFromCtrlHandler = receive;
        pending?.destroy(); sockets.forEach(socket => socket.destroy());
        await new Promise<void>(resolve => accept.close(() => resolve()));
    }
}));

test('queued target terminal clears only A before held server close; B bytes and active same-owner sibling survive', async () => withClient(async h => {
    const control = h.tunnel._ctrlHandler, endpointPool = h.client._endPointClientPool;
    const active = [...h.tunnel._activatedSessionDataHandlerMap.values()][0] as any;
    const activeID = active.sessionID;
    const endpoints: net.Socket[] = [];
    const endpoint = net.createServer(socket => { endpoints.push(socket); socket.on('error', () => {}); socket.write(greeting); socket.pipe(socket); });
    endpoint.listen(0, '127.0.0.1'); await once(endpoint, 'listening');
    const send = control.sendData, serverSend = h.pool._controlHandler.sendData;
    const open = h.tunnel._onConnectEndPointCallback, close = h.tunnel._onEndPointCloseCallback;
    const held = new Map<number, {bytes: Buffer; callback: any}>();
    const remote: Array<{bytes: Buffer; callback: any}> = [], peer: any[] = [], local: number[] = [];
    const facts: any = {};
    let remoteConsumed = 0;
    const remoteStream = new CtrlPacketStreamer();
    const receive = h.tunnel.onReceiveFromCtrlHandler;
    h.tunnel.onReceiveFromCtrlHandler = (handler: any, bytes: Buffer) => {
        const result = receive.call(h.tunnel, handler, bytes);
        remoteConsumed += remoteStream.readCtrlPacketList(bytes).filter(packet => packet.cmd === CtrlCmd.CloseSession && packet.sessionID === target).length;
        return result;
    };
    let target = -1;
    h.tunnel._onConnectEndPointCallback = (id: number, opt: any) => open(id, {...opt, port: (endpoint.address() as net.AddressInfo).port});
    control.sendData = function(bytes: Buffer, callback: any) {
        const packet = parse(bytes); peer.push(packet);
        if(packet?.cmd === CtrlCmd.SuccessOfOpenSession) { held.set(packet.sessionID, {bytes: Buffer.from(bytes), callback}); return; }
        return send.call(this, bytes, callback);
    };
    h.pool._controlHandler.sendData = function(bytes: Buffer, callback: any) {
        const packet = parse(bytes);
        if(packet?.cmd === CtrlCmd.CloseSession && packet.sessionID === target) { remote.push({bytes: Buffer.from(bytes), callback}); return; }
        return serverSend.call(this, bytes, callback);
    };
    h.tunnel._onEndPointCloseCallback = (id: number, ...args: any[]) => { local.push(id); close(id, ...args); };
    const forwards: Array<{socket: net.Socket; received: Buffer[]}> = [];
    try {
        for(let index = 0; index < 2; index++) {
            const socket = net.createConnection({host: '127.0.0.1', port: ServerOptionStore.instance.serverOption.tunnelingOptions[1].forwardPort});
            h.sockets.push(socket); socket.on('error', () => {});
            const received: Buffer[] = []; socket.on('data', bytes => received.push(Buffer.from(bytes)));
            forwards.push({socket, received}); await once(socket, 'connect');
            await until(() => held.size === index + 1 && h.tunnel._waitBufferBytesTotal === (index + 1) * Buffer.byteLength(greeting), 'Real greeting did not queue');
        }
        const [a, b] = [...held.keys()]; target = a;
        const ah = h.tunnel._activatedSessionDataHandlerMap.get(a), bh = h.tunnel._activatedSessionDataHandlerMap.get(b);
        const aq = h.tunnel._waitBufferQueueMap.get(a), bq = h.tunnel._waitBufferQueueMap.get(b);
        expect(aq.bytes).toBe(33); expect(bq.bytes).toBe(33);
        const ownedEndpoint = endpointPool._endPointClientMap.get(a);
        expect(ownedEndpoint).toBeDefined();
        const endpointTerminal: string[] = [];
        ownedEndpoint.socket.once('end', () => endpointTerminal.push('end'));
        ownedEndpoint.socket.once('close', () => endpointTerminal.push('close'));
        let terminal = 0; const event = ah._event;
        ah.onSocketEvent = (...args: any[]) => { if(args[1] === SocketState.End || args[1] === SocketState.Closed) terminal++; return event(...args); };
        // Explicit remote-close injection through the real server producer; delivery remains held.
        h.pool.sendCloseSession(a, 0);
        ah.socket.destroy();
        await until(() => terminal > 0, 'Native data terminal not observed');
        await until(() => remote.length > 0, 'Actual server target CloseSession was not held');
        facts.beforeRelease = {aBytes: aq.bytes, bBytes: bq.bytes, total: h.tunnel._waitBufferBytesTotal,
            local: local.filter(id => id === a).length, held: remote.map(item => ({cmd: parse(item.bytes).cmd, sessionID: parse(item.bytes).sessionID})), remoteConsumed};
        expect(remote.every(item => parse(item.bytes).cmd === CtrlCmd.CloseSession && parse(item.bytes).sessionID === a)).toBe(true);
        expect(remoteConsumed).toBe(0);
        expect(h.tunnel._activatedSessionDataHandlerMap.has(a)).toBe(false);
        expect(aq.bytes).toBe(0); expect(aq.queue.size()).toBe(0);
        expect(h.tunnel._waitBufferBytesTotal).toBe(33);
        expect(h.tunnel._waitBufferQueueMap.get(b)).toBe(bq); expect(bq.bytes).toBe(33);
        expect(h.tunnel._activatedSessionDataHandlerMap.get(b)).toBe(bh);
        expect(local.filter(id => id === a)).toHaveLength(1);
        expect(peer.filter(p => p.sessionID === a && p.cmd === CtrlCmd.FailOfOpenSession)).toHaveLength(1);
        facts.endpointBeforeBarrier = {native: [...endpointTerminal], mapped: endpointPool._endPointClientMap.get(a) === ownedEndpoint};
        const endpointWaitStarted = Date.now();
        await until(() => endpointTerminal.length > 0 && !endpointPool._endPointClientMap.has(a), 'Owned endpoint native terminal/map cleanup not observed');
        facts.endpointAfterBarrier = {native: [...endpointTerminal], mapped: endpointPool._endPointClientMap.has(a),
            elapsedMs: Date.now() - endpointWaitStarted, remoteConsumed};
        expect(remoteConsumed).toBe(0);
        expect(endpointPool._endPointClientMap.has(a)).toBe(false);
        expect(h.tunnel._ctrlHandler).toBe(control); expect(h.client._tunnelClient).toBe(h.tunnel);
        expect(h.tunnel._activatedSessionDataHandlerMap.get(activeID)).toBe(active);
        const success = held.get(b)!; held.delete(b); send.call(control, success.bytes, success.callback);
        await until(() => Buffer.concat(forwards[1].received).toString() === greeting, 'B greeting not delivered exactly once');
        forwards[1].socket.write('B-echo');
        await until(() => Buffer.concat(forwards[1].received).toString() === greeting + 'B-echo', 'B echo failed');
        const siblingBytes: Buffer[] = [];
        h.sockets[0].on('data', (bytes: Buffer) => siblingBytes.push(Buffer.from(bytes)));
        h.sockets[0].write('active-sibling');
        await until(() => Buffer.concat(siblingBytes).toString() === 'active-sibling', 'Same-control active sibling echo failed');
        for(const item of remote) serverSend.call(h.pool._controlHandler, item.bytes, item.callback);
        await until(() => remoteConsumed > 0, 'Released server CloseSession was not consumed');
        event(ah, SocketState.Closed); event(ah, SocketState.End);
        facts.afterRelease = {local: local.filter(id => id === a).length, remoteConsumed,
            bOwned: h.tunnel._activatedSessionDataHandlerMap.get(b) === bh, total: h.tunnel._waitBufferBytesTotal};
        expect(local.filter(id => id === a)).toHaveLength(1);
        expect(h.tunnel._activatedSessionDataHandlerMap.get(b)).toBe(bh);
        expect(h.tunnel._waitBufferBytesTotal).toBe(0);
    } finally {
        evidence('queued', facts);
        h.tunnel.onReceiveFromCtrlHandler = receive;
        control.sendData = send; h.pool._controlHandler.sendData = serverSend;
        h.tunnel._onConnectEndPointCallback = open; h.tunnel._onEndPointCloseCallback = close;
        held.clear(); remote.length = 0; endpoints.forEach(socket => socket.destroy());
        await new Promise<void>(resolve => endpoint.close(() => resolve()));
    }
}));

test('online terminal and repeated old same-session callback preserve a real replacement', async () => withClient(async h => {
    const control = h.tunnel._ctrlHandler;
    const handler = [...h.tunnel._activatedSessionDataHandlerMap.values()][0] as any;
    const sid = handler.sessionID, hid = handler.handlerID, token = handler.bindingToken;
    const endpointPool = h.client._endPointClientPool;
    const oldEndpoint = endpointPool._endPointClientMap.get(sid);
    expect(oldEndpoint).toBeDefined();
    const nativeTerminal: string[] = [];
    oldEndpoint.socket.once('end', () => nativeTerminal.push('end'));
    oldEndpoint.socket.once('close', () => nativeTerminal.push('close'));
    const terminate = endpointPool._onEndPointTerminateCallback;
    let terminateSettled = false;
    const facts: any = {sid, oldEndpointId: oldEndpoint.id};
    endpointPool._onEndPointTerminateCallback = (...args: any[]) => {
        const result = terminate?.(...args);
        if(args[0] === sid) terminateSettled = true;
        return result;
    };
    const event = handler._event, serverSend = h.pool._controlHandler.sendData, send = control.sendData;
    const packets: any[] = []; let local = 0;
    const close = h.tunnel._onEndPointCloseCallback;
    h.tunnel._onEndPointCloseCallback = (id: number, ...args: any[]) => { if(id === sid) local++; close(id, ...args); };
    h.pool._controlHandler.sendData = function(bytes: Buffer, callback: any) { if(parse(bytes)?.cmd === CtrlCmd.CloseSession) return; return serverSend.call(this, bytes, callback); };
    control.sendData = function(bytes: Buffer, callback: any) { packets.push(parse(bytes)); return send.call(this, bytes, callback); };
    try {
        handler.socket.destroy(); await until(() => handler.socket.destroyed && handler.isEnd(), 'Online terminal not observed');
        expect(local).toBe(1); expect(h.tunnel._activatedSessionDataHandlerMap.has(sid)).toBe(false);
        expect(packets.filter(p => p.cmd === CtrlCmd.CloseSession && p.sessionID === sid)).toHaveLength(1);
        facts.beforeReplacement = {native: [...nativeTerminal], terminateSettled,
            endpointMapped: endpointPool._endPointClientMap.has(sid),
            dataMapped: h.tunnel._activatedSessionDataHandlerMap.has(sid)};
        await until(() => nativeTerminal.length > 0 && terminateSettled && !endpointPool._endPointClientMap.has(sid),
            'Old endpoint native terminal and posted termination not settled');
        expect(nativeTerminal.length > 0 && terminateSettled && !endpointPool._endPointClientMap.has(sid)).toBe(true);
        facts.afterEndpointSettlement = {native: [...nativeTerminal], terminateSettled,
            endpointMapped: endpointPool._endPointClientMap.has(sid)};
        // Real replacement socket under same local identity; stop remote admission through owned connect routing below.
        const acceptSockets: net.Socket[] = [];
        const accept = net.createServer(socket => { acceptSockets.push(socket); socket.on('error', () => {}); });
        accept.listen(0, '127.0.0.1'); await once(accept, 'listening');
        const make = h.tunnel.makeConnectOpt;
        try {
            h.tunnel.makeConnectOpt = () => ({host: '127.0.0.1', port: (accept.address() as net.AddressInfo).port, tls: false});
            h.tunnel.connectDataHandler(hid, sid, token);
            facts.replacementPending = {dataMapped: h.tunnel._activatedSessionDataHandlerMap.has(sid),
                queueAllocated: h.tunnel._waitBufferQueueMap.has(sid)};
            await until(() => h.tunnel._activatedSessionDataHandlerMap.has(sid), 'Real replacement not connected');
            const replacement = h.tunnel._activatedSessionDataHandlerMap.get(sid);
            facts.replacementActive = {id: replacement.id, sameOld: replacement === handler, sid: replacement.sessionID};
            const queue = h.tunnel._waitBufferQueueMap.get(sid);
            event(handler, SocketState.Closed);
            expect(h.tunnel._activatedSessionDataHandlerMap.get(sid)).toBe(replacement);
            expect(h.tunnel._waitBufferQueueMap.get(sid)).toBe(queue); expect(local).toBe(1);
            replacement.dataHandlerState = DataHandlerState.Terminated;
            const before = packets.length; replacement.destroy();
            expect(packets.length).toBe(before);
        } finally { h.tunnel.makeConnectOpt = make; acceptSockets.forEach(socket => socket.destroy()); await new Promise<void>(resolve => accept.close(() => resolve())); }
        expect(h.tunnel._ctrlHandler).toBe(control);
    } finally {
        evidence('online-replacement', facts);
        endpointPool._onEndPointTerminateCallback = terminate;
        control.sendData = send; h.pool._controlHandler.sendData = serverSend; h.tunnel._onEndPointCloseCallback = close;
    }
}));

test('real server-issued attempt refused before Connected consumes one failed open without reconnect', async () => withClient(async h => {
    const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = (reservation.address() as net.AddressInfo).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    const original = SocketHandler.connect, connectData = h.tunnel.connectDataHandler;
    const close = h.tunnel._onEndPointCloseCallback, delegate = h.pool.delegateReceivePacketOfControlHandler;
    const control = h.tunnel._ctrlHandler;
    let connected = 0, terminals = 0, local = 0, appBytes = 0;
    let sid = -1, hid = -1, pendingBefore = false;
    const errors: string[] = [], consumed: any[] = []; const facts: any = {};
    h.tunnel.connectDataHandler = (handlerID: number, sessionID: number, token: string) => {
        sid = sessionID; hid = handlerID; pendingBefore = h.pool._pendingSessionIDMap.has(sid);
        // Route only this actual server-issued attempt. Abort a reclaimed-port connection before application delivery.
        SocketHandler.connect = (_options, event) => {
            const handler = original({host: '127.0.0.1', port, tls: false}, (handler, state, data) => {
                if(state === SocketState.Connected) { connected++; handler.destroy(); return; }
                if(state === SocketState.End || state === SocketState.Closed) terminals++;
                event(handler, state, data);
            });
            handler.socket.on('error', (error: NodeJS.ErrnoException) => errors.push(error.code ?? ''));
            const write = handler.sendData;
            handler.sendData = function(bytes: Buffer, ...args: any[]) { appBytes += bytes.length; return write.call(this, bytes, ...args); };
            return handler;
        };
        try { return connectData.call(h.tunnel, handlerID, sessionID, token); }
        finally { SocketHandler.connect = original; }
    };
    h.pool.delegateReceivePacketOfControlHandler = (handler: any, packet: CtrlPacket) => {
        const result = delegate.call(h.pool, handler, packet);
        if(packet.cmd === CtrlCmd.FailOfOpenSession && packet.sessionID === sid) consumed.push({sid: packet.sessionID, hid: packet.handlerWideIdMeta?.handlerID});
        return result;
    };
    h.tunnel._onEndPointCloseCallback = (id: number, ...args: any[]) => { if(id === sid) local++; close(id, ...args); };
    try {
        const forward = net.createConnection({host: '127.0.0.1', port: ServerOptionStore.instance.serverOption.tunnelingOptions[1].forwardPort});
        h.sockets.push(forward); forward.on('error', () => {}); await once(forward, 'connect');
        await until(() => terminals > 0, 'Owned refused connection terminal did not arrive');
        facts.native = {connected, appBytes, errors, sid, hid, pendingBefore, local};
        expect({connected, appBytes, errors, pendingBefore}).toEqual({connected: 0, appBytes: 0, errors: ['ECONNREFUSED'], pendingBefore: true});
        await until(() => consumed.length > 0, 'Actual server did not consume failed open');
        await until(() => !h.pool._pendingSessionIDMap.has(sid), 'Server pending attempt not removed');
        facts.after = {consumed, local, clientActive: h.tunnel._activatedSessionDataHandlerMap.has(sid), serverPending: h.pool._pendingSessionIDMap.has(sid)};
        expect(consumed).toEqual([{sid, hid}]); expect(local).toBe(1);
        expect(h.tunnel._activatedSessionDataHandlerMap.has(sid)).toBe(false);
        expect(h.tunnel._ctrlHandler).toBe(control); expect(h.client._tunnelClient).toBe(h.tunnel);
        await h.sibling.roundtrip(h.siblingSession, 'refused-sibling');
        facts.siblingEcho = true;
    } finally {
        evidence('refused', facts);
        SocketHandler.connect = original; h.tunnel.connectDataHandler = connectData;
        h.tunnel._onEndPointCloseCallback = close; h.pool.delegateReceivePacketOfControlHandler = delegate;
    }
}));

test('replayed terminal for an actual old data handler cannot remove same-session replacement', async () => withClient(async h => {
    const old = [...h.tunnel._activatedSessionDataHandlerMap.values()][0] as any;
    const sid = old.sessionID, event = old._event;
    // Existing explicit local endpoint termination is a baseline control, not the native-terminal fix.
    h.tunnel.terminateEndPointSession(sid);
    const peers: net.Socket[] = [];
    const accept = net.createServer(socket => { peers.push(socket); socket.on('error', () => {}); });
    accept.listen(0, '127.0.0.1'); await once(accept, 'listening');
    const make = h.tunnel.makeConnectOpt, close = h.tunnel._onEndPointCloseCallback;
    let closed = 0;
    try {
        h.tunnel.makeConnectOpt = () => ({host: '127.0.0.1', port: (accept.address() as net.AddressInfo).port, tls: false});
        h.tunnel.connectDataHandler(old.handlerID, sid, old.bindingToken);
        await until(() => h.tunnel._activatedSessionDataHandlerMap.has(sid), 'Replacement actual socket not published');
        const replacement = h.tunnel._activatedSessionDataHandlerMap.get(sid), queue = h.tunnel._waitBufferQueueMap.get(sid);
        h.tunnel._onEndPointCloseCallback = (id: number, ...args: any[]) => { closed++; close(id, ...args); };
        event(old, SocketState.End); event(old, SocketState.Closed);
        expect(h.tunnel._activatedSessionDataHandlerMap.get(sid)).toBe(replacement);
        expect(h.tunnel._waitBufferQueueMap.get(sid)).toBe(queue); expect(closed).toBe(0);
    } finally {
        h.tunnel.makeConnectOpt = make; h.tunnel._onEndPointCloseCallback = close;
        peers.forEach(socket => socket.destroy()); await new Promise<void>(resolve => accept.close(() => resolve()));
    }
}));
