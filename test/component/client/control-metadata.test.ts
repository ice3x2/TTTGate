import net from 'node:net';
import {once} from 'node:events';
import {withLegacyIds, until} from '../server/legacy-handler-id-fixture';
import {withHandshake} from '../server/data-handshake-fixture';
import TTTClient from '../../../src/client/TTTClient';
import ServerOptionStore from '../../../src/server/ServerOptionStore';
import {CtrlCmd, CtrlPacket} from '../../../src/commons/CtrlPacket';
import {DEFAULT_KEY} from '../../../src/types/TunnelingOption';
import {metadataFrame} from '../../fixtures/metadata-frame';

jest.setTimeout(30_000);
const invalid = (syntax: boolean, message = false) => syntax ? '{owned-secret-marker' : message ? '{"type":9}' : '{"handlerID":-1}';

// Reuse the real server/raw peer/endpoint fixture; only actual TTTClient attachment is specific here.
async function withActualClient(check: (h: any) => Promise<void>, syncBad?: string) {
    await withLegacyIds(async f => {
        const server = f.server.tunnelServer as any;
        const originalSync = server.sendSyncCtrlAck;
        let resume: (() => void) | undefined;
        if(syncBad !== undefined) server.sendSyncCtrlAck = (handler: any) => {
            handler.sendData(metadataFrame(CtrlCmd.SyncCtrlAck, syncBad));
            resume = () => originalSync.call(server, handler);
        };
        const client = TTTClient.create({host: '127.0.0.1', port: server.port, tls: false, key: DEFAULT_KEY,
            name: 'wide', clientId: 'wide', clientSecret: 'fixture-wide-secret', allowLegacyFallback: false, keepAlive: 0});
        const sockets: net.Socket[] = [];
        try {
            client.start(); const tunnel = (client as any)._tunnelClient;
            const handler = tunnel._ctrlHandler;
            let receives = 0, generic = 0;
            const receive = tunnel.onReceiveFromCtrlHandler, procError = handler.procError;
            tunnel.onReceiveFromCtrlHandler = (...args: any[]) => { try { return receive.apply(tunnel, args); } finally { receives++; } };
            handler.procError = function(...args: any[]) { generic++; return procError.apply(this, args); };
            const echo = async (marker: string) => {
                const socket = net.createConnection({host: '127.0.0.1', port: ServerOptionStore.instance.serverOption.tunnelingOptions[1].forwardPort});
                sockets.push(socket); socket.on('error', () => {}); await once(socket, 'connect');
                const bytes: Buffer[] = []; socket.on('data', data => bytes.push(data)); socket.write(marker);
                await until(() => Buffer.concat(bytes).toString() === marker, 'Real metadata-control endpoint echo failed');
            };
            if(syncBad === undefined) await until(() => (client as any)._isOnline, 'Client did not authenticate');
            await check({f, server, client, tunnel, handler, echo, receives: () => receives, generic: () => generic,
                resume: () => { server.sendSyncCtrlAck = originalSync; resume!(); }});
        } finally { server.sendSyncCtrlAck = originalSync; sockets.forEach(socket => socket.destroy()); client.stop(); }
    });
}

test.each([true, false])('client SyncCtrlAck invalid syntax=%s retains Syncing and same connection before valid handshake', async syntax => {
    await withActualClient(async h => {
        await until(() => h.receives() > 0, 'Invalid sync metadata was not received');
        expect(h.generic()).toBe(0); expect(h.tunnel._ctrlHandler).toBe(h.handler);
        expect(h.tunnel._id).toBe(-1); expect(h.tunnel._state).toBe(3);
        h.resume(); await until(() => h.client._isOnline, 'Valid sync metadata did not finish same-control handshake');
        expect(h.tunnel._ctrlHandler).toBe(h.handler);
        await h.echo('after-invalid-sync');
    }, syntax ? '{owned-secret-marker' : '{"protocolVersion":"bad"}');
});

