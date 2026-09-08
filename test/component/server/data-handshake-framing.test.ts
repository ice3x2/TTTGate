import {withHandshake} from "./data-handshake-fixture";
import DataStatePacket from "../../../src/commons/DataStatePacket";
import {CtrlCmd} from "../../../src/commons/CtrlPacket";
import {TunnelHandshakePolicyRegistry} from "../../../src/server/TunnelHandshakePolicy";

jest.setTimeout(30_000);

test("actual malformed data prefix rejects only the incoming socket and preserves pending bytes and sibling", async () => withHandshake(true, async h => {
    const sibling = await h.peer.open();
    await h.peer.complete(sibling);
    await h.peer.roundtrip(sibling, 'sibling-before-malformed');
    const pending = (h.peer.pool as any)._pendingSessionIDMap.get(h.session.packet.sessionID);
    const queue = (h.peer.pool as any)._waitingDataBufferQueueMap.get(h.session.packet.sessionID);
    const marker = 'pending-before-malformed';
    h.session.socket.write(marker);
    await h.until(() => queue.sendBytes === Buffer.byteLength(marker), 'Pending marker was not queued');
    const mark = h.tunnel.markHandlerAuthenticated;
    let marked = 0;
    h.tunnel.markHandlerAuthenticated = (handler: any) => { marked++; mark.call(h.tunnel, handler); };
    try {
        const malformed = Buffer.from(h.frame);
        malformed[1] = 0; // Keep the data-channel delimiter; corrupt its fixed prefix.
        h.socket.write(malformed);
        await h.until(() => h.socket.destroyed && h.observations.length > 0, 'Malformed prefix socket was not rejected');
        const incoming = h.observations[h.observations.length - 1].handler;
        expect(incoming.isEnd()).toBe(true);
        expect(marked).toBe(0);
        expect(h.tunnel._unauthenticatedHandlerIds.has(incoming.id)).toBe(false);
        expect((h.peer.pool as any)._pendingSessionIDMap.get(h.session.packet.sessionID)).toBe(pending);
        expect((h.peer.pool as any)._waitingDataBufferQueueMap.get(h.session.packet.sessionID)).toBe(queue);
        expect(queue.sendBytes).toBe(Buffer.byteLength(marker));
        expect(h.peer.pool.activatedSessionCount).toBe(1);
    } finally { h.tunnel.markHandlerAuthenticated = mark; }
    await h.peer.roundtrip(sibling, 'sibling-after-malformed');
    await h.peer.complete(h.session);
    await h.until(() => Buffer.concat(h.session.received).toString() === marker, 'Preserved pending bytes were not echoed');
    await h.peer.roundtrip(h.session, 'pending-after-malformed');
}));

test("actual v2 receiver waits at fixed-header and one-length-byte barriers", async () => withHandshake(true, async h => {
    h.socket.write(h.frame.subarray(0, DataStatePacket.LENGTH));
    await h.until(() => h.received() === DataStatePacket.LENGTH, 'Fixed-header bytes not observed at receiver');
    expect(h.peer.pool.pendingSessionCount).toBe(1);
    expect(h.peer.pool.activatedSessionCount).toBe(0);
    expect(h.peer.packets.some((packet: any) => packet.cmd === CtrlCmd.OpenSession)).toBe(false);
    h.socket.write(h.frame.subarray(DataStatePacket.LENGTH, DataStatePacket.LENGTH + 1));
    await h.until(() => h.received() === DataStatePacket.LENGTH + 1, 'Single length byte not observed');
    expect(h.peer.pool.activatedSessionCount).toBe(0);
    h.socket.write(h.frame.subarray(DataStatePacket.LENGTH + 1));
    await h.finish();
    await h.peer.roundtrip(h.session, 'token-frame-accepted');
}));

