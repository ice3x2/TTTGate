import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const repository = path.resolve(__dirname, '../../..');
const validator = path.join(repository, 'scripts/validate-srs-trace.mjs');
const markdownPath = 'docs/plan/srs/TTTGate.md', sidecarPath = 'docs/plan/srs/TTTGate.items.jsonl';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let root: string, matrixPath: string, bridgePath: string, viewPath: string, matrix: any;
const write = (file: string, value: unknown) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
function run(writeView = false) {
    // Absence is a setup/capability failure, never an invalid-structure PASS.
    expect(fs.existsSync(validator)).toBe(true);
    const result = spawnSync(process.execPath, [validator, '--matrix', matrixPath, '--source-root', root, ...(writeView ? ['--write-view'] : [])],
        {cwd: root, encoding: 'utf8', timeout: 10000});
    expect(result.error).toBeUndefined(); expect(result.signal).toBeNull();
    return result;
}

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'srs58-contract-')));
    for(const file of [markdownPath, sidecarPath]) {
        fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
        fs.copyFileSync(path.join(repository, file), path.join(root, file));
    }
    const markdown = fs.readFileSync(path.join(root, markdownPath)), sidecar = fs.readFileSync(path.join(root, sidecarPath));
    const items = sidecar.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
    expect(items).toHaveLength(366);
    const lines = markdown.toString('utf8').split(/\r?\n/);
    matrix = {schemaVersion: 1, sourceManifest: {path: markdownPath, sidecarPath, documentVersion: '1.0', markdownSha256: sha(markdown), sidecarSha256: sha(sidecar)},
        rows: items.map(item => {
            const headingLine = lines.findIndex(line => /^#+\s/.test(line) && line.split(/\s/).includes(item.id)) + 1;
            expect(headingLine).toBeGreaterThan(0);
            return {key: {sourceHash: sha(markdown), originalId: item.id}, category: item.type,
                source: {markdownPath, headingLine, exactHeading: lines[headingLine - 1], sidecarId: item.id},
                acceptance: {descriptionRef: item.id, clauses: []}, applicability: {kind: 'unresolved', modes: [], rationale: 'Unverified structural fixture'},
                implementation: {state: 'unverified', links: []}, legacyAliases: [], verification: [],
                review: {state: 'unreviewed', reviewer: null, decision: null, rationale: 'No semantic review'},
                status: 'unverified', gaps: [{clauseRef: item.id, explanation: 'Semantic review not performed', issueOrOwner: '#58', nextGate: 'independent semantic review'}]};
        })};
    matrixPath = path.join(root, 'docs/plan/traceability/original-srs-matrix.json');
    viewPath = path.join(path.dirname(matrixPath), 'original-srs-matrix.md');
    bridgePath = path.join(root, 'test/srs-trace-index.json');
    fs.mkdirSync(path.dirname(matrixPath), {recursive: true}); fs.mkdirSync(path.dirname(bridgePath), {recursive: true});
    write(matrixPath, matrix);
});
afterEach(() => {
    if(!root) return;
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false); expect(fs.realpathSync(root)).toBe(path.resolve(root));
    fs.rmSync(root, {recursive: true});
});

test('all 366 unverified rows render deterministically and default validation changes no files', () => {
    expect(run(true).status).toBe(0);
    const files = [matrixPath, viewPath, bridgePath, path.join(root, markdownPath), path.join(root, sidecarPath)];
    const before = files.map(file => fs.readFileSync(file));
    expect(run().status).toBe(0); expect(files.map(file => fs.readFileSync(file))).toEqual(before);
    expect(run(true).status).toBe(0); expect(files.map(file => fs.readFileSync(file))).toEqual(before);
    expect(fs.readFileSync(viewPath, 'utf8')).toMatch(/unverified/i);
});