describe.each(['coalesced', 'split'] as const)('%s delivery', delivery => {
test.each([['new', true], ['new', false], ['message', true], ['message', false]] as const)(
    'client %s invalid syntax=%s discards only its packet and preserves following message and echo', async (site, syntax) => withActualClient(async h => {
        const sibling = await h.f.peer(); const session = await sibling.open(); await sibling.complete(session);
        const pool = [...h.server._clientHandlerPoolMap.values()].find((p: any) => !p.legacyMode) as any;
        let processedMessages = 0, connects = 0;
        const message = h.tunnel.processReceiveMessage, connect = h.tunnel.connectDataHandler;
        h.tunnel.processReceiveMessage = (packet: CtrlPacket) => { const value = message.call(h.tunnel, packet); processedMessages++; return value; };
        h.tunnel.connectDataHandler = (...args: any[]) => { connects++; return connect.apply(h.tunnel, args); };
        const before = h.receives();
        const bad = metadataFrame(site === 'new' ? CtrlCmd.NewDataHandler : CtrlCmd.Message, invalid(syntax, site === 'message'), 7, 888);
        const good = CtrlPacket.message(1, {type: 'log', payload: 'valid-after-invalid'}).toBuffer();
        if(delivery === 'split') {
            pool._controlHandler.sendData(bad);
            await until(() => h.receives() > before, 'Split bad client packet was not consumed');
            pool._controlHandler.sendData(good);
        } else pool._controlHandler.sendData(Buffer.concat([bad, good]));
        await until(() => processedMessages === (site === 'message' ? 2 : 1), 'Following valid client message was not processed');
        expect(h.generic()).toBe(0); expect(h.tunnel._ctrlHandler).toBe(h.handler);
        expect(connects).toBe(0); expect(processedMessages).toBe(site === 'message' ? 2 : 1);
        await h.echo('after-invalid-connected'); await sibling.roundtrip(session, 'metadata-sibling');
    }));

test.each([['message', true], ['message', false], ['result', true], ['result', false]] as const)(
    'server %s invalid syntax=%s preserves pending state and same-control valid continuation', async (site, syntax) => withHandshake(true, async h => {
        const sibling = await h.f.peer(); const siblingSession = await sibling.open(); await sibling.complete(siblingSession);
        h.socket.write(h.frame);
        await h.until(() => h.peer.pool.activatedSessionCount === 1, 'Real pending handover not established');
        const pending = (h.peer.pool as any)._pendingSessionIDMap.get(h.session.packet.sessionID);
        const queue = (h.peer.pool as any)._waitingDataBufferQueueMap.get(h.session.packet.sessionID);
        h.session.socket.write('pending-metadata');
        await h.until(() => queue.sendBytes === Buffer.byteLength('pending-metadata'), 'Pending real bytes not queued');
        const pool = h.peer.pool as any; let observed = 0;
        const delegate = pool.delegateReceivePacketOfControlHandler;
        pool.delegateReceivePacketOfControlHandler = (...args: any[]) => { try { return delegate.apply(pool, args); } finally { observed++; } };
        const bad = metadataFrame(site === 'message' ? CtrlCmd.Message : CtrlCmd.SuccessOfOpenSession,
            invalid(syntax, site === 'message'), h.session.packet.ID, h.session.packet.sessionID);
        const marker = `valid-after-invalid-${site}-${syntax}-${delivery}`;
        const good = CtrlPacket.message(1, {type: 'sysinfo', payload: {marker}}).toBuffer();
        if(delivery === 'split') {
            h.peer.control.write(bad);
            await h.until(() => observed > 0, 'Split bad server packet was not consumed');
            h.peer.control.write(good);
        } else h.peer.control.write(Buffer.concat([bad, good]));
        await h.until(() => pool._sysInfo?.marker === marker, 'Following valid server sysinfo was not processed');
        expect(h.peer.control.destroyed).toBe(false); expect(pool._sysInfo).toEqual({marker});
        expect(pool._pendingSessionIDMap.get(h.session.packet.sessionID)).toBe(pending);
        expect(pool._waitingDataBufferQueueMap.get(h.session.packet.sessionID)).toBe(queue);
        expect(queue.sendBytes).toBe(Buffer.byteLength('pending-metadata'));
        await h.finish(); await h.until(() => Buffer.concat(h.session.received).toString() === 'pending-metadata', 'Preserved pending bytes not delivered');
        await h.peer.roundtrip(h.session, 'after-invalid-server-meta');
        await sibling.roundtrip(siblingSession, 'server-metadata-sibling');
    }));

});
