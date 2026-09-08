import {ClientHandlerPool} from "../../../src/server/ClientHandlerPool";
import {CtrlCmd} from "../../../src/commons/CtrlPacket";
import {withLegacyIds, until} from "./legacy-handler-id-fixture";

jest.setTimeout(30_000);
const cursor = (pool: ClientHandlerPool, value: number) => {
    // Both names are seeded so the same consumer test exercises baseline and fix.
    (ClientHandlerPool as any).LAST_DATA_HANDLER_ID = value;
    (pool as any)._legacyHandlerCursor = value;
};

test("legacy wraps around active and pending IDs, then reuses only a terminated ID", async () => withLegacyIds(async f => {
    const peer = await f.peer();
    cursor(peer.pool, 0);
    const active = await peer.open();
    expect(active.packet.ID).toBe(1);
    await peer.complete(active); await peer.roundtrip(active, 'active-before-wrap');
    cursor(peer.pool, 65534);
    const high = await peer.open(), low = await peer.open();
    cursor(peer.pool, 65534);
    const collision = await peer.open();
    expect([high.packet.ID, low.packet.ID, collision.packet.ID]).toEqual([65535, 2, 3]);
    await peer.complete(high); await peer.roundtrip(high, 'high-sibling');
    await peer.complete(low); await peer.roundtrip(low, 'low-sibling');
    active.socket.destroy();
    await until(() => !peer.pool.getAllSessionIDs().includes(active.packet.sessionID), 'Released session retained ownership');
    cursor(peer.pool, 0);
    const reused = await peer.open(); expect(reused.packet.ID).toBe(1);
    await peer.complete(reused); await peer.roundtrip(reused, 'safe-reuse');
    await peer.roundtrip(high, 'unaffected-sibling');
}));

test("cancelled session's late socket cannot claim the same ID reused for a new session", async () => withLegacyIds(async f => {
    const peer = await f.peer(); cursor(peer.pool, 99);
    const old = await peer.open();
    old.socket.destroy();
    await until(() => !peer.pool.getAllSessionIDs().includes(old.packet.sessionID), 'Cancellation did not remove pending state');
    cursor(peer.pool, 99);
    const fresh = await peer.open(); expect(fresh.packet.ID).toBe(old.packet.ID);
    const pending = (peer.pool as any)._pendingSessionIDMap.get(fresh.packet.sessionID);
    const queue = (peer.pool as any)._waitingDataBufferQueueMap.get(fresh.packet.sessionID);
    fresh.socket.write('buffered-before-late');
    await until(() => queue.sendBytes > 0, 'Pending bytes did not reach the actual queue');
    const buffered = queue.sendBytes;
    const late = await peer.handover(old.packet);
    await until(() => late.destroyed, 'Late stale socket was admitted');
    expect((peer.pool as any)._pendingSessionIDMap.get(fresh.packet.sessionID)).toBe(pending);
    expect((peer.pool as any)._waitingDataBufferQueueMap.get(fresh.packet.sessionID)).toBe(queue);
    expect(queue.sendBytes).toBe(buffered);
    expect(peer.pool.activatedSessionCount).toBe(0);
    await peer.complete(fresh);
    await until(() => Buffer.concat(fresh.received).toString() === 'buffered-before-late', 'Preserved pending payload was not echoed');
    await peer.roundtrip(fresh, 'fresh-after-late');
}));

test("wrong handler ID cannot cancel the correctly named pending session through terminal cleanup", async () => withLegacyIds(async f => {
    const peer = await f.peer(); cursor(peer.pool, 199);
    const fresh = await peer.open();
    const pending = (peer.pool as any)._pendingSessionIDMap.get(fresh.packet.sessionID);
    const wrong = await peer.handover(fresh.packet, fresh.packet.sessionID, fresh.packet.ID + 1);
    await until(() => wrong.destroyed, 'Wrong handler socket remains open');
    expect((peer.pool as any)._pendingSessionIDMap.get(fresh.packet.sessionID)).toBe(pending);
    await peer.complete(fresh); await peer.roundtrip(fresh, 'identity-preserved');
}));

test("legacy exhaustion has bounded caller failure without new control packet or phantom queues", async () => withLegacyIds(async f => {
    const peer = await f.peer();
    const pool = peer.pool as any;
    const realPending = pool._pendingSessionIDMap;
    const send = pool._controlHandler.sendData, callback = pool._onSessionCloseCallback;
    let sends = 0; const closed: number[][] = [];
    // Explicit occupancy fixture; these are records, not 65535 real sockets.
    const occupied = new Map(Array.from({length: 65535}, (_, i) => [i + 1,
        {handlerID: i + 1, sessionID: i + 1, available: i % 2 === 0, openOpt: {host: '127.0.0.1', port: 9, bufferLimit: 1}}]));
    pool._pendingSessionIDMap = occupied;
    pool._controlHandler.sendData = (...args: any[]) => { sends++; return send.apply(pool._controlHandler, args); };
    pool._onSessionCloseCallback = (session: number, length: number) => closed.push([session, length]);
    try {
        pool.sendConnectEndPoint(900000, {host: '127.0.0.1', port: 9, tls: false, bufferLimit: 1});
        expect({sends, closed, pending: occupied.size, queue: pool._waitingDataBufferQueueMap.size})
            .toEqual({sends: 0, closed: [[900000, 0]], pending: 65535, queue: 0});
    } finally {
        pool._pendingSessionIDMap = realPending;
        pool._waitingDataBufferQueueMap.delete(900000);
        pool._controlHandler.sendData = send; pool._onSessionCloseCallback = callback;
    }
}));

test("mixed legacy and v2 peers retain short IDs and wide token-bound IDs respectively", async () => withLegacyIds(async f => {
    const legacy = await f.peer(), wide = await f.peer(true);
    cursor(legacy.pool, 65535);
    const short = await legacy.open(); expect(short.packet.ID).toBe(1);
    (ClientHandlerPool as any).LAST_DATA_HANDLER_ID = 70000;
    const large = await wide.open();
    expect(large.packet.newDataHandlerMeta!.handlerID).toBe(70001);
    expect(large.packet.newDataHandlerMeta!.bindingToken).toBeTruthy();
    await legacy.complete(short); await legacy.roundtrip(short, 'legacy-mixed');
    await wide.complete(large); await wide.roundtrip(large, 'wide-mixed');
    expect(wide.packets.filter(packet => packet.cmd === CtrlCmd.FailOfOpenSession)).toEqual([]);
}));
