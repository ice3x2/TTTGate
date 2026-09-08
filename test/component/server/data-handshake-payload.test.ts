import {withHandshake} from "./data-handshake-fixture";
import {CtrlCmd} from "../../../src/commons/CtrlPacket";
import DataStatePacket from "../../../src/commons/DataStatePacket";
import {ResourcePolicyRegistry} from "../../../src/util/ResourcePolicy";

jest.setTimeout(30_000);
const first = Buffer.from([0, 255, 65]);
const second = Buffer.from([128, 0, 66]);

test.each([false, true])("handshake suffix precedes later bytes through queue and ACK delivery (v2=%s)", async wide => withHandshake(wide, async h => {
    h.socket.write(Buffer.concat([h.frame, first]));
    await h.until(() => h.received() === h.frame.length + first.length, 'Coalesced input not observed');
    // The actual receiving observer establishes the target read, not write timing.
    expect(h.observations.map((observation: any) => observation.bytes)).toEqual([h.frame.length + first.length]);
    const queue = (h.peer.pool as any)._waitingDataBufferQueueMap.get(h.session.packet.sessionID);
    expect(queue.receiveBytes).toBe(first.length);
    expect(h.observations[0].handler.leftOverBuffer).toBeUndefined();
    h.socket.write(second);
    await h.until(() => h.received() === h.frame.length + first.length + second.length, 'Later marker not observed');
    expect(queue.receiveBytes).toBe(first.length + second.length);
    expect(Buffer.concat(h.session.received)).toEqual(Buffer.alloc(0));
    await h.finish();
    await h.until(() => Buffer.concat(h.session.received).length >= first.length + second.length, 'Initial queued bytes were not delivered');
    expect(Buffer.concat(h.session.received)).toEqual(Buffer.concat([first, second]));
    await h.peer.roundtrip(h.session, 'later-owned-endpoint-echo');
}));

test.each([false, true])("empty suffix creates no payload dispatch and clears the accumulator (v2=%s)", async wide => withHandshake(wide, async h => {
    const push = h.peer.pool.pushReceiveBuffer;
    let calls = 0;
    h.peer.pool.pushReceiveBuffer = (...args: any[]) => { calls++; return push.apply(h.peer.pool, args); };
    try {
        h.socket.write(h.frame);
        await h.until(() => h.received() === h.frame.length, 'Empty-tail frame not observed');
        expect(calls).toBe(0);
        expect(h.observations[0].handler.leftOverBuffer).toBeUndefined();
        expect((h.peer.pool as any)._waitingDataBufferQueueMap.get(h.session.packet.sessionID).receiveBytes).toBe(0);
        await h.finish();
        h.socket.write(first);
        await h.until(() => Buffer.concat(h.session.received).length === first.length, 'Later payload missing');
        expect(Buffer.concat(h.session.received)).toEqual(first);
        expect(calls).toBe(1);
    } finally { h.peer.pool.pushReceiveBuffer = push; }
}));