test('CRLF derived views validate read-only while immutable source bytes stay unchanged', () => {
    expect(run(true).status).toBe(0);
    const sources = [path.join(root, markdownPath), path.join(root, sidecarPath)];
    const sourceBytes = sources.map(file => fs.readFileSync(file));
    for(const file of [viewPath, bridgePath]) {
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
    }
    const files = [matrixPath, viewPath, bridgePath, ...sources];
    const before = files.map(file => fs.readFileSync(file));
    const result = run();
    expect(files.map(file => fs.readFileSync(file))).toEqual(before);
    expect(sources.map(file => fs.readFileSync(file))).toEqual(sourceBytes);
    expect(result.status).toBe(0);
});

test.each(['missing-id', 'duplicate-id', 'source-hash', 'heading', 'category', 'false-verified'])(
    'rejects %s without treating fixture/module errors as structural evidence', defect => {
    expect(run(true).status).toBe(0);
    const row = matrix.rows[0], id = row.key.originalId;
    if(defect === 'missing-id') matrix.rows.shift();
    if(defect === 'duplicate-id') matrix.rows[1] = structuredClone(row);
    if(defect === 'source-hash') matrix.sourceManifest.markdownSha256 = '0'.repeat(64);
    if(defect === 'heading') row.source.headingLine++;
    if(defect === 'category') row.category = 'invented-category';
    if(defect === 'false-verified') row.status = 'verified';
    write(matrixPath, matrix);
    const result = run(); expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toMatch(/MODULE_NOT_FOUND|Cannot find module/);
    expect(result.stdout + result.stderr).toMatch(new RegExp(`${id}|${markdownPath}|source|hash`));
});

test('candidate test bridge remains bidirectionally consistent and never invents verified links', () => {
    const testPath = 'test/owned-trace-fixture.test.ts', exactTitle = 'trace fixture checks input';
    fs.writeFileSync(path.join(root, testPath), 'describe("trace fixture", () => { test("checks input", () => { expect(1).toBe(1); }); });\n');
    const row = matrix.rows[0]; row.status = 'candidate';
    row.verification = [{testPath, exactTitle, parameters: [], assertedClauseRefs: [row.key.originalId], technique: 'unit', rationale: 'Structural fixture only', state: 'candidate', evidence: []}];
    write(matrixPath, matrix); expect(run(true).status).toBe(0); expect(run().status).toBe(0);
    const bridge = JSON.parse(fs.readFileSync(bridgePath, 'utf8'));
    expect(bridge.entries).toHaveLength(1); expect(bridge.entries[0].exactTitle).toBe(exactTitle);
    bridge.entries[0].links[0].state = 'verified'; write(bridgePath, bridge);
    expect(run().status).toBe(1);
    expect(run(true).status).toBe(0);
    row.verification[0].testPath = 'test/missing-case.test.ts'; write(matrixPath, matrix);
    const result = run(); expect(result.status).toBe(1); expect(result.stdout + result.stderr).toContain('missing-case.test.ts');
});

test('exact case titles and document-qualified aliases are checked rather than bare REQ joins', () => {
    const testPath = 'test/owned-trace-fixture.test.ts'; fs.writeFileSync(path.join(root, testPath), 'test("real case", () => {});\n');
    const row = matrix.rows[0]; row.status = 'candidate';
    row.verification = [{testPath, exactTitle: 'nonexistent case', parameters: [], assertedClauseRefs: [row.key.originalId], technique: 'unit', rationale: 'Structural fixture', state: 'candidate', evidence: []}];
    write(matrixPath, matrix); expect(run(true).status).toBe(1);
    row.verification = []; row.status = 'unverified'; row.legacyAliases = [{id: 'REQ-01', rationale: 'Missing document/scope cannot be resolved'}];
    write(matrixPath, matrix); expect(run(true).status).toBe(1);
});

test('an explicit document-qualified legacy requirement may map to multiple original clauses', () => {
    const documentPath = 'docs/owned-legacy-plan.md';
    fs.writeFileSync(path.join(root, documentPath), '# Scope A\nREQ-01 addresses both original clauses.\n');
    for(const row of matrix.rows.slice(0, 2)) row.legacyAliases = [{documentPath,
        documentVersionOrHash: sha(fs.readFileSync(path.join(root, documentPath))), scope: 'Scope A', id: 'REQ-01', rationale: `Explicit candidate for ${row.key.originalId}`}];
    write(matrixPath, matrix); expect(run(true).status).toBe(0); expect(run().status).toBe(0);
});

