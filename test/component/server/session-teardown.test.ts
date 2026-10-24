import {setTimeout as delay} from 'node:timers/promises';
import {CtrlPacket} from '../../../src/commons/CtrlPacket';
import {ClientHandlerPool} from '../../../src/server/ClientHandlerPool';
import {withLegacyIds, until} from './legacy-handler-id-fixture';

// #253 — 세션 TTL 이나 데이터 연결 끊김으로 세션이 끝나도 풀·서버·외부 쪽 항목이 남지 않아야 한다.
jest.setTimeout(30_000);

/** 유예 시간을 바꿔 두고 테스트가 끝나면 되돌린다. 느린 CI 에서도 타이머가 테스트의 기다림 중에 터지지 않게 한다. */
const withGrace = (ms: number) => {
    const original = ClientHandlerPool.DATA_DROP_CLOSE_GRACE_MS;
    beforeEach(() => { ClientHandlerPool.DATA_DROP_CLOSE_GRACE_MS = ms; });
    afterEach(() => { ClientHandlerPool.DATA_DROP_CLOSE_GRACE_MS = original; });
};

/** 풀(또는 TunnelServer)이 외부 쪽에 보내는 세션 닫기 호출을 기록한다. */
const recordCloseCalls = (pool: any) => {
    const calls: Array<[number, number]> = [];
    const original = pool._onSessionCloseCallback;
    pool._onSessionCloseCallback = (sessionID: number, endLength: number) => { calls.push([sessionID, endLength]); original?.(sessionID, endLength); };
    return calls;
};

const waitFor = async (condition: () => boolean, timeoutMs: number, message: string) => {
    const deadline = Date.now() + timeoutMs;
    while(!condition()) {
        if(Date.now() >= deadline) throw new Error(message);
        await delay(10);
    }
};

// REQ-1 / AC-1 — 가짜 클라이언트는 CloseSession 을 무시하고 데이터 연결을 열어 둔다.
test('TTL expiry clears the pool entry and the data handler even when the client ignores CloseSession', async () => withLegacyIds(async f => {
    const runtime = f.server.tunnelServer as any;
    const peer = await f.peer();
    const session = await peer.open();
    const data = await peer.complete(session);
    expect(peer.pool.activatedSessionCount).toBe(1);
    runtime.configureSessionTtl(1000, 200);
    await waitFor(() => session.socket.destroyed, 5000, 'TTL did not close the external connection');
    await waitFor(() => peer.pool.activatedSessionCount === 0, 3000, 'pool entry left after TTL');
    await waitFor(() => data.readableEnded || data.destroyed, 3000, 'data connection left open after TTL');
    expect(runtime.debugSessionCount()).toBe(0);
}));

// REQ-2 / AC-2 — TTL 이 꺼져 있어도 데이터 연결이 CloseSession 없이 끊기면 세션을 외부 쪽까지 끝낸다.
test('a data connection dropped without CloseSession ends the session on the external side', async () => withLegacyIds(async f => {
    const runtime = f.server.tunnelServer as any;
    runtime.configureSessionTtl(0);
    const peer = await f.peer();
    const session = await peer.open();
    const data = await peer.complete(session);
    await peer.roundtrip(session, 'before-drop');
    const calls = recordCloseCalls(peer.pool);
    data.destroy();
    await waitFor(() => session.socket.destroyed, 6000, 'external connection left open after the data connection dropped');
    await waitFor(() => runtime.debugSessionCount() === 0, 3000, 'server session map left an entry');
    expect((f.server as any)._sessions.size).toBe(0);
    expect(peer.pool.activatedSessionCount).toBe(0);
    expect(Buffer.concat(session.received).toString()).toBe('before-drop');
    // 종료 길이는 데이터 연결에서 받아 외부로 넘긴 바이트 수다. 0 이면 HTTP 외부 연결은 받은 응답을 끝까지 넘기지 않고 끊는다.
    expect(calls).toEqual([[session.packet.sessionID, 'before-drop'.length]]);
}));

