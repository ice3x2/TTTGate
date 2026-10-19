const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const repository = path.resolve(__dirname, '../..');
const tests = ['test/unit/server/req-04-constant-time-compare.test.ts', 'test/e2e/req-09-pool-swap-zombie.test.ts'];
const names = ['REQ-04 상수시간 비교 전환 (a) lint-auth-compare: P3-T4 대상 파일 violation 0건',
    'REQ-09 Pool swap / zombie sessions (3b) configureSessionTtl 범위 밖 입력은 RangeError'];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if(process.argv[2] === 'prepare') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-60-R-'));
    const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-60-E-'));
    const workspace = path.join(root, 'workspace');
    fs.mkdirSync(workspace); fs.mkdirSync(path.join(root, 'tmp'));
    const files = new Set();
    function add(relative) {
        if(files.has(relative)) return;
        const source = path.join(repository, relative), st = fs.lstatSync(source);
        assert(!st.isSymbolicLink(), source);
        if(st.isDirectory()) { for(const entry of fs.readdirSync(source)) add(path.join(relative, entry)); return; }
        assert(st.isFile(), source); files.add(relative);
        if(relative.startsWith('test') && relative.endsWith('.ts')) {
            for(const match of fs.readFileSync(source, 'utf8').matchAll(/from\s+["'](\.[^"']+)["']/g)) {
                const target = path.resolve(path.dirname(source), match[1]);
                const found = [target, target + '.ts', target + '.json', path.join(target, 'index.ts')].find(p => fs.existsSync(p) && fs.lstatSync(p).isFile());
                assert(found, target); const rel = path.relative(repository, found);
                assert(!rel.startsWith('..') && !path.isAbsolute(rel), rel); add(rel);
            }
        }
    }
    ['src', ...tests, 'scripts/lint-auth-compare.mjs', 'tsconfig.json', 'package.json', 'test/fixtures/artifact-observer.cjs'].forEach(add);
    const manifest = [...files].sort().map(relative => {
        const source = path.join(repository, relative), destination = path.join(workspace, relative);
        fs.mkdirSync(path.dirname(destination), {recursive: true}); fs.copyFileSync(source, destination);
        return {source, destination, sha256: hash(source), copiedSha256: hash(destination)};
    });
    const dependencies = path.join(repository, 'node_modules');
    const config = {rootDir: workspace, testEnvironment: path.join(dependencies, 'jest-environment-node/build/index.js'),
        transform: {'^.+\\.ts$': [path.join(dependencies, 'ts-jest'), {diagnostics: true, isolatedModules: true}]},
        modulePaths: [dependencies], moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
        setupFilesAfterEnv: [path.join(workspace, 'test/fixtures/artifact-observer.cjs')], cacheDirectory: path.join(root, 'jest-cache')};
    fs.writeFileSync(path.join(root, 'jest.json'), JSON.stringify(config));
    fs.writeFileSync(path.join(evidence, 'manifest.json'), JSON.stringify({root, evidence, workspace,
        executable: path.join(dependencies, 'jest/bin/jest.js'), config, manifest}, null, 2));
    console.log(JSON.stringify({root, evidence}));
} else {
    const evidence = path.resolve(process.argv[3]), mode = process.argv[2];
    const record = JSON.parse(fs.readFileSync(path.join(evidence, 'manifest.json'), 'utf8'));
    const {root, workspace} = record;
    const runEvidence = fs.mkdtempSync(path.join(evidence, mode + '-run-'));
    assert.equal(fs.realpathSync(root), root); assert(!fs.lstatSync(root).isSymbolicLink());
    const index = mode.startsWith('lint') ? 0 : 1, failed = mode.endsWith('-failure');
    const filter = '^' + names[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
    const args = [record.executable, '--config', path.join(root, 'jest.json'), '--runInBand', '--silent',
        '--runTestsByPath', path.join(workspace, tests[index]), '--testNamePattern', filter];
    const result = spawnSync(process.execPath, args, {cwd: workspace, encoding: 'utf8', timeout: 90_000,
        env: {...process.env, TMP: path.join(root, 'tmp'), TEMP: path.join(root, 'tmp'), TMPDIR: path.join(root, 'tmp'),
            ARTIFACT_EVIDENCE: runEvidence, ARTIFACT_MODE: mode, ARTIFACT_FAIL: failed ? '1' : '0'}});
    fs.writeFileSync(path.join(runEvidence, mode + '-run.json'), JSON.stringify({args, status: result.status,
        signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr}, null, 2));
    console.log(JSON.stringify({mode, status: result.status, evidence: runEvidence}));
    assert.equal(result.error, undefined); assert.equal(result.status, failed ? 1 : 0, result.stderr);
    if(failed) assert.match(result.stderr, /owned-artifact-assertion/);
    const captured = JSON.parse(fs.readFileSync(path.join(runEvidence, mode + '-artifacts.json'), 'utf8'));
    assert(captured.length > 0);
    if(index === 0) {
        const scan = captured.find(entry => entry.file.endsWith('auth-compare.json'));
        assert(JSON.parse(scan.content).summary.scannedFiles > 0);
        const filtered = captured.find(entry => entry.file.endsWith('req-04-grep.json'));
        assert.deepEqual(JSON.parse(filtered.content).p3t4Violations, []);
    } else assert(captured.some(entry => /3b,range_guard,pass,\d+/.test(entry.content)));
    const leftovers = captured.filter(entry => fs.existsSync(entry.file)).map(entry => entry.file);
    fs.writeFileSync(path.join(runEvidence, mode + '-leftovers.json'), JSON.stringify(leftovers));
    assert.deepEqual(leftovers, [], 'Owned generated artifacts must be cleaned after the selected case');
    assert(captured.every(entry => !fs.existsSync(path.dirname(entry.file))), 'Owned report roots must also be removed');
    assert(!fs.existsSync(path.join(workspace, 'reports')));
    assert(!fs.existsSync(path.join(workspace, 'test/.tmp-req04-lint')));
}
