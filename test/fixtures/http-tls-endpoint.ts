import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';

export async function createHttpEndpoint(onRequest: (request: http.IncomingMessage, body: Buffer, response: http.ServerResponse) => void) {
    const sockets = new Set<net.Socket>();
    const server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', bytes => chunks.push(Buffer.from(bytes)));
        request.on('end', () => onRequest(request, Buffer.concat(chunks), response));
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    return {port: (server.address() as net.AddressInfo).port, server,
        async close() { sockets.forEach(socket => socket.destroy()); if(server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }};
}
