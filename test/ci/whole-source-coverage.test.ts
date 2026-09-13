import fs from 'node:fs';
import path from 'node:path';
import {globsToMatcher} from 'jest-util';
import config from '../../jest.config';

jest.setTimeout(30_000);
const root = path.resolve(__dirname, '../..');
const matches = globsToMatcher(config.collectCoverageFrom ?? []);

type CoverageMetric = 'lines' | 'statements' | 'functions' | 'branches';
const coverageMetrics: CoverageMetric[] = ['lines', 'statements', 'functions', 'branches'];
const globalFloors = (config.coverageThreshold?.global ?? {}) as Record<CoverageMetric, number>;

type CoverageBaseline = {
    commit: string,
    command: string,
    date: string,
    measured: Record<CoverageMetric, number>,
    threshold: Record<CoverageMetric, number>
};

function readBaseline(): CoverageBaseline {
    const file = path.join(root, 'docs/plan/verification/unit0-coverage-baseline.json');
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as CoverageBaseline;
}

function sourceFiles(directory: string): string[] {
    return fs.readdirSync(path.join(root, directory), {withFileTypes: true}).flatMap(entry => {
        const relative = `${directory}/${entry.name}`;
        return entry.isDirectory() ? sourceFiles(relative) : entry.isFile() ? [relative] : [];
    }).sort();
}

test('whole-source coverage includes every eligible production source file', () => {
    const files = sourceFiles('src');
    const executable = files.filter(file => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file) && !file.endsWith('.d.ts'));
    const unsupported = executable.filter(file => !file.endsWith('.ts'));
    expect({unsupportedInstrumentation: unsupported}).toEqual({unsupportedInstrumentation: []});
    expect(executable.length).toBeGreaterThan(0);
    expect(executable).toEqual(expect.arrayContaining(['src/app.ts', 'src/util/SocketHandler.ts',
        'src/commons/CtrlPacket.ts', 'src/commons/DataStatePacket.ts', 'src/server/TTTServer.ts']));
    expect(executable.filter(file => !matches(file))).toEqual([]);
});

test('whole-source coverage preserves the four original non-regression floors', () => {
    expect(config.coverageThreshold?.global).toEqual({
        lines: 85.48, statements: 84.67, functions: 90.66, branches: 75.59
    });
});

test('whole-source coverage floors never drop below the issue52 baselines', () => {
    const issue52 = {lines: 64.26, statements: 63.71, functions: 69.74, branches: 52.23};
    for (const metric of coverageMetrics) {
        expect(globalFloors[metric]).toBeGreaterThanOrEqual(issue52[metric]);
    }
});

test('whole-source coverage floors are not above the recorded measurement', () => {
    const baseline = readBaseline();
    expect(baseline.threshold).toEqual(globalFloors);
    for (const metric of coverageMetrics) {
        expect(baseline.measured[metric]).toBeGreaterThanOrEqual(globalFloors[metric] + 0.5);
    }
});

test('whole-source coverage admits future source paths without implementation exclusions', () => {
    expect(matches('src/future/nested/new-source.ts')).toBe(true);
    expect(matches('src/future/nested/declarations.d.ts')).toBe(false);
    // Negative patterns may remove declarations only, not implementation paths.
    const exclusions = (config.collectCoverageFrom ?? []).filter(pattern => pattern.startsWith('!'));
    expect(exclusions.filter(pattern => !pattern.endsWith('.d.ts'))).toEqual([]);
});
