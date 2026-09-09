import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
import {getFreePort} from '../helpers/network';

jest.setTimeout(30000);
test.each([0, -1, 0.5, null, '1', Infinity, undefined, 1, 1.5])('actual startup handles server buffer %s without rewriting invalid YAML', async value => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'buffer40-load-')));
    fs.mkdirSync(path.join(root, 'config'));
    const file = path.join(root, 'config/server.yaml'), state = path.join(root, 'config/.server.state.json');
    const text = YAML.stringify({key: 'owned-buffer-key', adminPort: await getFreePort(), adminBindHost: '127.0.0.1', adminTls: false,
        port: await getFreePort(), tls: false, keepAlive: 0, trustedClients: [], globalMemCacheLimit: 128,
        tunnelingOptions: [{forwardPort: await getFreePort(), protocol: 'tcp', destinationAddress: '127.0.0.1', destinationPort: 9,
            keepAlive: 0, bufferLimitOnServer: value, bufferLimitOnClient: -1}]});
    const revision = JSON.stringify({currentRevision: 8, lastKnownGoodRevision: 3, pendingRestartScopes: ['admin-server']});
    fs.writeFileSync(file, text); fs.writeFileSync(state, revision);
    const result = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', path.resolve('test/component/server-buffer-load-driver.ts'), root],
        {encoding: 'utf8', timeout: 20000, windowsHide: true});
    fs.writeFileSync(path.join(root, 'child-result.json'), JSON.stringify({status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr}));
    process.stdout.write(`Buffer40 load evidence: ${root}\n`);
    expect(result.error).toBeUndefined(); expect(result.signal).toBeNull();
    const facts = JSON.parse(fs.readFileSync(path.join(root, 'facts.json'), 'utf8'));
    const valid = value === undefined || value === 1 || value === 1.5;
    expect(result.status).toBe(valid ? 0 : 1); expect(facts.ready).toBe(valid);
    if(valid) { expect(facts.connected).toBe(true); expect(facts.buffer).toBe(value ?? 8); }
    else {
        expect(facts).toMatchObject({certLoads: 0, adminListens: 0, tunnelStarts: 0});
        expect(fs.readFileSync(file, 'utf8')).toBe(text); expect(fs.readFileSync(state, 'utf8')).toBe(revision);
    }
});
