import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';

const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: {host: '127.0.0.1', port: 0, open: false},
    logLevel: 'error',
});
await server.listen();
process.send({url: server.resolvedUrls.local[0].replace(/\/$/, '')});
process.on('message', async (message) => {
    if(message === 'close') {
        await server.close();
        process.disconnect();
    }
});
