import {createServer, preview} from 'vite';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const isPreview = process.env.ADMIN_TEST_PREVIEW === '1';
const options = {host: '127.0.0.1', port: 0, open: false};
if(process.env.ADMIN_TEST_HTTP_ALIAS === '1') options.allowedHosts = ['admin.test'];
if(process.env.ADMIN_TEST_API_ORIGIN) {
    options.proxy = {'/api': {target: process.env.ADMIN_TEST_API_ORIGIN, rewrite: (url) => url}};
}
const server = isPreview
    ? await preview({root, preview: options, logLevel: 'error'})
    : await createServer({root, server: options, logLevel: 'error'});
if(!isPreview) await server.listen();
process.send({url: server.resolvedUrls.local[0].replace(/\/$/, '')});
process.on('message', async (message) => {
    if(message === 'close') {
        if(isPreview) await new Promise((resolve) => server.httpServer.close(resolve));
        else await server.close();
        process.disconnect();
    }
});
