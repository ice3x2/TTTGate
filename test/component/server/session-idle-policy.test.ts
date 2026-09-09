import fs from 'node:fs';
import YAML from 'yaml';
import {createTestRoot, applyTestRoot, cleanupTestRoot} from '../../helpers/runtime';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import * as options from '../../../src/types/TunnelingOption';
import ServerOptionStore from '../../../src/server/ServerOptionStore';
import {withLegacyIds, until} from './legacy-handler-id-fixture';
import {withConfigurationServer} from './admin/configuration-revision-fixture';

jest.setTimeout(30_000);

test.each([undefined, 0, 1000, 3600000, -1, 999, 3600001, NaN, '1000'])('TTL config result validates %s before mutation', value => {
    const resolve = (options as any).resolveSessionTtlMs;
    expect(typeof resolve).toBe('function');
    const result = resolve(value);
    const valid = value === undefined || value === 0 || value === 1000 || value === 3600000;
    expect(result.success).toBe(valid);
    if(valid) expect(result.ttlMs).toBe(value ?? 3600000);
});

test('running idle policy disables and re-enables real expiry without restarting listeners', async () => withLegacyIds(async f => {
    const runtime = f.server.tunnelServer as any;
    expect(ServerOptionStore.instance.serverOption.sessionTtlMs).toBe(3600000);
    expect(runtime.sessionTtlPolicy.ttlMs).toBe(3600000);
    const peer = await f.peer(); const session = await peer.open(); const data = await peer.complete(session);
    const sid = session.packet.sessionID;
    const evidenceRoot = fs.mkdtempSync(path.join(tmpdir(), 'ttl52-observation-'));
    const observations: any[] = [];
    const state = (socket: any) => ({localAddress: socket.localAddress, localPort: socket.localPort,
        remoteAddress: socket.remoteAddress, remotePort: socket.remotePort, destroyed: socket.destroyed,
        readableEnded: socket.readableEnded, writableEnded: socket.writableEnded, bytesRead: socket.bytesRead, bytesWritten: socket.bytesWritten});
    const snapshot = (event: string) => observations.push({event, now: Date.now(), sid,
        lastActivity: runtime._sessionLastActivityMs.get(sid), ttl: runtime.sessionTtlPolicy.ttlMs,
        external: state(session.socket), peerData: state(data), receivedLength: Buffer.concat(session.received).length});
    const mark = runtime.markSessionActivity, enforce = runtime.enforceSessionTtl;
    runtime.markSessionActivity = function(...args: any[]) {
        const before = this._sessionLastActivityMs.get(args[0]), now = Date.now();
        const result = mark.apply(this, args);
        if(args[0] === sid) observations.push({event: 'activity', now, sid, before, after: this._sessionLastActivityMs.get(sid)});
        return result;
    };
    runtime.enforceSessionTtl = function(...args: any[]) {
        const before = this._sessionLastActivityMs.get(sid), now = Date.now(), ttl = this.sessionTtlPolicy.ttlMs;
        const result = enforce.apply(this, args);
        observations.push({event: 'scan', now, sid, before, after: this._sessionLastActivityMs.get(sid), ttl,
            age: before === undefined ? null : now - before, removed: before !== undefined && !this._sessionLastActivityMs.has(sid),
            mapped: this._sessionIDAndCtrlIDMap.has(sid)});
        return result;
    };
    try {
    snapshot('connected');
    const nativeControl = (peer.pool as any)._controlHandler;
    runtime.configureSessionTtl(5000, 200);
    runtime.configureSessionTtl(0);
    expect(runtime.sessionTtlPolicy).toEqual({ttlMs: 0, checkIntervalMs: 200});
    expect(runtime._sessionTtlTimer).toBeUndefined();
    snapshot('disabled-delay-start'); await delay(5250); snapshot('disabled-delay-end');
    snapshot('disabled-live-send');
    await peer.roundtrip(session, 'disabled-live');
    snapshot('disabled-live-received');
    const before = ServerOptionStore.instance.serverOption;
    expect((await f.server.applyServerOption({...before, sessionTtlMs: 5000}, before)).success).toBe(true);
    expect(runtime.sessionTtlPolicy).toEqual({ttlMs: 5000, checkIntervalMs: 200});
    expect(f.server.tunnelServer).toBe(runtime); expect((peer.pool as any)._controlHandler).toBe(nativeControl);
    expect(runtime._sessionTtlTimer).toBeDefined();
    const beforeFirstActivity = runtime._sessionLastActivityMs.get(sid);
    snapshot('refresh-live-delay-start'); await delay(500); snapshot('refresh-live-send');
    await peer.roundtrip(session, 'refresh-live'); snapshot('refresh-live-received');
    const firstActivity = runtime._sessionLastActivityMs.get(sid);
    expect(firstActivity).toBeGreaterThan(beforeFirstActivity);
    snapshot('refresh-again-delay-start'); await delay(500); snapshot('refresh-again-send');
    await peer.roundtrip(session, 'refresh-again'); snapshot('refresh-again-received');
    expect(runtime._sessionLastActivityMs.get(sid)).toBeGreaterThan(firstActivity);
    const finalActivity = runtime._sessionLastActivityMs.get(sid);
    await delay(Math.max(0, finalActivity + 5000 + 200 - Date.now()));
    await until(() => session.socket.destroyed, 'Explicit idle policy did not expire actual session');
    snapshot('expired');
    expect(runtime._sessionIDAndCtrlIDMap.has(sid)).toBe(false);
    expect(runtime._sessionLastActivityMs.has(sid)).toBe(false);
    expect(observations.find(entry => entry.event === 'scan' && entry.removed).mapped).toBe(false);
    await runtime.close(); runtime.configureSessionTtl(0); runtime.configureSessionTtl(1000);
    expect(runtime._sessionTtlTimer).toBeUndefined();
    expect(observations.some(entry => entry.event === 'activity')).toBe(true);
    expect(observations.some(entry => entry.event === 'scan' && entry.removed)).toBe(true);
    expect(observations.find(entry => entry.event === 'scan' && entry.removed).age).toBeGreaterThan(5000);
    } finally {
        runtime.markSessionActivity = mark; runtime.enforceSessionTtl = enforce;
        snapshot('finally');
        fs.writeFileSync(path.join(evidenceRoot, 'facts.json'), JSON.stringify(observations, null, 2));
        process.stdout.write(`TTL observation evidence: ${evidenceRoot}\n`);
    }
}));

