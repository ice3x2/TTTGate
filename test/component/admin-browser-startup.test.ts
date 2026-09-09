import childProcess = require('child_process');
import path from 'node:path';
import {startAdminBrowser} from '../helpers/adminBrowser';

jest.setTimeout(30_000);

test.each(['early', 'no-ready'])('actual admin child %s preserves startup diagnostics', async mode => {
    const original = childProcess.fork;
    let child: childProcess.ChildProcess | undefined;
    const delegate = jest.spyOn(childProcess, 'fork').mockImplementation((_file, _args, options) => {
        child = original(path.resolve(__dirname, '../fixtures/admin-ready-child.cjs'), [mode], options);
        return child;
    });
    try {
        const failure = await startAdminBrowser().then(() => undefined, error => error);
        expect(failure).toBeInstanceOf(Error);
        expect(failure.message).toContain(`pid=${child!.pid}`);
        expect(failure.message).toContain('ipc=');
        expect(failure.message).toContain('stage=');
        expect(failure.message).toContain('owned-ready-stdout');
        expect(failure.message).toContain('owned-ready-stderr');
        if(mode === 'early') expect(failure.message).toContain('exitCode=23');
        else {
            expect(failure.message).toContain('stage=listen');
            expect(failure.message).toContain('15000ms');
            expect(failure.message).toContain('exitCode=0');
        }
        expect(child!.exitCode).not.toBeNull();
    } finally { delegate.mockRestore(); }
});

test('admin child error wrapper preserves the exact original error as its cause', async () => {
    const original = childProcess.fork;
    const fault = Object.assign(new Error('owned child error event'), {code: 'EOWNED', path: 'owned-path', syscall: 'owned-call'});
    const delegate = jest.spyOn(childProcess, 'fork').mockImplementation((_file, _args, options) => {
        const child = original(path.resolve(__dirname, '../fixtures/admin-ready-child.cjs'), ['no-ready'], options);
        // Explicit event fault on an actual owned child; not a claimed OS spawn failure.
        setImmediate(() => child.emit('error', fault));
        return child;
    });
    try {
        const failure = await startAdminBrowser().then(() => undefined, error => error);
        expect(failure.cause.cause).toBe(fault);
        expect(failure.cause.cause.stack).toBe(fault.stack);
    } finally { delegate.mockRestore(); }
});

test('actual admin child normal ready opens browser and closes naturally', async () => {
    const original = childProcess.fork;
    const delegate = jest.spyOn(childProcess, 'fork').mockImplementation((_file, _args, options) =>
        original(path.resolve(__dirname, '../fixtures/admin-ready-child.cjs'), ['ready'], options));
    try {
        const app = await startAdminBrowser();
        try { await app.page.goto(app.url); expect(await app.page.textContent('body')).toBe('owned ready'); }
        finally { await app.close(); }
    } finally { delegate.mockRestore(); }
});
