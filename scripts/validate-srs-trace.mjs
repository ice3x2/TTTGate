import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';

const hashes = {
    markdown: '651898fa44ac7c3e037c4cc3706837062105871c7b8f41f92c66f728842b149d',
    sidecar: '364071a1f67e07501e7277e15ebdac057eb17ae8e6c2e076a3a550d916625657',
};
const digest = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' && value.trim().length > 0;
const array = value => Array.isArray(value) ? value : [];
const errors = [];
const fail = message => { errors.push(message); };
const args = process.argv.slice(2);
let matrixFile, sourceRoot, writeView = false;
for(let i = 0; i < args.length; i++) {
    if(args[i] === '--write-view') writeView = true;
    else if((args[i] === '--matrix' || args[i] === '--source-root') && args[i + 1] && !args[i + 1].startsWith('--')) {
        if(args[i] === '--matrix') matrixFile = path.resolve(args[++i]);
        else sourceRoot = path.resolve(args[++i]);
    } else fail('Unknown or incomplete CLI option');
}
if(!matrixFile || !sourceRoot) fail('Required: --matrix <path> --source-root <root>');

function localFile(relative) {
    if(!string(relative) || path.isAbsolute(relative)) { fail('Expected a source-relative file path'); return; }
    const file = path.resolve(sourceRoot, relative), rel = path.relative(sourceRoot, file);
    if(rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) { fail(`Path escapes source root: ${relative}`); return; }
    if(!fs.existsSync(file) || !fs.statSync(file).isFile()) { fail(`Missing file: ${relative}`); return; }
    return file;
}
function readJson(file, label) {
    if(!file || !fs.existsSync(file)) { fail(`Missing file: ${label}`); return; }
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch(error) { if(error instanceof SyntaxError) { fail(`Invalid JSON: ${label}`); return; } throw error; }
}

// Parse declarations without evaluating tests, imports, or application code.
function declaredTests(file) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const titles = new Set(), disabledTitles = new Set(); let dynamic = false;
    const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
    function visit(node, parents, unresolvedParent = false, disabledParent = false) {
        if(ts.isCallExpression(node)) {
            const name = node.expression.getText(source);
            const disabled = disabledParent || /(?:^|\.)(?:skip|todo)(?:\.|$)/.test(name);
            const describe = /^(?:describe)(?:\.(?:only|skip))?$/.test(name);
            const test = /^(?:test|it)(?:\.(?:only|skip|todo))?$/.test(name);
            const parameterized = /^(?:describe|test|it)(?:\.[a-z]+)*\.each\(/.test(name);
            if(describe || test || parameterized) {
                const title = literal(node.arguments[0]);
                if(parameterized || title === undefined) dynamic = true;
                else if(test && !unresolvedParent) {
                    const fullTitle = [...parents, title].join(' ');
                    titles.add(fullTitle);
                    if(disabled) disabledTitles.add(fullTitle);
                }
                if(describe && title !== undefined) {
                    const callback = node.arguments[1];
                    if(callback) ts.forEachChild(callback, child => visit(child, [...parents, title], unresolvedParent, disabled));
                    return;
                }
                if(describe || (parameterized && name.startsWith('describe'))) {
                    const callback = node.arguments[1];
                    if(callback) ts.forEachChild(callback, child => visit(child, parents, true, disabled));
                    return;
                }
            }
        }
        ts.forEachChild(node, child => visit(child, parents, unresolvedParent, disabledParent));
    }
    visit(source, []); return {titles, disabledTitles, dynamic};
}

