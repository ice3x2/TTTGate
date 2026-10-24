import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import ServerOptionStore from '../../../src/server/ServerOptionStore';
import {ServerOption, TunnelingOption} from '../../../src/types/TunnelingOption';
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from '../../helpers/runtime';

// U2-09 / #101: 업그레이드 직전의 server.yaml·.server.state.json 을 첫 신필드 저장과 같은 배치로 남기는 계약.
// 이전 형식(신필드 없음) yaml 에서 출발해야 하므로 각 케이스가 자기 루트를 새로 만든다.

const LEGACY_FORWARD_PORT = 20001;

// 이전 바이너리가 쓴 server.yaml: connectionSecurity 도, 터널의 ownerId·rateLimit 도 없다.
const LEGACY_YAML = [
    'key: legacy-admin-key',
    'adminPort: 9300',
    'adminBindHost: 127.0.0.1',
    'adminTls: true',
    'port: 9126',
    'tls: false',
    'tunnelingOptions:',
    `  - forwardPort: ${LEGACY_FORWARD_PORT}`,
    '    protocol: tcp',
    '    destinationAddress: 127.0.0.1',
    '    destinationPort: 20002',
    ''
].join('\n');

const LEGACY_STATE_JSON = JSON.stringify({
    currentRevision: 7,
    lastCommittedAt: 1757000000000,
    lastKnownGoodRevision: 7,
    lastKnownGoodAt: 1757000000000,
    pendingRestartScopes: []
}, null, 2);

type Boot = {store: ServerOptionStore; configDir: string; configYaml: string; stateJson: string; backupYaml: string; backupState: string};

let root: TestRoot | undefined;

const bootLegacyStore = async (prefix: string, options: {withStateFile?: boolean} = {}): Promise<Boot> => {
    root = await createTestRoot(prefix);
    const configDir = path.join(root.rootDir, 'config');
    const configYaml = path.join(configDir, 'server.yaml');
    const stateJson = path.join(configDir, '.server.state.json');
    fs.writeFileSync(configYaml, LEGACY_YAML, {encoding: 'utf-8'});
    if(options.withStateFile !== false) {
        fs.writeFileSync(stateJson, LEGACY_STATE_JSON, {encoding: 'utf-8'});
    }
    applyTestRoot(root.rootDir);
    const store = ServerOptionStore.instance;
    expect(store.loadStatus).toEqual({ready: true, source: 'loaded'});
    return {store, configDir, configYaml, stateJson,
        backupYaml: `${configYaml}.bak`, backupState: `${stateJson}.bak`};
};

afterEach(async () => {
    await cleanupTestRoot(root);
    root = undefined;
});

const legacyTunnel = (store: ServerOptionStore): TunnelingOption =>
    store.getTunnelingOption(LEGACY_FORWARD_PORT)!;

const withExtra = (option: ServerOption, extra: Record<string, unknown>): ServerOption =>
    ({...option, ...extra} as ServerOption);

const modeOf = (file: string): number => fs.statSync(file).mode & 0o777;

test('first save carrying a tunnel ownerId backs up both files byte-for-byte in the same batch', async () => {
    const boot = await bootLegacyStore('rollback-backup-owner');
    const option = boot.store.serverOption;
    const result = boot.store.commitPreparedServerOption({
        ...option,
        tunnelingOptions: [{...legacyTunnel(boot.store), ownerId: 'u_1'}]
    });
    expect(result.success).toBe(true);

    expect(fs.readFileSync(boot.backupYaml, 'utf-8')).toBe(LEGACY_YAML);
    expect(fs.readFileSync(boot.backupState, 'utf-8')).toBe(LEGACY_STATE_JSON);
    // 원본은 새 내용으로 바뀌어 있어야 한다. 그래야 .bak 이 "직전 상태"임이 성립한다.
    expect(fs.readFileSync(boot.configYaml, 'utf-8')).not.toBe(LEGACY_YAML);
    expect(YAML.parse(fs.readFileSync(boot.configYaml, 'utf-8')).tunnelingOptions[0].ownerId).toBe('u_1');
    if(process.platform !== 'win32') {
        expect([modeOf(boot.backupYaml), modeOf(boot.backupState)]).toEqual([0o600, 0o600]);
    }
});

test('a later save does not overwrite an existing backup', async () => {
    const boot = await bootLegacyStore('rollback-backup-once');
    const first = boot.store.commitPreparedServerOption({
        ...boot.store.serverOption,
        tunnelingOptions: [{...legacyTunnel(boot.store), ownerId: 'u_1'}]
    });
    expect(first.success).toBe(true);
    const backupAfterFirst = fs.readFileSync(boot.backupYaml, 'utf-8');
    const stateBackupAfterFirst = fs.readFileSync(boot.backupState, 'utf-8');

    const second = boot.store.commitPreparedServerOption({
        ...boot.store.serverOption,
        tunnelingOptions: [{...legacyTunnel(boot.store), ownerId: 'u_2'}]
    });
    expect(second.success).toBe(true);
    expect(YAML.parse(fs.readFileSync(boot.configYaml, 'utf-8')).tunnelingOptions[0].ownerId).toBe('u_2');
    expect(fs.readFileSync(boot.backupYaml, 'utf-8')).toBe(backupAfterFirst);
    expect(fs.readFileSync(boot.backupState, 'utf-8')).toBe(stateBackupAfterFirst);
});