test.each(['prefix', 'control', 'session', 'token'])("rejected %s suffix is discarded without authentication or sibling damage", async mode => withHandshake(true, async h => {
    const sibling = await h.peer.open(); await h.peer.complete(sibling);
    await h.peer.roundtrip(sibling, 'sibling-before-rejection');
    const pending = (h.peer.pool as any)._pendingSessionIDMap.get(h.session.packet.sessionID);
    const queue = (h.peer.pool as any)._waitingDataBufferQueueMap.get(h.session.packet.sessionID);
    h.session.socket.write('legitimate-pending');
    await h.until(() => queue.sendBytes === Buffer.byteLength('legitimate-pending'), 'Pending request not queued');
    const mark = h.tunnel.markHandlerAuthenticated;
    let marked = 0;
    h.tunnel.markHandlerAuthenticated = (handler: any) => { marked++; mark.call(h.tunnel, handler); };
    try {
        const frame = Buffer.from(h.frame);
        if(mode === 'prefix') frame[1] = 0;
        if(mode === 'control') frame.writeUInt32BE(h.peer.pool.id + 100000, DataStatePacket.PREFIX_LENGTH);
        if(mode === 'session') frame.writeUInt32BE(h.session.packet.sessionID + 100000, DataStatePacket.PREFIX_LENGTH + 8);
        if(mode === 'token') frame[frame.length - 1] ^= 1;
        h.socket.write(Buffer.concat([frame, first]));
        await h.until(() => h.socket.destroyed, 'Rejected socket remains open');
        const incoming = h.observations[h.observations.length - 1].handler;
        expect(incoming.leftOverBuffer).toBeUndefined();
        expect(marked).toBe(0);
        expect(Buffer.concat(h.session.received)).toEqual(Buffer.alloc(0));
        if(mode !== 'token') {
            expect((h.peer.pool as any)._pendingSessionIDMap.get(h.session.packet.sessionID) === pending).toBe(true);
            expect((h.peer.pool as any)._waitingDataBufferQueueMap.get(h.session.packet.sessionID) === queue).toBe(true);
            expect(queue.sendBytes).toBe(Buffer.byteLength('legitimate-pending'));
        }
    } finally { h.tunnel.markHandlerAuthenticated = mark; }
    await h.peer.roundtrip(sibling, 'sibling-after-rejection');
    if(mode !== 'token') {
        await h.peer.complete(h.session);
        await h.until(() => Buffer.concat(h.session.received).toString() === 'legitimate-pending', 'Legitimate queue changed');
    }
}));

test.each(['tail', 'later'])("queue overflow in %s bytes reports one close and preserves siblings", async location => withHandshake(true, async h => {
    const sibling = await h.peer.open(); await h.peer.complete(sibling);
    await h.peer.roundtrip(sibling, 'sibling-before-overflow');
    const policy = ResourcePolicyRegistry.current(), close = h.tunnel._onSessionCloseCallback;
    const closed: number[] = [];
    h.tunnel._onSessionCloseCallback = (session: number, bytes: number) => { closed.push(session); close(session, bytes); };
    ResourcePolicyRegistry.configure({defaultPoolQueueLimitBytes: 4});
    try {
        if(location === 'tail') h.socket.write(Buffer.concat([h.frame, Buffer.alloc(8, 65)]));
        else {
            h.socket.write(h.frame);
            await h.peer.read(CtrlCmd.OpenSession, h.session.packet.sessionID);
            h.socket.write(Buffer.alloc(8, 65));
        }
        await h.until(() => h.socket.destroyed, 'Overflow did not close the offending data channel');
        expect(closed.filter(session => session === h.session.packet.sessionID)).toHaveLength(1);
        expect((h.peer.pool as any)._waitingDataBufferQueueMap.has(h.session.packet.sessionID)).toBe(false);
        expect((h.peer.pool as any)._pendingSessionIDMap.has(h.session.packet.sessionID)).toBe(false);
        expect((h.peer.pool as any)._bufferSize).toBe(0);
        expect(Buffer.concat(h.session.received)).toEqual(Buffer.alloc(0));
        await h.peer.roundtrip(sibling, 'sibling-after-overflow');
    } finally { h.tunnel._onSessionCloseCallback = close; ResourcePolicyRegistry.configure(policy); }
}));

test("a live missing-queue failure still invokes one fallback close", async () => withHandshake(true, async h => {
    h.socket.write(h.frame);
    await h.peer.read(CtrlCmd.OpenSession, h.session.packet.sessionID);
    const handler = h.observations[0].handler;
    expect(handler.isEnd()).toBe(false);
    // Declared missing-queue state fixture; normal dispatch remains real.
    (h.peer.pool as any)._waitingDataBufferQueueMap.delete(h.session.packet.sessionID);
    const close = h.tunnel._onSessionCloseCallback;
    const closed: number[] = [];
    h.tunnel._onSessionCloseCallback = (session: number, bytes: number) => { closed.push(session); close(session, bytes); };
    try {
        h.socket.write(first);
        await h.until(() => h.socket.destroyed, 'Missing-queue fallback did not close the data channel');
        expect(closed.filter(session => session === h.session.packet.sessionID)).toHaveLength(1);
    } finally { h.tunnel._onSessionCloseCallback = close; }
}));