function validate(matrix) {
    if(!object(matrix) || matrix.schemaVersion !== 1 || !object(matrix.sourceManifest) || !Array.isArray(matrix.rows)) {
        fail('Invalid matrix envelope'); return;
    }
    const manifest = matrix.sourceManifest;
    if(manifest.path !== 'docs/plan/srs/TTTGate.md' || manifest.sidecarPath !== 'docs/plan/srs/TTTGate.items.jsonl' || manifest.documentVersion !== '1.0') fail('Wrong immutable source manifest');
    const markdownFile = localFile(manifest.path), sidecarFile = localFile(manifest.sidecarPath);
    if(!markdownFile || !sidecarFile) return;
    const markdown = fs.readFileSync(markdownFile), sidecar = fs.readFileSync(sidecarFile);
    if(digest(markdown) !== hashes.markdown || manifest.markdownSha256 !== hashes.markdown) fail(`Immutable source hash mismatch: ${manifest.path}`);
    if(digest(sidecar) !== hashes.sidecar || manifest.sidecarSha256 !== hashes.sidecar) fail(`Immutable source hash mismatch: ${manifest.sidecarPath}`);
    let items;
    try { items = sidecar.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line)); }
    catch(error) { if(error instanceof SyntaxError) { fail(`Invalid sidecar JSON: ${manifest.sidecarPath}`); return; } throw error; }
    const originals = new Map(items.map(item => [item.id, item]));
    if(items.length !== 366 || originals.size !== 366) fail('Original source must contain exactly 366 unique IDs');
    const lines = markdown.toString('utf8').split(/\r?\n/), seen = new Set(), testCache = new Map();
    if(matrix.rows.length !== 366) fail('Matrix must contain exactly 366 original rows');
    for(const row of matrix.rows) {
        const id = row?.key?.originalId;
        if(!object(row) || !string(id)) { fail('Row missing original ID'); continue; }
        const original = originals.get(id);
        if(!original) { fail(`Unknown original ID: ${id}`); continue; }
        if(seen.has(id)) fail(`Duplicate original ID: ${id}`);
        seen.add(id);
        if(row.key.sourceHash !== hashes.markdown) fail(`${id}: wrong source hash`);
        if(row.category !== original.type) fail(`${id}: category must match original sidecar type`);
        const source = row.source;
        if(!object(source) || source.markdownPath !== manifest.path || source.sidecarId !== id || !Number.isInteger(source.headingLine) || source.headingLine < 1 ||
            source.exactHeading !== lines[source.headingLine - 1] || !/^#+\s/.test(source.exactHeading ?? '') || !source.exactHeading.split(/\s/).includes(id)) fail(`${id}: invalid exact source heading`);
        if(row.acceptance?.descriptionRef !== id) fail(`${id}: wrong acceptance descriptionRef`);
        if(!Array.isArray(row.acceptance?.clauses)) fail(`${id}: acceptance.clauses must be an array`);
        const clauses = new Set([id]);
        for(const clause of array(row.acceptance?.clauses)) {
            if(!object(clause) || !string(clause.id) || clauses.has(clause.id) || !string(clause.rationale)) fail(`${id}: invalid reviewed clause split`);
            else clauses.add(clause.id);
        }
        if(!['runtime', 'document', 'unresolved'].includes(row.applicability?.kind) || !Array.isArray(row.applicability?.modes) || !string(row.applicability?.rationale)) fail(`${id}: invalid applicability`);
        if(!['unverified', 'located', 'partial'].includes(row.implementation?.state) || !Array.isArray(row.implementation?.links)) fail(`${id}: invalid implementation state`);
        for(const link of array(row.implementation?.links)) {
            const file = localFile(link.path);
            if(!string(link.symbol) || !string(link.rationale) || (file && !fs.readFileSync(file, 'utf8').includes(link.symbol))) fail(`${id}: implementation symbol/rationale missing`);
        }
        if(!Array.isArray(row.legacyAliases) || !Array.isArray(row.verification) || !Array.isArray(row.gaps)) fail(`${id}: missing link/gap arrays`);
        for(const alias of array(row.legacyAliases)) {
            if(!string(alias.documentPath) || !string(alias.documentVersionOrHash) || !string(alias.scope) || !string(alias.id) || !string(alias.rationale)) { fail(`${id}: legacy alias requires document, version/hash, scope and ID`); continue; }
            const file = localFile(alias.documentPath);
            if(file && !fs.readFileSync(file, 'utf8').includes(alias.id)) fail(`${id}: legacy ID not in qualified document`);
            if(file && /^[a-f0-9]{64}$/i.test(alias.documentVersionOrHash) && digest(fs.readFileSync(file)) !== alias.documentVersionOrHash.toLowerCase()) fail(`${id}: legacy document hash mismatch`);
        }
        const reviewed = row.review?.state === 'reviewed' && string(row.review.reviewer) && string(row.review.decision) && string(row.review.rationale);
        if(!['unreviewed', 'reviewed'].includes(row.review?.state) || (row.review.state === 'reviewed' && !reviewed)) fail(`${id}: invalid independent review metadata`);
        if(!['unverified', 'candidate', 'partial', 'verified', 'uncovered', 'document-reviewed'].includes(row.status)) fail(`${id}: invalid status`);
        if(row.status === 'verified' && (!reviewed || row.applicability?.kind !== 'runtime' || array(row.verification).length === 0 || row.gaps.length !== 0)) fail(`${id}: verified requires reviewed runtime evidence and no gaps`);
        if(row.status === 'document-reviewed' && (!reviewed || row.applicability?.kind !== 'document')) fail(`${id}: document review requires applicability rationale and reviewer`);
        for(const gap of array(row.gaps)) if(!clauses.has(gap.clauseRef) || !string(gap.explanation) || !string(gap.issueOrOwner) || !string(gap.nextGate)) fail(`${id}: incomplete gap disposition`);
        const linkKeys = new Set(), verifiedClauses = new Set();
        for(const link of array(row.verification)) {
            if(!object(link) || !string(link.exactTitle) || !Array.isArray(link.parameters) || !string(link.technique) || !string(link.rationale) || !['candidate', 'verified'].includes(link.state) || !Array.isArray(link.evidence) || !Array.isArray(link.assertedClauseRefs)) { fail(`${id}: invalid verification link`); continue; }
            const file = localFile(link.testPath);
            if(file) {
                if(!testCache.has(file)) testCache.set(file, declaredTests(file));
                const declarations = testCache.get(file);
                const resolved = declarations.titles.has(link.exactTitle);
                if(link.state === 'verified' && declarations.disabledTitles.has(link.exactTitle)) fail(`${id}: disabled/skip/todo test cannot verify a clause`);
                if(!resolved && !(link.state === 'candidate' && link.titleResolution === 'unresolved' && declarations.dynamic)) fail(`${id}: exact test title not found: ${link.testPath}`);
                if(link.state === 'verified' && (!resolved || link.titleResolution === 'unresolved')) fail(`${id}: unresolved test title cannot verify a clause`);
            }
            const linkKey = JSON.stringify([link.testPath, link.exactTitle, link.parameters]);
            if(linkKeys.has(linkKey)) fail(`${id}: duplicate case/parameter link`); linkKeys.add(linkKey);
            if(!link.assertedClauseRefs.length || link.assertedClauseRefs.some(ref => !clauses.has(ref))) fail(`${id}: verification references unknown/empty clauses`);
            if(link.state === 'verified') {
                if(!reviewed || !link.evidence.length) fail(`${id}: verified link lacks independent review/evidence`);
                for(const ref of link.assertedClauseRefs) verifiedClauses.add(ref);
            }
            for(const evidence of link.evidence) {
                if(!string(evidence.commitOrTreeHash) || !string(evidence.command) || !string(evidence.selection) || !string(evidence.observedAt) ||
                    !/^[a-f0-9]{64}$/i.test(evidence.resultHash ?? '') || !string(evidence.outcome) || typeof evidence.skippedOrFiltered !== 'boolean') fail(`${id}: incomplete execution metadata`);
                const result = localFile(evidence.resultPath);
                if(result && digest(fs.readFileSync(result)) !== evidence.resultHash) fail(`${id}: execution receipt hash mismatch`);
                if(link.state === 'verified' && (evidence.outcome !== 'PASS' || evidence.skippedOrFiltered !== false)) fail(`${id}: nonpass/skipped evidence cannot verify`);
            }
            if(row.status === 'verified' && link.state !== 'verified') fail(`${id}: verified row contains unverified links`);
        }
        const requiredClauses = array(row.acceptance?.clauses).length ? array(row.acceptance.clauses).map(clause => clause.id) : [id];
        if(row.status === 'verified' && requiredClauses.some(ref => !verifiedClauses.has(ref))) fail(`${id}: not every acceptance clause has verified evidence`);
    }
    for(const id of originals.keys()) if(!seen.has(id)) fail(`Missing original ID: ${id}`);
}

