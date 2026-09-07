import assert from "node:assert/strict";
import net from "node:net";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import {TCPServer} from "../../src/util/TCPServer";
import {SocketHandler} from "../../src/util/SocketHandler";
import SocketState from "../../src/util/SocketState";
import {ClientHandlerPool} from "../../src/server/ClientHandlerPool";
import {ExternalPortServerPool} from "../../src/server/ExternalPortServerPool";
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer} from "../../src/commons/CtrlPacket";
import {TunnelDataHandler} from "../../src/types/TunnelHandler";
import {getFreePort} from "../helpers/network";

const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 4000;
    while(!condition()) {
        if(Date.now() >= deadline) throw new Error("Socket lifecycle did not settle");
        await delay(10);
    }
};
const mapOf = (server: TCPServer): Map<number, SocketHandler> => (server as any)._idHandlerMap;
const connect = async (port: number, clients: net.Socket[]) => {
    const socket = net.createConnection({host: "127.0.0.1", port});
    clients.push(socket);
    socket.on("error", () => {});
    socket.resume();
    await once(socket, "connect");
    return socket;
};

const controlCase = async () => {
    const port = await getFreePort();
    const server = TCPServer.create({port, keepAlive: 0});
    const clients: net.Socket[] = [];
    let pool: ClientHandlerPool | undefined;
    let control: SocketHandler | undefined;
    server.setOnHandlerEvent((handler, state) => {
        if(handler === control && (state === SocketState.End || state === SocketState.Closed)) pool?.end();
    });
    try {
        await new Promise<void>((resolve, reject) => server.start((error) => error ? reject(error) : resolve()));
        const controlClient = await connect(port, clients);
        await until(() => mapOf(server).size === 1);
        control = [...mapOf(server).values()][0];
        pool = ClientHandlerPool.create(1, control);
        const streamer = new CtrlPacketStreamer();
        const newHandler = new Promise<CtrlPacket>((resolve) => controlClient.on("data", (data) => {
            for(const packet of streamer.readCtrlPacketList(data)) if(packet.cmd === CtrlCmd.NewDataHandler) resolve(packet);
        }));
        pool.sendConnectEndPoint(1, {host: "127.0.0.1", port: 9, tls: false, bufferLimit: 1024});
        const packet = await newHandler;
        const dataClient = await connect(port, clients);
        await until(() => mapOf(server).size === 2);
        const data = [...mapOf(server).values()].find((handler) => handler !== control)! as TunnelDataHandler;
        data.handlerID = packet.ID;
        pool.putNewDataHandler(data);
        assert.equal(pool.activatedSessionCount, 1);
        const survivor = await connect(port, clients);
        await until(() => mapOf(server).size === 3);
        const live = [...mapOf(server).values()].find((handler) => handler !== control && handler !== data)!;
        const closed = Promise.all([once(controlClient, "close"), once(dataClient, "close")]);
        controlClient.end();
        await closed;
        await until(() => control!.state === SocketState.Closed && data.state === SocketState.Closed);
        assert.equal(pool.activatedSessionCount, 0);
        assert.deepEqual([...mapOf(server).keys()], [live.id]);
        assert.equal(live.isEnd(), false);
        const liveClosed = once(survivor, "close");
        survivor.end();
        await liveClosed;
        await until(() => live.state === SocketState.Closed);
        assert.equal(mapOf(server).size, 0);
        console.log("RESULT control closed=0 live-retained=1");
    } finally {
        pool?.end();
        clients.forEach((socket) => socket.destroy());
        if(!server.isEnd()) await new Promise<void>((resolve) => server.stop(() => resolve()));
    }
};

const httpCase = async (mode: string) => {
    const port = await getFreePort();
    const pool = ExternalPortServerPool.create([]);
    const clients: net.Socket[] = [];
    const ids: number[] = [];
    pool.OnNewSessionCallback = (id) => ids.push(id);
    try {
        await pool.startServer({forwardPort: port, protocol: "http", destinationAddress: "127.0.0.1",
            destinationPort: 9, tls: false, keepAlive: 0});
        const server: TCPServer = (pool as any)._portServerMap.get(port);
        const closingClient = await connect(port, clients);
        await until(() => mapOf(server).size === 1 && ids.length === 1);
        const closing = [...mapOf(server).values()][0];
        const survivor = await connect(port, clients);
        await until(() => mapOf(server).size === 2 && ids.length === 2);
        const live = [...mapOf(server).values()].find((handler) => handler !== closing)!;
        const closed = new Promise<void>((resolve) => closingClient.once("close", () => resolve()));
        if(mode === "http-end") closingClient.end("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        else if(mode === "http-destroy") (pool as any)._handlerMap.get(ids[0]).destroy();
        else if(mode === "http-close") closing.socket.destroy();
        else closing.socket.destroy(new Error("intentional socket failure fixture"));
        await closed;
        await until(() => closing.state === SocketState.Closed);
        assert.deepEqual([...mapOf(server).keys()], [live.id]);
        assert.equal(live.isEnd(), false);
        const liveClosed = once(survivor, "close");
        survivor.end();
        await liveClosed;
        await until(() => live.state === SocketState.Closed);
        assert.equal(mapOf(server).size, 0);
        console.log(`RESULT ${mode} closed=0 live-retained=1`);
    } finally {
        clients.forEach((socket) => socket.destroy());
        await pool.dispose();
    }
};

const mode = process.argv[2];
(mode === "control" ? controlCase() : httpCase(mode)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
