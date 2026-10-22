import {mkdtempSync, mkdirSync, writeFileSync, realpathSync, symlinkSync, existsSync} from 'fs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';
import {spawnSync} from 'child_process';

const repository = resolve(__dirname, '../../..');
let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'lint-contract-59-'))); });
afterEach(() => {
    if(root) require('../../helpers/lintProcess').cleanupOwnedLintRoot(root);
});

test('warn fixture stays warn under an inherited strict environment', () => {
    const result = spawnSync(process.execPath, [join(repository, 'node_modules/jest/bin/jest.js'),
        '--runInBand', '--silent', '--runTestsByPath', 'test/unit/tools/lint-auth-compare.test.ts',
        '--testNamePattern', 'detects authKey'], {cwd: repository, encoding: 'utf8', timeout: 30_000,
        env: {...process.env, LINT_AUTH_COMPARE_STRICT: '1'}});
    expect({status: result.status, error: result.error?.message, stderr: result.stderr}).toEqual({
        status: 0, error: undefined, stderr: expect.any(String)});
});

function runner() { return require('../../helpers/lintProcess').runLintProcess; }
function driver(source: string) { const file = join(root, 'driver.cjs'); writeFileSync(file, source); return file; }

test.each(['stdout', 'report'] as const)('preserves execution context for malformed %s JSON from an exit-zero child', mode => {
    const reportDir = join(root, 'reports');
    const summary = {tool: 'lint-auth-compare', strict: false, scannedFiles: 1, violationCount: 0};
    const report = mode === 'report' ? '{owned-malformed-report' : JSON.stringify({summary, violations: []});
    const stdout = mode === 'stdout' ? '{owned-malformed-stdout' : JSON.stringify({type: 'summary', ...summary});
    const script = driver(`const fs = require('fs');
        fs.mkdirSync(${JSON.stringify(reportDir)});
        fs.writeFileSync(${JSON.stringify(join(reportDir, 'auth-compare.json'))}, ${JSON.stringify(report)});
        process.stderr.write('owned-json-stderr');
        console.log(${JSON.stringify(stdout)});`);
    expect(() => runner()({script, target: root, reportDir, cwd: root, strict: false, expectedExit: 0})).toThrow(
        new RegExp(`Malformed ${mode} JSON[\\s\\S]*expected=0 status=0 signal=null error= code= command=[\\s\\S]*driver\\.cjs[\\s\\S]*cwd=[\\s\\S]*elapsedMs=\\d+[\\s\\S]*stderr=owned-json-stderr stdout=[\\s\\S]*${mode === 'stdout' ? 'owned-malformed-stdout' : 'summary'}`));
});

test('owned cleanup reports its exact path when ownership validation fails', () => {
    const cleanup = require('../../helpers/lintProcess').cleanupOwnedLintRoot;
    const alias = join(root, 'alias');
    symlinkSync(root, alias, 'junction');
    expect(() => cleanup(alias)).toThrow(`Failed to clean owned lint root ${alias}:`);
    expect(existsSync(join(root, 'alias'))).toBe(true);
});

test('owned cleanup permits an already absent owned path', () => {
    const cleanup = require('../../helpers/lintProcess').cleanupOwnedLintRoot;
    const owned = root;
    cleanup(owned);
    root = '';
    expect(() => cleanup(owned)).not.toThrow();
});

test.each(['nonzero', 'spawn', 'timeout'] as const)('reports real %s process failure with execution context', mode => {
    const script = driver(mode === 'timeout' ? 'setInterval(() => {}, 1000);' :
        'process.stderr.write("owned-failure-marker"); process.exitCode = 7;');
    const run = runner();
    expect(() => run({script, target: root, reportDir: join(root, 'reports'), cwd: root,
        strict: true, expectedExit: 1, executable: mode === 'spawn' ? join(root, 'missing-node.exe') : process.execPath,
        timeout: mode === 'timeout' ? 100 : 30_000})).toThrow(
        mode === 'nonzero' ? /status=7[\s\S]*owned-failure-marker/ : mode === 'spawn' ? /ENOENT/ : /ETIMEDOUT/);
});

test.each(['empty', 'strict-without-violation'] as const)('rejects %s instead of treating exit alone as lint completion', mode => {
    mkdirSync(join(root, 'reports'));
    const summary = {tool: 'lint-auth-compare', strict: true, scannedFiles: 1, violationCount: 0};
    writeFileSync(join(root, 'reports/auth-compare.json'), JSON.stringify({summary, violations: []}));
    const script = driver(mode === 'empty' ? '' :
        `console.log(${JSON.stringify(JSON.stringify({type: 'summary', ...summary}))}); process.exitCode = 1;`);
    expect(() => runner()({script, target: root, reportDir: join(root, 'reports'), cwd: root,
        strict: true, expectedExit: mode === 'empty' ? 0 : 1})).toThrow(/summary|violation/i);
});