test('parameterized describe context cannot be silently dropped from a candidate exact title', () => {
    const testPath = 'test/owned-dynamic-fixture.test.ts';
    fs.writeFileSync(path.join(root, testPath), 'describe.each(["A", "B"])("%s group", () => { test("checks input", () => {}); });\n');
    const row = matrix.rows[0]; row.status = 'candidate';
    row.verification = [{testPath, exactTitle: 'checks input', parameters: [], assertedClauseRefs: [row.key.originalId],
        technique: 'unit', rationale: 'Incorrectly omitted dynamic parent', state: 'candidate', evidence: []}];
    write(matrixPath, matrix); expect(run(true).status).toBe(1);
    row.verification[0].titleResolution = 'unresolved';
    row.verification[0].rationale = 'Explicit unresolved candidate, never a verified exact case';
    write(matrixPath, matrix); expect(run(true).status).toBe(0);
});

test.each([
    ['test.skip', 'test.skip("case", () => {});', 'test("case", () => {});', 'case'],
    ['it.todo', 'it.todo("case");', 'it("case", () => {});', 'case'],
    ['describe.skip parent', 'describe.skip("outer", () => { describe("inner", () => { test("case", () => {}); }); });',
        'describe("outer", () => { describe("inner", () => { test("case", () => {}); }); });', 'outer inner case'],
])('disabled %s stays candidate but cannot verify a clause', (_kind, disabledSource, enabledSource, exactTitle) => {
    const testPath = 'test/owned-disabled-fixture.test.ts', resultPath = 'test/owned-receipt.json';
    fs.writeFileSync(path.join(root, testPath), disabledSource);
    // Deliberate structural metadata fixture, not a claim of actual runtime verification.
    write(path.join(root, resultPath), {fixtureOnly: true});
    const row = matrix.rows[0]; row.status = 'candidate';
    row.verification = [{testPath, exactTitle, parameters: [], assertedClauseRefs: [row.key.originalId],
        technique: 'unit', rationale: 'Structural disabled-case fixture only', state: 'candidate', evidence: []}];
    write(matrixPath, matrix); expect(run(true).status).toBe(0);
    row.status = 'verified'; row.applicability.kind = 'runtime'; row.gaps = [];
    row.review = {state: 'reviewed', reviewer: 'structural-fixture', decision: 'fixture-only', rationale: 'Not semantic verification'};
    row.verification[0].state = 'verified';
    row.verification[0].evidence = [{commitOrTreeHash: 'structural-fixture', command: 'fixture-only', selection: exactTitle,
        observedAt: 'fixture-only', resultPath, resultHash: sha(fs.readFileSync(path.join(root, resultPath))), outcome: 'PASS', skippedOrFiltered: false}];
    write(matrixPath, matrix);
    const rejected = run(true); expect(rejected.status).toBe(1);
    expect(rejected.stdout + rejected.stderr).toContain(row.key.originalId);
    expect(rejected.stdout + rejected.stderr).toMatch(/disabled|skip|todo/i);
    fs.writeFileSync(path.join(root, testPath), enabledSource);
    expect(run(true).status).toBe(0);
});

test.each(['not-an-array', {}, null])('non-array acceptance.clauses %j is an explicit schema failure', malformed => {
    expect(run(true).status).toBe(0);
    matrix.rows[0].acceptance.clauses = malformed;
    write(matrixPath, matrix);
    const rejected = run(true); expect(rejected.status).toBe(1);
    expect(rejected.stdout + rejected.stderr).toContain(matrix.rows[0].key.originalId);
    expect(rejected.stdout + rejected.stderr).toMatch(/acceptance.clauses.*array/i);
});