test('saving an option that carries none of the rollback-sensitive fields creates no backup', async () => {
    const boot = await bootLegacyStore('rollback-backup-absent');
    // 최상위 민감 필드 일곱 개를 모두 벗긴다. verificationServerOption 이 로드 때 auditRetentionDays·auditQueueSize·
    // logLevel(#267)·closeStallMs·closeGraceMs(#268)를 기본값으로 채우므로 그것들도 빼야 "민감 필드가 하나도 없는 옵션" 이 된다.
    const {connectionSecurity, mfaRequiredForSuperusers, auditRetentionDays, auditQueueSize, logLevel, closeStallMs, closeGraceMs,
        ...withoutSensitive} = boot.store.serverOption;
    const tunnel = legacyTunnel(boot.store);
    const {rateLimit, ownerId, ...tunnelWithoutNewFields} = tunnel;
    const result = boot.store.commitPreparedServerOption({
        ...withoutSensitive,
        tunnelingOptions: [tunnelWithoutNewFields as TunnelingOption]
    } as ServerOption);
    expect(result.success).toBe(true);
    // 전제: 저장이 실제로 일어나 리비전이 올라갔다. 저장이 거부된 탓에 .bak 이 없는 것이 아니다.
    expect(boot.store.revisionState.currentRevision).toBe(8);
    expect(fs.existsSync(boot.backupYaml)).toBe(false);
    expect(fs.existsSync(boot.backupState)).toBe(false);
});

test('updateTunnelingOption and updateServerOption reach the same insertion point', async () => {
    const viaTunnel = await bootLegacyStore('rollback-backup-tunnel-api');
    expect(viaTunnel.store.updateTunnelingOption({...legacyTunnel(viaTunnel.store), ownerId: 'u_1'})).toBe(true);
    expect(fs.readFileSync(viaTunnel.backupYaml, 'utf-8')).toBe(LEGACY_YAML);
    expect(fs.readFileSync(viaTunnel.backupState, 'utf-8')).toBe(LEGACY_STATE_JSON);
    await cleanupTestRoot(root);

    const viaServer = await bootLegacyStore('rollback-backup-server-api');
    expect(viaServer.store.updateServerOption(withExtra(viaServer.store.serverOption, {auditQueueSize: 1000}))).toBe(true);
    expect(fs.readFileSync(viaServer.backupYaml, 'utf-8')).toBe(LEGACY_YAML);
    expect(fs.readFileSync(viaServer.backupState, 'utf-8')).toBe(LEGACY_STATE_JSON);
});

test.each(['ownerId', 'rateLimit'] as const)('a tunnel-level %s alone triggers the backup', async (field) => {
    const boot = await bootLegacyStore(`rollback-backup-tunnel-${field}`);
    const {connectionSecurity, ...withoutSecurity} = boot.store.serverOption;
    const tunnel = legacyTunnel(boot.store);
    const {rateLimit, ownerId, ...bare} = tunnel;
    const value = field === 'ownerId' ? 'u_1' : rateLimit;
    expect(value).not.toBeUndefined();
    const result = boot.store.commitPreparedServerOption({
        ...withoutSecurity,
        tunnelingOptions: [{...bare, [field]: value} as TunnelingOption]
    } as ServerOption);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(boot.backupYaml, 'utf-8')).toBe(LEGACY_YAML);
    expect(fs.readFileSync(boot.backupState, 'utf-8')).toBe(LEGACY_STATE_JSON);
});

test.each(['connectionSecurity', 'mfaRequiredForSuperusers', 'auditRetentionDays', 'auditQueueSize', 'logLevel', 'closeStallMs', 'closeGraceMs'] as const)(
    'a top-level %s alone triggers the backup', async (field) => {
    const boot = await bootLegacyStore(`rollback-backup-top-${field}`);
    const {connectionSecurity, ...withoutSecurity} = boot.store.serverOption;
    const tunnel = legacyTunnel(boot.store);
    const {rateLimit, ownerId, ...bare} = tunnel;
    const values: Record<string, unknown> = {
        connectionSecurity, mfaRequiredForSuperusers: true, auditRetentionDays: 14, auditQueueSize: 1000, logLevel: 'debug', closeStallMs: 90_000, closeGraceMs: 5_000
    };
    expect(values[field]).not.toBeUndefined();
    const result = boot.store.commitPreparedServerOption(withExtra(
        {...withoutSecurity, tunnelingOptions: [bare as TunnelingOption]} as ServerOption,
        {[field]: values[field]}
    ));
    expect(result.success).toBe(true);
    expect(fs.readFileSync(boot.backupYaml, 'utf-8')).toBe(LEGACY_YAML);
    expect(fs.readFileSync(boot.backupState, 'utf-8')).toBe(LEGACY_STATE_JSON);
});

