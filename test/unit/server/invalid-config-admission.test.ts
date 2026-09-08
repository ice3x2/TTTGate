import fs from 'fs';
import path from 'path';
import ServerOptionStore from '../../../src/server/ServerOptionStore';
import Files from '../../../src/util/Files';
import {createTestRoot, applyTestRoot, cleanupTestRoot, TestRoot} from '../../helpers/runtime';
let root: TestRoot, source: TestRoot, store: ServerOptionStore, candidate: any, prepared: any, snapshot: any;
beforeEach(async () => {
    source = await createTestRoot('config72-valid'); applyTestRoot(source.rootDir);
    const ready = ServerOptionStore.instance; candidate = ready.serverOption;
    prepared = ready.prepareServerOptionCommit(candidate).prepared; snapshot = ready.captureCommittedState();
    root = await createTestRoot('config72-invalid');
    fs.writeFileSync(path.join(root.rootDir, 'config/server.yaml'), 'key: [owned-secret');
    fs.writeFileSync(path.join(root.rootDir, 'config/.server.state.json'), '{"currentRevision":8}');
    applyTestRoot(root.rootDir); store = ServerOptionStore.instance;
});
afterEach(async () => { await cleanupTestRoot(root); await source.cleanup(); });
test.each(['prepareServerOption', 'composeServerOptionWithTunnelingOption', 'composeServerOptionWithoutTunnelingOption',
    'prepareServerOptionCommit', 'commitPreparedServerOption', 'updateServerOption', 'updateTunnelingOption', 'removeTunnelingOption',
    'save', 'publishPreparedServerOption', 'restoreCommittedState', 'markLastKnownGood', 'recordRollback'])(
    'non-ready %s refuses before file/revision/callback changes', async method => {
    const configFile = path.join(root.rootDir, 'config/server.yaml'), stateFile = path.join(root.rootDir, 'config/.server.state.json');
    const before = [fs.readFileSync(configFile), fs.readFileSync(stateFile)];
    let callbacks = 0; store.onServerOptionUpdateCallback = () => callbacks++;
    const args: Record<string, any[]> = {prepareServerOption: [candidate], composeServerOptionWithTunnelingOption: [{forwardPort: 12345, protocol: 'tcp', destinationAddress: '127.0.0.1', destinationPort: 12346}],
        composeServerOptionWithoutTunnelingOption: [12345], prepareServerOptionCommit: [candidate], commitPreparedServerOption: [candidate],
        updateServerOption: [candidate], updateTunnelingOption: [{forwardPort: 12345, protocol: 'tcp', destinationAddress: '127.0.0.1', destinationPort: 12346}],
        removeTunnelingOption: [12345], save: [], publishPreparedServerOption: [prepared], restoreCommittedState: [snapshot],
        markLastKnownGood: [], recordRollback: ['owned', []]};
    const result = (store as any)[method](...args[method]);
    expect(typeof result === 'object' ? result.success : result).toBe(false);
    await new Promise<void>(resolve => process.nextTick(resolve));
    expect(callbacks).toBe(0); expect([fs.readFileSync(configFile), fs.readFileSync(stateFile)]).toEqual(before);
});
test('legacy getter is an invariant only and explicit reset recovers readiness', () => {
    expect(() => store.serverOption).toThrow(/not ready/i);
    expect(() => store.captureCommittedState()).toThrow(/not ready/i);
    store.reset(); expect((store as any).loadStatus).toEqual({ready: true, source: 'reset'});
    expect((store as any).readServerOption().success).toBe(true);
    expect(store.updateServerOption(store.serverOption)).toBe(true);
});
test('failed explicit reset does not publish ready and exposes native persistence failure', () => {
    const write = Files.writeAtomicBatchSync, fault = new Error('owned-reset-write-failure');
    try {
        Files.writeAtomicBatchSync = () => { throw fault; };
        expect(() => store.reset()).toThrow(fault);
        expect((store as any).loadStatus.ready).toBe(false);
        expect((store as any).readServerOption().success).toBe(false);
        expect(store.save()).toBe(false);
    } finally { Files.writeAtomicBatchSync = write; }
});
