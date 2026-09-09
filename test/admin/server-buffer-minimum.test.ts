import {withConfigurationServer} from '../component/server/admin/configuration-revision-fixture';
import {writeWebFixture} from '../helpers/runtime';
import {getFreePort} from '../helpers/network';
import {startAdminBrowser} from '../helpers/adminBrowser';

jest.setTimeout(60000);
test('server buffer editor keeps invalid values and blocks mutation while preserving client policy', async () => withConfigurationServer(async f => {
    const port = await getFreePort();
    expect((await f.request('POST', '/api/tunnelingOption', {forwardPort: port, protocol: 'tcp', destinationAddress: '127.0.0.1', destinationPort: 9,
        bufferLimitOnServer: 8, bufferLimitOnClient: -1, keepAlive: 0, expectedRevision: f.store.revisionState.currentRevision})).statusCode).toBe(200);
    const app = await startAdminBrowser();
    try {
        await writeWebFixture(f.root.rootDir, 'index.html', `<script type="module" src="${app.url}/test/configuration.ts"></script>`);
        await app.page.goto(`http://127.0.0.1:${f.ports[0]}`);
        await app.page.waitForFunction(() => !!(window as any).configurationFixture);
        expect(await app.page.evaluate(async () => (await fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: 'revision-password'})})).status)).toBe(200);
        await app.page.evaluate(() => (window as any).configurationFixture.mount('tunnel'));
        const input = app.page.locator('#input-buffer-limit-server'); await input.waitFor();
        const button = app.page.getByRole('button', {name: 'Apply and Restart'}), mutations: string[] = [];
        app.page.on('request', req => { if(req.method() === 'POST') mutations.push(new URL(req.url()).pathname); });
        for(const value of ['0', '-1', '0.5', '']) {
            await input.fill(value);
            expect(await input.inputValue()).toBe(value);
            expect(await button.isDisabled()).toBe(true);
            expect(await app.page.getByText('Server buffer must be a finite number of at least 1 MiB.', {exact: true}).isVisible()).toBe(true);
            await button.evaluate((element: HTMLButtonElement) => element.click());
            expect(mutations).toEqual([]); expect(f.store.getTunnelingOption(port).bufferLimitOnServer).toBe(8);
        }
        await input.fill('1.5');
        expect(await button.isEnabled()).toBe(true);
        const client = app.page.locator('#input-buffer-limit-client');
        expect(await client.inputValue()).toBe('-1');
        await client.fill('0');
        expect(await button.isEnabled()).toBe(true);
        await button.click(); await app.page.getByText('Success to apply tunneling option', {exact: true}).waitFor();
        expect(mutations).toEqual(['/api/tunnelingOption']);
        expect(f.store.getTunnelingOption(port).bufferLimitOnServer).toBe(1.5);
        expect(f.store.getTunnelingOption(port).bufferLimitOnClient).toBe(0);
        expect(await app.page.getByText('Client buffer: nonpositive values retain the existing unlimited setting.', {exact: true}).isVisible()).toBe(true);
        await app.page.evaluate(() => (window as any).configurationFixture.unmount());
    } finally { await app.close(); }
}));
