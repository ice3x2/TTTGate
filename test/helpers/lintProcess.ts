import {spawnSync} from 'child_process';
import {existsSync, readFileSync, realpathSync, rmSync} from 'fs';
import {join, resolve} from 'path';

export function cleanupOwnedLintRoot(root: string) {
    if (!existsSync(root)) return;
    try {
        expect(realpathSync(root)).toBe(resolve(root));
        rmSync(root, {recursive: true, force: true});
    } catch (cause) {
        throw new Error(`Failed to clean owned lint root ${root}: ${String(cause)}`, {cause});
    }
}

export function runLintProcess(options: {script: string; target: string; reportDir: string; cwd: string;
    strict: boolean; expectedExit: 0 | 1; executable?: string; timeout?: number}) {
    const executable = options.executable ?? process.execPath;
    const args = [options.script, options.target, '--report-dir', options.reportDir];
    const started = Date.now();
    const res = spawnSync(executable, args, {cwd: options.cwd, encoding: 'utf8',
        env: {...process.env, LINT_AUTH_COMPARE_STRICT: options.strict ? '1' : '0'}, timeout: options.timeout ?? 30_000});
    const context = `expected=${options.expectedExit} status=${res.status} signal=${res.signal} ` +
        `error=${res.error?.message ?? ''} code=${(res.error as NodeJS.ErrnoException)?.code ?? ''} ` +
        `command=${JSON.stringify([executable, ...args])} cwd=${options.cwd} elapsedMs=${Date.now() - started} ` +
        `stderr=${res.stderr ?? ''} stdout=${res.stdout ?? ''}`;
    expect({context, status: res.status, signal: res.signal, error: res.error}).toEqual({
        context, status: options.expectedExit, signal: null, error: undefined});
    function parseJson(value: string, source: string) {
        try {
            return JSON.parse(value);
        } catch (cause) {
            throw new Error(`Malformed ${source} JSON: ${String(cause)}; ${context}`, {cause});
        }
    }
    const events = (res.stdout ?? '').trim().split(/\r?\n/).filter(Boolean).map(line => parseJson(line, 'stdout'));
    const summaries = events.filter(event => event.type === 'summary');
    expect({context, summaries}).toEqual({context, summaries: [expect.objectContaining({
        tool: 'lint-auth-compare', strict: options.strict, scannedFiles: expect.any(Number), violationCount: expect.any(Number)})]});
    const summary = summaries[0];
    const violations = events.filter(event => event.type === 'violation');
    expect({context, count: summary.violationCount, scanned: summary.scannedFiles > 0}).toEqual({
        context, count: violations.length, scanned: true});
    expect({context, violationExit: options.strict && violations.length > 0 ? 1 : 0}).toEqual({context, violationExit: options.expectedExit});
    const reportPath = join(options.reportDir, 'auth-compare.json');
    expect({context, reportExists: existsSync(reportPath)}).toEqual({context, reportExists: true});
    const report = parseJson(readFileSync(reportPath, 'utf8'), 'report');
    const {type: _type, ...reportSummary} = summary;
    expect({context, report}).toEqual({context, report: {summary: reportSummary,
        violations: violations.map(({type: _eventType, ...violation}) => violation)}});
    return res;
}