function views(matrix) {
    const entries = new Map();
    for(const row of matrix.rows) for(const link of row.verification) {
        const key = JSON.stringify([link.testPath, link.exactTitle, link.parameters]);
        if(!entries.has(key)) entries.set(key, {testPath: link.testPath, exactTitle: link.exactTitle, parameters: link.parameters, links: []});
        entries.get(key).links.push({sourceHash: row.key.sourceHash, originalId: row.key.originalId, state: link.state, assertedClauseRefs: link.assertedClauseRefs});
    }
    const bridge = {schemaVersion: 1, sourceHash: hashes.markdown, entries: [...entries.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, entry]) => entry)};
    const escape = value => String(value).replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
    const lines = ['# Original SRS trace matrix', '', 'Generated structure view. Unverified/candidate links do not establish semantic acceptance or actual test execution.', '',
        '| Original ID | Category | Status | Source heading | Test cases | Gaps |', '| --- | --- | --- | --- | --- | --- |'];
    for(const row of matrix.rows) lines.push(`| ${escape(row.key.originalId)} | ${escape(row.category)} | ${escape(row.status)} | ${escape(row.source.markdownPath)}:${row.source.headingLine} ${escape(row.source.exactHeading)} | ${row.verification.map(link => `${escape(link.testPath)} — ${escape(link.exactTitle)} (${escape(JSON.stringify(link.parameters))}; ${link.state})`).join('; ')} | ${row.gaps.map(gap => escape(gap.explanation)).join('; ')} |`);
    return {bridge: JSON.stringify(bridge, null, 2) + '\n', markdown: lines.join('\n') + '\n'};
}

try {
    if(!errors.length) {
        const matrix = readJson(matrixFile, matrixFile);
        validate(matrix);
        if(!errors.length) {
            const rendered = views(matrix), view = path.join(path.dirname(matrixFile), 'original-srs-matrix.md'), bridge = path.join(sourceRoot, 'test/srs-trace-index.json');
            if(writeView) {
                fs.mkdirSync(path.dirname(bridge), {recursive: true});
                fs.writeFileSync(view, rendered.markdown); fs.writeFileSync(bridge, rendered.bridge);
            } else {
                for(const [file, expected] of [[view, rendered.markdown], [bridge, rendered.bridge]]) {
                    if(!fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== expected) fail(`Generated view/bridge mismatch: ${path.relative(sourceRoot, file)}`);
                }
            }
        }
    }
} catch(error) { fail(`Validation I/O or unexpected failure: ${error.code ?? error.name}`); }
if(errors.length) { process.stderr.write(errors.join('\n') + '\n'); process.exitCode = 1; }
else process.stdout.write('Structure valid: 366 original rows; semantic verification and runtime evidence authenticity are not established by this command.\n');