describe('with a long grace', () => {
withGrace(30_000);

// REQ-3 — 정상 종료에서도 데이터 연결의 끊김이 CloseSession 보다 먼저 올 수 있다(서로 다른 소켓).
// 이때도 CloseSession 은 지금처럼 처리되고, 남의 세션을 닫으려는 요청으로 세지 않는다.
test('a CloseSession that arrives after the data connection closed is still handled as the normal close', async () => withLegacyIds(async f => {
    const runtime = f.server.tunnelServer as any;
    runtime.configureSessionTtl(0);
    const peer = await f.peer();
    const session = await peer.open();
    const data = await peer.complete(session);
    await peer.roundtrip(session, 'normal-close');
    const calls = recordCloseCalls(peer.pool);
    data.end();
    await waitFor(() => data.destroyed, 3000, 'data connection did not close');
    await delay(200);
    peer.control.write(CtrlPacket.closeSession(session.packet.ID, session.packet.sessionID, 'normal-close'.length).toBuffer());
    await waitFor(() => session.socket.destroyed, 6000, 'external connection left open after CloseSession');
    await waitFor(() => runtime.debugSessionCount() === 0, 3000, 'server session map left an entry');
    // CloseSession 을 받았으므로 유예 타이머도 지운다.
    expect((peer.pool as any)._dataDropTimers.size).toBe(0);
    // 외부 쪽이 끝나 매핑에서 빠지면 넘긴 닫기 길이 기록도 지운다(#266, 세션마다 쌓이지 않게).
    expect(runtime._forwardedCloseLengths.size).toBe(0);
    expect((peer.pool as any)._foreignCloseCount).toBe(0);
    // 닫기는 CloseSession 의 한 번뿐이다. 유예 타이머가 끝난 세션을 다시 닫지 않는다.
    expect(calls).toEqual([[session.packet.sessionID, 'normal-close'.length]]);
    expect(Buffer.concat(session.received).toString()).toBe('normal-close');
}));

// REQ-2 — 유예 타이머는 풀이 닫히면 함께 지운다.
test('closing the control connection clears pending data-drop timers', async () => withLegacyIds(async f => {
    const runtime = f.server.tunnelServer as any;
    runtime.configureSessionTtl(0);
    const peer = await f.peer();
    const session = await peer.open();
    const data = await peer.complete(session);
    await peer.roundtrip(session, 'control-drop');
    const calls = recordCloseCalls(runtime);
    data.destroy();
    await until(() => peer.pool.activatedSessionCount === 0, 'pool did not drop the data handler');
    expect((peer.pool as any)._dataDropTimers.size).toBe(1);
    peer.control.destroy();
    await waitFor(() => !runtime._clientHandlerPoolMap.has(peer.pool.id), 3000, 'pool was not removed');
    expect((peer.pool as any)._dataDropTimers.size).toBe(0);
    await waitFor(() => session.socket.destroyed, 3000, 'external connection left open after the pool closed');
    // close() 와 같이 외부로 넘긴 길이로 한 번만 닫는다.
    expect(calls).toEqual([[session.packet.sessionID, 'control-drop'.length]]);
}));

// REQ-2 — 유예 중에 TunnelServer 를 닫아도(설정 적용으로 터널 서버만 바꿀 때) 그 세션의 외부 쪽을 닫는다.
test('closing the tunnel server during the grace closes the external side of the dropped session', async () => withLegacyIds(async f => {
    const runtime = f.server.tunnelServer as any;
    runtime.configureSessionTtl(0);
    const peer = await f.peer();
    const session = await peer.open();
    const data = await peer.complete(session);
    await peer.roundtrip(session, 'grace-close');
    const calls = recordCloseCalls(runtime);
    data.destroy();
    await until(() => (peer.pool as any)._dataDropTimers.size === 1, 'grace timer was not armed');
    await runtime.close();
    await waitFor(() => session.socket.destroyed, 3000, 'external connection left open after the tunnel server closed');
    // 타이머가 터질 때와 같이 외부로 넘긴 길이로 닫는다(0 이면 HTTP 외부 연결은 받은 응답을 끝까지 넘기지 않는다).
    expect(calls).toEqual([[session.packet.sessionID, 'grace-close'.length]]);
}));

// REQ-3 — 정상으로 끝나 외부 쪽이 아직 배출 중인 세션은 TunnelServer 를 닫아도 다시 닫지 않는다.
// (설정 적용은 외부 풀을 그대로 두고 TunnelServer 만 바꾸므로, 그 세션은 끝까지 배출되어야 한다.)
test('closing the tunnel server does not close a session that already ended normally and is still draining', async () => withLegacyIds(async f => {
    const runtime = f.server.tunnelServer as any;
    runtime.configureSessionTtl(0);
    const peer = await f.peer();
    const session = await peer.open();
    const data = await peer.complete(session);
    await peer.roundtrip(session, 'draining');
    // count 를 받은 것보다 크게 보내 외부 쪽이 배출을 끝내지 않은 상태로 둔다.
    peer.control.write(CtrlPacket.closeSession(session.packet.ID, session.packet.sessionID, 'draining'.length + 1).toBuffer());
    await waitFor(() => (peer.pool as any)._activatedSessionHandlerMap_.get(session.packet.sessionID)?.closeReceived === true, 3000, 'CloseSession was not handled');
    const calls = recordCloseCalls(peer.pool);
    data.end();
    await waitFor(() => peer.pool.activatedSessionCount === 0, 3000, 'pool did not drop the data handler');
    const outer = recordCloseCalls(runtime);
    await runtime.close();
    expect(outer).toEqual([]);
    expect(calls).toEqual([]);
    expect(session.socket.destroyed).toBe(false);
}));

// #266 — CloseSession(길이 N)을 받은 세션은 외부 쪽이 배출을 끝낼 때까지 매핑에 남는다. 그 사이 TunnelServer 를 닫거나
// (데이터 연결이 아직 열려 있음) 제어 연결이 끊겨도 길이 0 으로 다시 닫지 않는다. 0 이면 HTTP 외부 연결은 배출 중인 응답을 끊는다.
test.each(['close the tunnel server', 'drop the control connection'] as const)(
    'a session that already received CloseSession keeps its close length when we %s (#266)', async (action) => withLegacyIds(async f => {
    const runtime = f.server.tunnelServer as any;
    runtime.configureSessionTtl(0);
    const peer = await f.peer();
    const session = await peer.open();
    await peer.complete(session);
    await peer.roundtrip(session, 'draining');
    // count 를 받은 것보다 크게 보내 외부 쪽이 배출을 끝내지 않은 상태로 둔다. 데이터 연결은 열어 둔다.
    const length = 'draining'.length + 1;
    peer.control.write(CtrlPacket.closeSession(session.packet.ID, session.packet.sessionID, length).toBuffer());
    await waitFor(() => (peer.pool as any)._activatedSessionHandlerMap_.get(session.packet.sessionID)?.closeReceived === true, 3000, 'CloseSession was not handled');
    const outer = recordCloseCalls(runtime);
    if(action === 'close the tunnel server') await runtime.close();
    else {
        peer.control.destroy();
        await waitFor(() => !runtime._clientHandlerPoolMap.has(peer.pool.id), 3000, 'pool was not removed');
    }
    await delay(200);
    expect(outer).toEqual([[session.packet.sessionID, length]]);
    expect(session.socket.destroyed).toBe(false);
}));

// #266 REQ-2 — CloseSession 을 받지 않은 세션은 지금처럼 길이 0 으로 닫는다.
test.each(['close the tunnel server', 'drop the control connection'] as const)(
    'a session without CloseSession is still closed with length 0 when we %s (#266)', async (action) => withLegacyIds(async f => {
    const runtime = f.server.tunnelServer as any;
    runtime.configureSessionTtl(0);
    const peer = await f.peer();
    const session = await peer.open();
    await peer.complete(session);
    await peer.roundtrip(session, 'open');
    const outer = recordCloseCalls(runtime);
    if(action === 'close the tunnel server') await runtime.close();
    else {
        peer.control.destroy();
        await waitFor(() => !runtime._clientHandlerPoolMap.has(peer.pool.id), 3000, 'pool was not removed');
    }
    expect(outer).toEqual([[session.packet.sessionID, 0]]);
    await waitFor(() => session.socket.destroyed, 3000, 'external connection left open');
}));
});

