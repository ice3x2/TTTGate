import fs from 'node:fs';
import path from 'node:path';
import ServerOptionStore from '../../../src/server/ServerOptionStore';
import {applyTestRoot, cleanupTestRoot, createTestRoot} from '../../helpers/runtime';

jest.setTimeout(30000);
const invalid = [0, -1, 0.5, null, '1', false, {}, [], NaN, Infinity, -Infinity, Number.MAX_VALUE];
const tunnel = (value: unknown) => ({forwardPort: 18081, protocol: 'tcp' as const, destinationAddress: '127.0.0.1',
    destinationPort: 9, keepAlive: 0, bufferLimitOnServer: value as number, bufferLimitOnClient: -1});

test.each(invalid)('server buffer %j rejects standalone and nested candidates without publication', async value => {
    const root = await createTestRoot('buffer40-store');
    try {
        applyTestRoot(root.rootDir); const store = ServerOptionStore.instance;
        const files = ['server.yaml', '.server.state.json'].map(file => path.join(root.rootDir, 'config', file));
        const bytes = files.map(file => fs.readFileSync(file)), option = store.serverOption, revision = store.revisionState;
        const candidate = tunnel(value), original = structuredClone(candidate);
        expect(store.composeServerOptionWithTunnelingOption(candidate).success).toBe(false);
        expect(candidate).toEqual(original);
        const full = {...option, tunnelingOptions: [tunnel(undefined), {...candidate, forwardPort: 18082}]};
        const originalFull = structuredClone(full);
        expect(store.commitPreparedServerOption(full).success).toBe(false);
        expect(full).toEqual(originalFull);
        expect(store.prepareServerOption({...option, tunnelingOptions: [candidate]}).success).toBe(false);
        expect(store.serverOption).toEqual(option); expect(store.revisionState).toEqual(revision);
        expect(files.map(file => fs.readFileSync(file))).toEqual(bytes);
    } finally { await cleanupTestRoot(root); }
});

test.each([undefined, 1, 8, 1.5, Number.MAX_SAFE_INTEGER + 1])('finite server buffer %s commits and reloads unchanged', async value => {
    const root = await createTestRoot('buffer40-positive');
    try {
        applyTestRoot(root.rootDir); let store = ServerOptionStore.instance;
        const result = store.composeServerOptionWithTunnelingOption(tunnel(value));
        expect(result.success).toBe(true);
        expect(store.commitPreparedServerOption(result.serverOption!).success).toBe(true);
        ServerOptionStore.resetForTest(); store = ServerOptionStore.instance;
        expect(store.readServerOption().success).toBe(true);
        expect(store.getTunnelingOption(18081)?.bufferLimitOnServer).toBe(value ?? 8);
        expect(store.getTunnelingOption(18081)?.bufferLimitOnClient).toBe(-1);
        const clientZero = store.composeServerOptionWithTunnelingOption({...tunnel(1), bufferLimitOnClient: 0});
        expect(clientZero.success).toBe(true);
        expect(clientZero.serverOption!.tunnelingOptions[0].bufferLimitOnClient).toBe(0);
    } finally { await cleanupTestRoot(root); }
});
