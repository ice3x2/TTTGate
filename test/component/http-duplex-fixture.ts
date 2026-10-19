import net from "node:net";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import HttpHandler from "../../src/server/http/HttpHandler";
import {SocketHandler} from "../../src/util/SocketHandler";
import SocketState from "../../src/util/SocketState";

export async function withHttpDuplex(check: (fixture: {
    client: net.Socket; upstream: net.Socket; handler: HttpHandler;
    requests: () => Buffer; responses: () => Buffer;
    until: (condition: () => boolean) => Promise<void>; ownerCalls: () => number;
}) => Promise<void>, rewrite = false) {
    const upstreamServer = net.createServer(), proxy = net.createServer();
    const sockets: net.Socket[] = [];
    let handler: HttpHandler | undefined, owners = 0;
    const inbound: Buffer[] = [], outbound: Buffer[] = [];
    const track = (socket: net.Socket) => { sockets.push(socket); socket.on("error", () => {}); return socket; };
    try {
        upstreamServer.listen(0, "127.0.0.1"); await once(upstreamServer, "listening");
        const acceptedUpstream = new Promise<net.Socket>(resolve => upstreamServer.once("connection", socket => {
            track(socket); socket.on("data", data => inbound.push(Buffer.from(data))); resolve(socket);
        }));
        proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
        const bound = new Promise<HttpHandler>(resolve => proxy.once("connection", socket => {
            track(socket);
            const connection = track(net.createConnection({host: "127.0.0.1", port: (upstreamServer.address() as net.AddressInfo).port}));
            const raw = SocketHandler.bound({socket, port: (proxy.address() as net.AddressInfo).port, addr: "127.0.0.1", tls: false, keepAlive: 0}, () => {}, () => owners++);
            handler = HttpHandler.create(raw, {forwardPort: 8080, destinationAddress: "internal.example", destinationPort: 80, protocol: "http", keepAlive: 0, httpOption: {rewriteHostInTextBody: rewrite}});
            handler.onSocketEvent = (_current, state, data) => {
                if(state === SocketState.Receive) connection.write(data);
                else if(state === SocketState.End || state === SocketState.Closed) connection.destroy();
            };
            connection.on("data", data => handler!.sendData(data));
            connection.on("end", () => handler!.end_());
            resolve(handler);
        }));
        const client = track(net.createConnection({host: "127.0.0.1", port: (proxy.address() as net.AddressInfo).port}));
        client.on("data", data => outbound.push(Buffer.from(data)));
        await once(client, "connect");
        const current = await bound, upstream = await acceptedUpstream;
        const until = async (condition: () => boolean) => {
            const deadline = Date.now() + 2000;
            while(!condition()) { if(Date.now() > deadline) throw new Error("HTTP fixture condition timed out"); await delay(5); }
        };
        await check({client, upstream, handler: current, requests: () => Buffer.concat(inbound), responses: () => Buffer.concat(outbound), until, ownerCalls: () => owners});
    } finally {
        handler?.destroy(); sockets.forEach(socket => socket.destroy());
        await Promise.all([upstreamServer, proxy].filter(server => server.listening).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    }
}