// REQ-3 — 엔드포인트 쪽 정상 종료는 CloseSession 을 먼저 보내고 데이터 연결을 닫는다. 외부 쪽 배출이 유예보다 오래 걸려도
// (여기서는 받은 것보다 큰 count 로 끝나지 않게 둔다) 데이터 연결의 끊김이 세션을 다시 닫지 않는다.
describe('with a short grace', () => {
withGrace(300);
test('a data connection closed after CloseSession does not close the session a second time', async () => withLegacyIds(async f => {
    const runtime = f.server.tunnelServer as any;
    runtime.configureSessionTtl(0);
    const peer = await f.peer();
    const session = await peer.open();
    const data = await peer.complete(session);
    await peer.roundtrip(session, 'drain-later');
    const calls = recordCloseCalls(peer.pool);
    peer.control.write(CtrlPacket.closeSession(session.packet.ID, session.packet.sessionID, 'drain-later'.length + 1).toBuffer());
    await waitFor(() => calls.length === 1, 3000, 'CloseSession was not handled');
    data.end();
    await waitFor(() => data.destroyed, 3000, 'data connection did not close');
    await delay(900);
    expect(calls).toEqual([[session.packet.sessionID, 'drain-later'.length + 1]]);
}));

// #266 — 유예 타이머가 넘긴 길이(F)도 같은 규칙을 따른다. 외부 쪽이 아직 배출 중이라 매핑에 남은 세션의 제어 연결이 끊기면
// 0 이 아니라 F 로 닫는다. 외부 쪽은 다른 길이를 받으면 끊으므로 처음 넘긴 길이와 같아야 한다.
test('a session closed by the data-drop timer keeps that length when the control connection drops (#266)', async () => withLegacyIds(async f => {
    const runtime = f.server.tunnelServer as any;
    runtime.configureSessionTtl(0);
    const peer = await f.peer();
    const session = await peer.open();
    const data = await peer.complete(session);
    await peer.roundtrip(session, 'timer-close');
    // 외부 쪽 닫기를 기록만 해 세션을 매핑에 남긴다(외부 쪽이 아직 배출 중인 상태).
    const outer: Array<[number, number]> = [];
    runtime._onSessionCloseCallback = (sessionID: number, endLength: number) => { outer.push([sessionID, endLength]); };
    data.destroy();
    await waitFor(() => outer.length === 1, 3000, 'data-drop timer did not close the session');
    expect(runtime.debugSessionCount()).toBe(1);
    peer.control.destroy();
    await waitFor(() => !runtime._clientHandlerPoolMap.has(peer.pool.id), 3000, 'pool was not removed');
    expect(outer).toEqual([[session.packet.sessionID, 'timer-close'.length], [session.packet.sessionID, 'timer-close'.length]]);
    expect(runtime._forwardedCloseLengths.size).toBe(0);
}));
});
