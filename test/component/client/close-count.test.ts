import {withClient} from './data-terminal-fixture';
import {until} from '../server/legacy-handler-id-fixture';
import {CtrlCmd, CtrlPacket} from '../../../src/commons/CtrlPacket';
import {DEFAULT_PROTOCOL_V2_CAPABILITIES} from '../../../src/commons/ProtocolV2';
import LoggerFactory from '../../../src/util/logger/LoggerFactory';
import net from 'node:net';
import {once} from 'node:events';
import ServerOptionStore from '../../../src/server/ServerOptionStore';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';

jest.setTimeout(30_000);
const target = 0x100000000 + 17;
test.each([true, false])('accepted final input respects exact target, close before output drain=%s', async closeBeforeDrain => withClient(async h => {
    const data = [...h.tunnel._activatedSessionDataHandlerMap.values()][0] as any, sid = data.sessionID;
    const endpoint = h.client._endPointClientPool._endPointClientMap.get(sid);
    // Explicit counter preparation, not a claim of a 4GiB transfer. The remaining bytes use the real tunnel/socket writer.
    endpoint._sendLength = target - 3;
    const native = endpoint.socket;
    const facts: any[] = [];
    const record = (event: string) => facts.push({event, now: Date.now(), closeBeforeDrain, sid,
        input: data.receiveLength, inputSent: h.sockets[0].bytesWritten, sendLength: endpoint.sendLength,
        dataState: data.dataHandlerState, closeWait: endpoint.closeWait, endLength: endpoint.endLength,
        nativeBytes: native.writableLength, drained: endpoint.isOutputDrained, destroyed: native.destroyed});
    const ep = h.client._endPointClientPool, check = ep.closeIfSatisfiedLength, send = endpoint.sendData;
    ep.closeIfSatisfiedLength = function(handler: any, ...args: any[]) {
        if(handler === endpoint) record('close-check-before');
        const result = check.call(this, handler, ...args);
        if(handler === endpoint) record('close-check-after');
        return result;
    };
    endpoint.sendData = function(bytes: Buffer, callback?: any) {
        record('endpoint-send');
        return send.call(this, bytes, (handler: any, success: boolean, error: any) => {
            record('write-callback-before');
            const result = callback?.(handler, success, error);
            record('write-callback-after');
            return result;
        });
    };
    const drain = () => record('native-drain');
    native.on('drain', drain);
    record('prepared');
    native.cork();
    try {
        // Admit final input before terminal control; this case tests output-drain ordering, not post-terminal input acceptance.
        h.sockets[0].write('end');
        record('remaining-input-written');
        await until(() => native.writableLength > 0, 'Real endpoint native write not held');
        if(closeBeforeDrain) {
            h.pool.sendCloseSession(sid, target);
            await until(() => endpoint.closeWait, 'Large target was not installed');
            expect(endpoint.endLength).toBe(target);
        }
        expect(endpoint.sendLength).toBe(target - 3);
        expect(endpoint.isOutputDrained).toBe(false);
        expect(native.destroyed).toBe(false);
        native.uncork();
        record('uncorked');
        await until(() => endpoint.sendLength === target && endpoint.isOutputDrained, 'Accepted final input did not reach exact count and drain');
        expect(endpoint.sendLength).toBe(target);
        expect(endpoint.isOutputDrained).toBe(true);
        record('exact-count-drained');
        if(!closeBeforeDrain) h.pool.sendCloseSession(sid, target);
        // Existing pool cleanup scans every10s. Observe it naturally, without invoking a private check or widening the30s case.
        const scanDeadline = Date.now() + 12_000;
        while(!native.destroyed && Date.now() < scanDeadline) await delay(5);
        expect(native.destroyed).toBe(true);
        expect(endpoint.endLength).toBe(target);
        await h.sibling.roundtrip(h.siblingSession, 'near-count-other-owner');
    } finally {
        record('finally-before-restore');
        ep.closeIfSatisfiedLength = check; endpoint.sendData = send; native.off('drain', drain);
        native.uncork();
        const E = fs.mkdtempSync(path.join(tmpdir(), 'count28-near-observation-'));
        fs.writeFileSync(path.join(E, 'facts.json'), JSON.stringify(facts, null, 2));
        process.stdout.write(`Close count observations: ${E}\n`);
    }
}));
test.each([target, NaN])('legacy server producer aborts only its unsupported control without serializing a saturated close (count=%s)', async count => withClient(async h => {
    const control = h.sibling.control;
    const packets: number[] = [];
    const pool = h.sibling.pool, send = pool._controlHandler.sendData;
    const pending = await h.sibling.open();
    pending.socket.write('owned-pending-close-count');
    await until(() => pool._bufferSize > 0, 'Actual pending pool bytes did not queue');
    const active = [...pool._activatedSessionHandlerMap_.values()] as any[];
    const queue = pool._waitingDataBufferQueueMap.get(pending.packet.sessionID);
    const activeHandlerID = pool._activatedSessionHandlerMap_.get(h.siblingSession.packet.sessionID).handlerID;
    const error = jest.spyOn(LoggerFactory.getLogger('server', 'ClientHandlerPool'), 'error');
    pool._controlHandler.sendData = function(bytes: Buffer, ...args: any[]) {
        const packet = CtrlPacket.fromBuffer(bytes).packet;
        if(packet?.cmd === CtrlCmd.CloseSession) packets.push(packet.waitReceiveLength);
        return send.call(this, bytes, ...args);
    };
    try {
        pool.sendCloseSession(h.siblingSession.packet.sessionID, count);
        await until(() => control.destroyed, 'Unsupported legacy control not closed');
        expect(packets).toEqual([]);
        await until(() => active.every(handler => handler.socket.destroyed) && pending.socket.destroyed, 'Owned sessions remained after control abort');
        const category = Number.isNaN(count) ? 'E_CLOSE_COUNT_INVALID' : 'E_CLOSE_COUNT_UNSUPPORTED';
        expect({active: pool._activatedSessionHandlerMap_.size, pending: pool._pendingSessionIDMap.size,
            queues: pool._waitingDataBufferQueueMap.size, bytes: pool._bufferSize, queueBytes: queue.sendBytes + queue.receiveBytes,
            diagnostic: error.mock.calls.some(args => String(args[0]).includes(`${category} direction=server sessionID=${h.siblingSession.packet.sessionID} handlerID=${activeHandlerID}`))})
            .toEqual({active: 0, pending: 0, queues: 0, bytes: 0, queueBytes: 0, diagnostic: true});
        expect(h.server._clientHandlerPoolMap.has(pool.id)).toBe(false);
        expect([...h.server._sessionIDAndCtrlIDMap.values()]).not.toContain(pool.id);
        expect(h.server._sessionLastActivityMs.has(pending.packet.sessionID)).toBe(false);
        await h.echo('supported-owner-survives');
    } finally { pool._controlHandler.sendData = send; error.mockRestore(); }
}));