test("actual legacy receiver admits fixed frame with a coalesced binary suffix", async () => withHandshake(false, async h => {
    const suffix = Buffer.from([0x47, 0x45, 0x54, 0x20, 0, 255, 128]);
    h.socket.write(Buffer.concat([h.frame, suffix]));
    await h.until(() => h.received() === h.frame.length + suffix.length, 'Frame and suffix not observed');
    const handler = h.observations[0].handler;
    expect(handler.handlerID).toBe(h.session.packet.ID);
    expect(handler.sessionID).toBe(h.session.packet.sessionID);
    // #42 strengthens the old retained-tail control to actual queue and delivery.
    expect(handler.leftOverBuffer).toBeUndefined();
    expect((h.peer.pool as any)._waitingDataBufferQueueMap.get(h.session.packet.sessionID).receiveBytes).toBe(suffix.length);
    await h.finish();
    await h.until(() => Buffer.concat(h.session.received).length >= suffix.length, 'Parsed suffix not delivered');
    expect(Buffer.concat(h.session.received)).toEqual(suffix);
}));

test("a fragmented handshake cannot switch to a different authenticated pool object", async () => withHandshake(true, async h => {
    h.socket.write(h.frame.subarray(0, DataStatePacket.LENGTH + 1));
    await h.until(() => h.received() === DataStatePacket.LENGTH + 1, 'Fragment not observed');
    const alternate = await h.f.peer();
    const pools = h.tunnel._clientHandlerPoolMap;
    const pending = (h.peer.pool as any)._pendingSessionIDMap.get(h.session.packet.sessionID);
    // Disclosed route-identity replacement fixture using an actual second pool.
    const otherPending = (alternate.pool as any)._pendingSessionIDMap;
    otherPending.set(pending.sessionID, {...pending});
    pools.set(h.peer.pool.id, alternate.pool);
    try {
        h.socket.write(h.frame.subarray(DataStatePacket.LENGTH + 1));
        await h.until(() => h.socket.destroyed, 'Replaced pool accepted the in-flight handshake');
        expect((h.peer.pool as any)._pendingSessionIDMap.get(pending.sessionID) === pending).toBe(true);
        expect(otherPending.has(pending.sessionID)).toBe(true);
        expect(alternate.pool.activatedSessionCount).toBe(0);
    } finally {
        pools.set(h.peer.pool.id, h.peer.pool);
        otherPending.delete(pending.sessionID);
    }
}));

test("incomplete token extension uses the existing deadline without authenticating the socket", async () => withHandshake(true, async h => {
    // The socket already exists; apply its existing idle-timeout API for this owned control.
    h.socket.write(h.frame.subarray(0, DataStatePacket.LENGTH + 1));
    await h.until(() => h.received() === DataStatePacket.LENGTH + 1, 'Truncated extension not observed');
    const handler = h.observations[0].handler;
    const policy = TunnelHandshakePolicyRegistry.current();
    expect(h.tunnel._unauthenticatedHandlerIds.has(handler.id)).toBe(true);
    handler.setTimeout(150);
    await h.until(() => h.socket.destroyed, 'Incomplete handshake exceeded its owned deadline');
    expect(h.tunnel._unauthenticatedHandlerIds.has(handler.id)).toBe(false);
    expect(TunnelHandshakePolicyRegistry.current()).toEqual(policy);
    const sibling = await h.peer.open(); await h.peer.complete(sibling);
    await h.peer.roundtrip(sibling, 'sibling-after-incomplete');
}));

test("rejected token is not subsequently marked authenticated", async () => withHandshake(true, async h => {
    const mark = h.tunnel.markHandlerAuthenticated;
    let marked = 0;
    h.tunnel.markHandlerAuthenticated = (handler: any) => { marked++; mark.call(h.tunnel, handler); };
    try {
        const wrong = Buffer.from(h.frame); wrong[wrong.length - 1] ^= 1;
        h.socket.write(wrong);
        await h.until(() => h.socket.destroyed, 'Wrong token socket was not rejected');
        expect(marked).toBe(0);
    } finally { h.tunnel.markHandlerAuthenticated = mark; }
}));

test("unknown control identity cannot attach a claimed pending session to terminal cleanup", async () => withHandshake(true, async h => {
    const pending = (h.peer.pool as any)._pendingSessionIDMap.get(h.session.packet.sessionID);
    const wrong = Buffer.from(h.frame);
    wrong.writeUInt32BE(h.peer.pool.id + 100000, DataStatePacket.PREFIX_LENGTH);
    h.socket.write(wrong);
    await h.until(() => h.socket.destroyed, 'Unknown control identity was not rejected');
    expect((h.peer.pool as any)._pendingSessionIDMap.get(h.session.packet.sessionID) === pending).toBe(true);
}));