test('a backup is not taken again once the stored yaml already carries new fields', async () => {
    const boot = await bootLegacyStore('rollback-backup-already-new');
    expect(boot.store.updateTunnelingOption({...legacyTunnel(boot.store), ownerId: 'u_1'})).toBe(true);
    fs.rmSync(boot.backupYaml);
    fs.rmSync(boot.backupState);
    // 디스크 yaml 이 이미 신필드를 담고 있으므로 "업그레이드 직전" 상태가 아니다.
    expect(boot.store.updateTunnelingOption({...legacyTunnel(boot.store), ownerId: 'u_2'})).toBe(true);
    expect(fs.existsSync(boot.backupYaml)).toBe(false);
    expect(fs.existsSync(boot.backupState)).toBe(false);
});

test('restoring the backup and upgrading again keeps the original backup', async () => {
    // MIGRATION.md 4절의 경로다: .bak 을 원본 이름으로 복사해 놓고 .bak 은 그대로 둔 채 다시 올린다.
    // 디스크 yaml 이 다시 이전 형식이 되므로 판정만으로는 두 번째 백업이 성립한다. .bak 보호가 그것을 막아야 한다.
    const boot = await bootLegacyStore('rollback-backup-restored');
    expect(boot.store.updateTunnelingOption({...legacyTunnel(boot.store), ownerId: 'u_1'})).toBe(true);
    expect(fs.readFileSync(boot.backupYaml, 'utf-8')).toBe(LEGACY_YAML);

    // 운영자가 복원한 뒤 손으로 한 줄을 고친 상태. .bak 이 덮어써지면 이 내용이 원본 자리를 차지한다.
    const editedLegacyYaml = LEGACY_YAML.replace('key: legacy-admin-key', 'key: hand-edited-after-rollback');
    fs.writeFileSync(boot.configYaml, editedLegacyYaml, {encoding: 'utf-8'});
    ServerOptionStore.resetForTest();
    const reloaded = ServerOptionStore.instance;
    expect(reloaded.loadStatus).toEqual({ready: true, source: 'loaded'});

    expect(reloaded.updateTunnelingOption({...reloaded.getTunnelingOption(LEGACY_FORWARD_PORT)!, ownerId: 'u_3'})).toBe(true);
    expect(fs.readFileSync(boot.backupYaml, 'utf-8')).toBe(LEGACY_YAML);
    expect(fs.readFileSync(boot.backupYaml, 'utf-8')).not.toBe(editedLegacyYaml);
});

test('a missing .server.state.json leaves its backup out instead of failing the commit', async () => {
    const boot = await bootLegacyStore('rollback-backup-no-state', {withStateFile: false});
    expect(fs.existsSync(boot.stateJson)).toBe(false);
    expect(boot.store.updateTunnelingOption({...legacyTunnel(boot.store), ownerId: 'u_1'})).toBe(true);
    expect(fs.readFileSync(boot.backupYaml, 'utf-8')).toBe(LEGACY_YAML);
    expect(fs.existsSync(boot.backupState)).toBe(false);
});

test('reset deletes the live files and keeps both backups', async () => {
    const boot = await bootLegacyStore('rollback-backup-reset');
    expect(boot.store.updateTunnelingOption({...legacyTunnel(boot.store), ownerId: 'u_1'})).toBe(true);
    expect(fs.existsSync(boot.backupYaml)).toBe(true);
    boot.store.reset();
    expect(fs.readFileSync(boot.backupYaml, 'utf-8')).toBe(LEGACY_YAML);
    expect(fs.readFileSync(boot.backupState, 'utf-8')).toBe(LEGACY_STATE_JSON);
    expect(fs.readdirSync(boot.configDir).sort()).toEqual(['.server.state.json', '.server.state.json.bak', 'server.yaml', 'server.yaml.bak']);
});

test('verificationServerOption admits and preserves fields the previous binary does not know', async () => {
    const boot = await bootLegacyStore('rollback-backup-forward-compat');
    const option = withExtra(boot.store.serverOption, {auditQueueSize: 1000});
    option.tunnelingOptions = [{...legacyTunnel(boot.store), ownerId: 'u_1'}];
    const result = boot.store.verificationServerOption(option);
    expect(result.success).toBe(true);
    expect(result.serverOption!.tunnelingOptions[0].ownerId).toBe('u_1');
    expect(result.serverOption!.tunnelingOptions[0].rateLimit).not.toBeUndefined();
    expect((result.serverOption as unknown as Record<string, unknown>).auditQueueSize).toBe(1000);
});
