import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import ServerOptionStore from '../../../src/server/ServerOptionStore';
import {applyTestRoot, cleanupTestRoot, createTestRoot} from '../../helpers/runtime';

// 이슈 366 검토 H-1 — 클라이언트 버퍼(bufferLimitOnClient)도 서버 버퍼처럼 저장소가 타입을 검사한다.
// 숫자가 아닌 값을 그대로 저장하면 TTTServer 가 세션을 열 때 강제 변환해 제한 없음·거대값·NaN 이 된다. 슈퍼유저 저장도 같은 검사를 받는다.

jest.setTimeout(30000);
const tunnel = (value: unknown) => ({forwardPort: 18083, protocol: 'tcp' as const, destinationAddress: '127.0.0.1',
    destinationPort: 9, keepAlive: 0, bufferLimitOnServer: 8, bufferLimitOnClient: value as number});

test.each(['0', '100000', false, [0], {}, NaN, Infinity, -Infinity, Number.MAX_VALUE])(
    'client buffer %j is rejected without publication', async value => {
        const root = await createTestRoot('client-buffer-invalid');
        try {
            applyTestRoot(root.rootDir); const store = ServerOptionStore.instance;
            const files = ['server.yaml', '.server.state.json'].map(file => path.join(root.rootDir, 'config', file));
            const bytes = files.map(file => fs.readFileSync(file)), option = store.serverOption;
            expect(store.composeServerOptionWithTunnelingOption(tunnel(value)).success).toBe(false);
            expect(store.prepareServerOption({...option, tunnelingOptions: [tunnel(value)]}).success).toBe(false);
            expect(store.serverOption).toEqual(option);
            expect(files.map(file => fs.readFileSync(file))).toEqual(bytes);
        } finally { await cleanupTestRoot(root); }
    });

test.each([[undefined, 8], [null, 8], [-1, -1], [0, 0], [8, 8], [1.5, 1.5]])(
    'client buffer %j is stored as %j', async (value, stored) => {
        const root = await createTestRoot('client-buffer-valid');
        try {
            applyTestRoot(root.rootDir); const store = ServerOptionStore.instance;
            const result = store.composeServerOptionWithTunnelingOption(tunnel(value));
            expect(result.success).toBe(true);
            expect(result.serverOption!.tunnelingOptions.find(row => row.forwardPort === 18083)!.bufferLimitOnClient).toBe(stored);
        } finally { await cleanupTestRoot(root); }
    });

test('server.yaml 의 숫자가 아닌 클라이언트 버퍼는 기본값 8 로 읽고 서버는 기동한다', async () => {
    const root = await createTestRoot('client-buffer-legacy');
    try {
        applyTestRoot(root.rootDir); void ServerOptionStore.instance;
        const file = path.join(root.rootDir, 'config', 'server.yaml');
        const parsed = YAML.parse(fs.readFileSync(file, 'utf8'));
        parsed.tunnelingOptions = [{...tunnel('100000'), forwardPort: 18084}, {...tunnel(16), forwardPort: 18085}];
        fs.writeFileSync(file, YAML.stringify(parsed));
        ServerOptionStore.resetForTest();
        const store = ServerOptionStore.instance;
        expect(store.loadStatus.ready).toBe(true);
        expect(store.getTunnelingOption(18084)?.bufferLimitOnClient).toBe(8);
        expect(store.getTunnelingOption(18085)?.bufferLimitOnClient).toBe(16);
    } finally { await cleanupTestRoot(root); }
});