test('client reconnect to a server without advertised capability clears large-count support', async () => withClient(async h => {
    const original = CtrlPacket.createSyncCtrlAck;
    const old = h.tunnel;
    // Actual server producer still serializes/sends SyncCtrlAck; only this connection's advertised list is old-peer input.
    const spy = jest.spyOn(CtrlPacket, 'createSyncCtrlAck').mockImplementation((id, meta) => original(id,
        meta ? {...meta, capabilities: meta.capabilities.filter(value => value !== ('close-count-safe' as any))} : undefined));
    const endpointSockets: net.Socket[] = [];
    const restores: Array<() => void> = [];
    const endpoint = net.createServer(socket => { endpointSockets.push(socket); socket.on('error', () => {}); socket.write('owned-count-waiting'); });
    endpoint.listen(0, '127.0.0.1'); await once(endpoint, 'listening');
    try {
        h.client.start();
        const next = h.client._tunnelClient;
        await until(() => h.client._isOnline && next !== old, 'Actual replacement control not authenticated');
        await h.echo('old-peer-ready');
        const data = [...next._activatedSessionDataHandlerMap.values()][0] as any;
        const control = next._ctrlHandler, sent: Buffer[] = [], send = control.sendData;
        const endpointPool = h.client._endPointClientPool, open = next._onConnectEndPointCallback;
        restores.push(() => { next._onConnectEndPointCallback = open; control.sendData = send; });
        next._onConnectEndPointCallback = (id: number, option: any) => open(id, {...option, port: (endpoint.address() as net.AddressInfo).port});
        control.sendData = function(bytes: Buffer, ...args: any[]) {
            const packet = CtrlPacket.fromBuffer(bytes).packet;
            if(packet?.cmd === CtrlCmd.SuccessOfOpenSession) return;
            if(packet?.cmd === CtrlCmd.CloseSession) sent.push(bytes);
            return send.call(this, bytes, ...args);
        };
        const pending = net.createConnection({host: '127.0.0.1', port: ServerOptionStore.instance.serverOption.tunnelingOptions[1].forwardPort});
        h.sockets.push(pending); pending.on('error', () => {});
        await until(() => next._waitBufferBytesTotal > 0, 'Actual client endpoint greeting did not queue');
        const active = [...next._activatedSessionDataHandlerMap.values()] as any[];
        const queues = [...next._waitBufferQueueMap.values()] as any[];
        next.sendCloseSession(data.handlerID, data.sessionID, target);
        await until(() => control.socket.destroyed, 'Unsupported client control not closed');
        expect(sent).toEqual([]);
        await until(() => active.every(handler => handler.socket.destroyed), 'Client data handlers survived unsupported abort');
        expect(next._activatedSessionDataHandlerMap.size).toBe(0); expect(next._pendingDataAttempts.size).toBe(0);
        expect(next._waitBufferQueueMap.size).toBe(0); expect(next._waitBufferBytesTotal).toBe(0);
        expect(queues.every(queue => queue.bytes === 0 && queue.queue.size() === 0)).toBe(true);
        expect(endpointPool._endPointClientMap.size).toBe(0); expect(endpointPool._endpointOwners.size).toBe(0);
        await h.sibling.roundtrip(h.siblingSession, 'other-control-survives');
    } finally {
        restores.forEach(restore => restore()); spy.mockRestore(); endpointSockets.forEach(socket => socket.destroy());
        await new Promise<void>(resolve => endpoint.close(() => resolve()));
    }
}));
test.each(['server', 'client'])('actual negotiated %s producer delivers exact large target to its real consumer', async side => withClient(async h => {
    const data = [...h.tunnel._activatedSessionDataHandlerMap.values()][0] as any, sid = data.sessionID;
    const seen: number[] = [];
    const owner = side === 'server' ? h.tunnel : h.pool;
    const key = side === 'server' ? '_onEndPointCloseCallback' : '_onSessionCloseCallback';
    const callback = owner[key];
    owner[key] = (id: number, count: number) => { if(id === sid) seen.push(count); return callback?.(id, count); };
    try {
        if(side === 'server') h.pool.sendCloseSession(sid, target);
        else h.tunnel.sendCloseSession(data.handlerID, sid, target);
        await until(() => seen.length > 0, 'Exact close count did not reach actual consumer');
        expect(seen).toEqual([target]);
        await h.sibling.roundtrip(h.siblingSession, 'large-count-other-owner');
    } finally { owner[key] = callback; }
}));
test.each(['server', 'client'])('actual %s consumer rejects invalid null extension instead of prefix fallback', async side => withClient(async h => {
    const data = [...h.tunnel._activatedSessionDataHandlerMap.values()][0] as any;
    const control = side === 'server' ? h.pool._controlHandler : h.tunnel._ctrlHandler;
    const packet = CtrlPacket.closeSession(data.handlerID, data.sessionID, 0xffffffff) as any;
    packet._data = Buffer.concat([packet.data, Buffer.from('{"waitReceiveLength":null}')]);
    const sender = side === 'server' ? h.tunnel._ctrlHandler : h.pool._controlHandler;
    sender.sendData(packet.toBuffer());
    await until(() => control.socket.destroyed, 'Invalid close count did not abort its control');
    await h.sibling.roundtrip(h.siblingSession, 'invalid-count-other-owner');
}));