test('effective interval result is detached and invalid explicit changes are atomic', async () => withLegacyIds(async f => {
    const runtime = f.server.tunnelServer as any;
    runtime.configureSessionTtl(5000, 4000);
    runtime.configureSessionTtl(1000);
    expect(runtime.sessionTtlPolicy).toEqual({ttlMs: 1000, checkIntervalMs: 999});
    const policy = runtime.sessionTtlPolicy;
    policy.ttlMs = 0;
    expect(runtime.sessionTtlPolicy.ttlMs).toBe(1000);
    expect(() => runtime.configureSessionTtl(5000, 5000)).toThrow(RangeError);
    expect(() => runtime.configureSessionTtl(undefined)).toThrow(RangeError);
    expect(runtime.sessionTtlPolicy).toEqual({ttlMs: 1000, checkIntervalMs: 999});
}));

test('TTL-only API applies live and rollback restores actual scan policy with pending baseline', async () => withConfigurationServer(async ({root, store, tunnel, request, snapshot, apis}: any) => {
    let current = await snapshot();
    const listener = tunnel.tunnelServer, adminNative = apis[0]._server;
    const saved = await request('POST', '/api/serverOption', {...current.serverOption, sessionTtlMs: 0, expectedRevision: current.revisionState.currentRevision});
    expect(saved.statusCode).toBe(200); expect(listener.sessionTtlPolicy.ttlMs).toBe(0);
    expect(tunnel.tunnelServer).toBe(listener); expect(apis[0]._server).toBe(adminNative);
    current = await snapshot();
    expect((await request('POST', '/api/serverOption', {...current.serverOption, adminBindHost: '::1', expectedRevision: current.revisionState.currentRevision})).statusCode).toBe(200);
    current = await snapshot();
    listener.configureSessionTtl(1234, 200);
    const baseline = tunnel.captureRuntimeState(), option = store.serverOption, revision = store.revisionState;
    const file = path.join(root.rootDir, 'config/server.yaml'), original = fs.readFileSync(file);
    const apply = tunnel.applyServerOption;
    tunnel.applyServerOption = async (...args: any[]) => {
        const result = await apply.apply(tunnel, args);
        return {...result, success: false, failedScopes: ['owned-post-ttl-apply']};
    };
    try {
        const response = await request('POST', '/api/serverOption', {...current.serverOption, sessionTtlMs: 2000, expectedRevision: current.revisionState.currentRevision});
        expect(JSON.parse(response.body).message).toBe("Unable to apply server option.");
        expect(response.statusCode).toBe(400);
    } finally { tunnel.applyServerOption = apply; }
    expect(listener.sessionTtlPolicy).toEqual({ttlMs: 1234, checkIntervalMs: 200});
    expect(tunnel.captureRuntimeState().scopes).toEqual(baseline.scopes);
    expect(tunnel.tunnelServer).toBe(listener); expect(apis[0]._server).toBe(adminNative);
    expect(store.serverOption).toEqual(option); expect(fs.readFileSync(file)).toEqual(original);
    expect(store.revisionState.currentRevision).toBe(revision.currentRevision);
    expect(store.revisionState.lastKnownGoodRevision).toBe(revision.lastKnownGoodRevision);
    expect(store.revisionState.pendingRestartScopes).toEqual(revision.pendingRestartScopes);
}));

