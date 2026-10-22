import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import YAML from 'yaml';

const valid = {key: 'owned-secret-marker', adminPort: 9300, port: 9126, tls: false, tunnelingOptions: [], trustedClients: []};
test.each(['syntax', 'empty', 'late-invalid', 'nested-invalid', 'non-file', 'read-error', 'valid', 'missing', 'startup', 'legacy-missing-list', 'legacy-filter', 'admin-number', 'dangling', 'valid-start', 'reset-start', 'bootstrap-write-error'])(
    'owned child handles %s configuration without implicit reset', mode => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'config72-')));
    const config = path.join(root, 'config'); fs.mkdirSync(config);
    const file = path.join(config, 'server.yaml'), state = path.join(config, '.server.state.json');
    const originalState = JSON.stringify({currentRevision: 8, lastKnownGoodRevision: 3, pendingRestartScopes: ['admin-server']});
    fs.writeFileSync(state, originalState);
    const text = mode === 'empty' ? '' : mode === 'syntax' || mode === 'startup' || mode === 'reset-start' ? 'key: [owned-secret-marker' :
        YAML.stringify(mode === 'late-invalid' ? {...valid, tunnelingOptions: [{forwardPort: -1, protocol: 'tcp'}]} :
            mode === 'nested-invalid' ? {...valid, tunnelingOptions: [{forwardPort: 12345, protocol: 'http', destinationAddress: '127.0.0.1', httpOption: {bodyRewriteRules: 'bad'}}]} : valid);
    const legacy = mode === 'legacy-missing-list' ? {...valid, tunnelingOptions: undefined} : mode === 'legacy-filter' ? {...valid, trustedClients: [{}, {clientId: 'incomplete'}, {displayName: 42, clientSecret: 42}, {clientId: ' ', clientSecret: 42}, {clientId: 'complete', clientSecret: 'owned'}]} : mode === 'admin-number' ? {...valid, adminBindHost: 42} : undefined;
    const actualText = legacy ? YAML.stringify(legacy) : text;
    if(mode === 'dangling') fs.symlinkSync(path.join(root, 'missing-owned-target'), file, 'junction');
    else if(mode === 'non-file') fs.mkdirSync(file); else if(mode !== 'missing' && mode !== 'bootstrap-write-error') fs.writeFileSync(file, actualText);
    try {
        const result = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', path.resolve('test/component/invalid-config-driver.ts'), root, mode],
            {cwd: process.cwd(), encoding: 'utf8', timeout: 20_000});
        fs.writeFileSync(path.join(root, 'child-result.json'), JSON.stringify({status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr}));
        const facts = JSON.parse(fs.readFileSync(path.join(root, 'facts.json'), 'utf8'));
        expect(result.error).toBeUndefined();
        if(mode === 'valid-start' || mode === 'reset-start') {
            expect(result.status).toBe(0); expect(facts.error).toBeUndefined();
            expect(facts.certLoad).toBeGreaterThan(0); expect(facts.adminListening).toBe(true);
            expect(facts.controlStarted).toBe(true); expect(facts.controlConnected).toBe(true); expect(facts.closed).toBe(true);
            expect(facts.keepAlive).toBe(23456);
        } else if(mode === 'bootstrap-write-error') {
            expect(result.status).toBe(1); expect(facts.error).toContain('owned-bootstrap-write-fault');
            expect(fs.existsSync(file)).toBe(false); expect(fs.readFileSync(state, 'utf8')).toBe(originalState);
        } else if(mode === 'startup') {
            expect(result.status).toBe(1); expect(facts.certLoad).toBe(0); expect(facts.getter).toBe(0);
            expect(result.stderr).not.toContain('owned-secret-marker');
        } else if(mode === 'valid' || mode === 'missing' || mode.startsWith('legacy-')) {
            expect(result.status).toBe(0); expect(facts.status.ready).toBe(true); expect(facts.option.success).toBe(true);
        } else { expect(result.status).toBe(0); expect(facts.status.ready).toBe(false); expect(facts.option.success).toBe(false); }
        if(mode === 'legacy-missing-list') expect(facts.option.serverOption.tunnelingOptions).toEqual([]);
        if(mode === 'legacy-filter') expect(facts.option.serverOption.trustedClients).toEqual([{clientId: 'complete', clientSecret: 'owned', displayName: 'complete'}]);
        if(!['missing', 'valid-start', 'reset-start', 'bootstrap-write-error'].includes(mode)) {
            expect(fs.readFileSync(state, 'utf8')).toBe(originalState);
            if(mode === 'dangling') { expect(fs.lstatSync(file).isSymbolicLink()).toBe(true); expect(fs.readlinkSync(file)).toBe(path.join(root, 'missing-owned-target')); }
            else if(mode !== 'non-file') expect(fs.readFileSync(file, 'utf8')).toBe(actualText);
            else expect(fs.statSync(file).isDirectory()).toBe(true);
        }
    } finally {
        // Preserve owned root/child evidence for independent review, including failures.
        process.stdout.write(`Config72 evidence: ${root}\n`);
    }
});