test.each(['server', 'client'])('actual %s consumer rejects valid large count when server omitted support but client advertised it', async side => withClient(async h => {
    const supported = [...DEFAULT_PROTOCOL_V2_CAPABILITIES];
    const original = CtrlPacket.createAckCtrl;
    // Same-process peer fixture: remove server's actual supported advertisement and add the client's token on its real Ack wire input.
    DEFAULT_PROTOCOL_V2_CAPABILITIES.splice(0, DEFAULT_PROTOCOL_V2_CAPABILITIES.length, ...supported.filter(value => value !== 'close-count-safe'));
    const ack = jest.spyOn(CtrlPacket, 'createAckCtrl').mockImplementation((id, name, key, meta) => original(id, name, key,
        meta ? {...meta, capabilities: [...meta.capabilities, 'close-count-safe']} : undefined));
    let owner: any, callback: any, key: string | undefined;
    try {
        h.client.start(); const next = h.client._tunnelClient;
        await until(() => h.client._isOnline, 'Unnegotiated actual control did not authenticate');
        await h.echo('unnegotiated-ready');
        const pool = h.server._clientHandlerPoolMap.get(next._id);
        expect(pool.capabilities).not.toContain('close-count-safe');
        expect(next._closeCountSafe).toBe(false);
        const data = [...next._activatedSessionDataHandlerMap.values()][0] as any;
        owner = side === 'server' ? pool : next;
        key = side === 'server' ? '_onSessionCloseCallback' : '_onEndPointCloseCallback';
        callback = owner[key]; const counts: number[] = [];
        owner[key] = (id: number, count: number) => { counts.push(count); return callback?.(id, count); };
        const receiving = side === 'server' ? pool._controlHandler : next._ctrlHandler;
        const sending = side === 'server' ? next._ctrlHandler : pool._controlHandler;
        sending.sendData(CtrlPacket.closeSession(data.handlerID, data.sessionID, target, {handlerID: data.handlerID}, true).toBuffer());
        await until(() => receiving.socket.destroyed, 'Valid unnegotiated extension did not abort');
        expect(counts).not.toContain(0xffffffff); expect(counts).not.toContain(target);
        await h.sibling.roundtrip(h.siblingSession, 'unnegotiated-other-owner');
    } finally {
        if(owner && key) owner[key] = callback;
        ack.mockRestore(); DEFAULT_PROTOCOL_V2_CAPABILITIES.splice(0, DEFAULT_PROTOCOL_V2_CAPABILITIES.length, ...supported);
    }
}));