test('invalid API TTL preserves committed config and revision before runtime mutation', async () => withConfigurationServer(async ({root, store, request, snapshot, tunnel}: any) => {
    const current = await snapshot(), native = tunnel.tunnelServer;
    const before = fs.readFileSync(path.join(root.rootDir, 'config/server.yaml'));
    expect((await request('POST', '/api/serverOption', {...current.serverOption, sessionTtlMs: -1, expectedRevision: current.revisionState.currentRevision})).statusCode).toBe(400);
    expect(store.revisionState).toEqual(current.revisionState);
    expect(fs.readFileSync(path.join(root.rootDir, 'config/server.yaml'))).toEqual(before);
    expect(tunnel.tunnelServer).toBe(native);
}));


test('invalid YAML TTL reuses non-ready preservation without overwriting original files', async () => {
    const root = await createTestRoot('ttl18-invalid');
    try {
        applyTestRoot(root.rootDir);
        const store = ServerOptionStore.instance;
        const file = path.join(root.rootDir, 'config/server.yaml'), stateFile = path.join(root.rootDir, 'config/.server.state.json');
        const text = YAML.stringify({...store.serverOption, sessionTtlMs: -1});
        fs.writeFileSync(file, text); const state = fs.readFileSync(stateFile);
        applyTestRoot(root.rootDir);
        expect(ServerOptionStore.instance.readServerOption().success).toBe(false);
        expect(fs.readFileSync(file, 'utf8')).toBe(text); expect(fs.readFileSync(stateFile)).toEqual(state);
    } finally { await cleanupTestRoot(root); }
});

test('start after close resumes configured policy and expires a real newly opened session', async () => withLegacyIds(async f => {
    const runtime = f.server.tunnelServer as any;
    runtime.configureSessionTtl(1000, 200); await runtime.close();
    runtime.configureSessionTtl(0); runtime.configureSessionTtl(1000);
    expect(runtime._sessionTtlTimer).toBeUndefined();
    await runtime.start();
    expect(runtime._sessionTtlTimer).toBeDefined();
    const peer = await f.peer(), session = await peer.open(); await peer.complete(session);
    await until(() => session.socket.destroyed, 'Restarted timer did not expire owned session');
}));
