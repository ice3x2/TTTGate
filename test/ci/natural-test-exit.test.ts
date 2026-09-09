import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'yaml';

const root = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test.each([
    ['test', 'jest --detectOpenHandles'],
    ['test:coverage', 'jest --detectOpenHandles --coverage'],
])('%s retains its full selection and diagnostics without forced exit', (name, expected) => {
    expect(manifest.scripts[name]).toBe(expected);
});

test('supply-chain workflow retains its exact suite selection and diagnostics without forced exit', () => {
    const workflow = parse(fs.readFileSync(path.join(root, '.github/workflows/supply-chain-audit.yml'), 'utf8'));
    const step = workflow.jobs.tests.steps.find((entry: {name?: string}) => entry.name === 'R3 supply-chain tests');
    expect(step.run).toBe('npx jest test/supply-chain/ --detectOpenHandles');
    expect(step['continue-on-error']).toBeUndefined();
});
