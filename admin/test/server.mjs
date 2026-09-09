import {fileURLToPath} from 'node:url';
process.send?.({stage: 'import-vite'});
const {createServer, preview} = await import('vite');
process.send?.({stage: 'create'});

const root = fileURLToPath(new URL('..', import.meta.url));
const isPreview = process.env.ADMIN_TEST_PREVIEW === '1';
const options = {host: '127.0.0.1', port: 0, open: false};
if(process.env.ADMIN_TEST_HTTP_ALIAS === '1') options.allowedHosts = ['admin.test'];
if(process.env.ADMIN_TEST_API_ORIGIN) {
    options.proxy = {'/api': {target: process.env.ADMIN_TEST_API_ORIGIN, rewrite: (url) => url}};
}
// Override only the target for the actual-config proxy regression. Preview
// inherits server.proxy, retaining its original path rewrite and other options.
const proxyOverride = process.env.ADMIN_TEST_PROXY_TARGET
    ? {proxy: {'/api': {target: process.env.ADMIN_TEST_PROXY_TARGET}}} : {};
const server = isPreview
    ? await preview({root, server: proxyOverride, preview: options, logLevel: 'error'})
    : await createServer({root, server: {...options, ...proxyOverride}, logLevel: 'error'});
process.send?.({stage: 'listen'});
if(!isPreview) await server.listen();
process.send?.({stage: 'ipc-ready'});
process.send({url: server.resolvedUrls.local[0].replace(/\/$/, '')});
process.on('message', async (message) => {
    if(message === 'close') {
        if(isPreview) await new Promise((resolve) => server.httpServer.close(resolve));
        else await server.close();
        process.disconnect();
    }
});
