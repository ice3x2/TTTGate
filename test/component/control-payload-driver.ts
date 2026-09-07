import net from "net";
import {once} from "events";
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer} from "../../src/commons/CtrlPacket";
import {TunnelClient} from "../../src/client/TunnelClient";
import TTTServer from "../../src/server/TTTServer";
import ServerOptionStore from "../../src/server/ServerOptionStore";
import {CertificationStore} from "../../src/server/CertificationStore";
import {SocketHandler} from "../../src/util/SocketHandler";
import SocketState from "../../src/util/SocketState";
import {applyTestRoot, cleanupTestRoot, createTestRoot} from "../helpers/runtime";
import {getFreePort, waitFor} from "../helpers/network";

const malformedClose = (): Buffer => {
    const header = Buffer.from(CtrlPacket.closeSession(7, 42, 0).toBuffer().subarray(0, CtrlPacket.HEADER_LEN));
    header.writeUInt32BE(0, CtrlPacket.HEADER_LEN - 4);
    return header;
};

const serverCase = async () => {
    const root = await createTestRoot("control-payload-9");
    applyTestRoot(root.rootDir);
    let server: TTTServer | undefined;
    let socket: net.Socket | undefined;
    try {
        await CertificationStore.instance.load();
        const port = await getFreePort();
        if(!ServerOptionStore.instance.updateServerOption({key: "issue9-test-key", port, tls: false,
            adminPort: 9300, adminBindHost: "127.0.0.1", adminTls: true,
            controlProtocolMode: "legacy", allowLegacyControlAuth: true,
            tunnelingOptions: [], keepAlive: 0, globalMemCacheLimit: 128})) {
            throw new Error("Invalid server fixture options");
        }
        server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();
        socket = net.createConnection({host: "127.0.0.1", port});
        await once(socket, "connect");
        const streamer = new CtrlPacketStreamer();
        socket.on("data", (data) => {
            for (const packet of streamer.readCtrlPacketList(data)) {
                if(packet.cmd === CtrlCmd.SyncCtrlAck) {
                    socket!.write(CtrlPacket.createAckCtrl(packet.ID, "issue9-client", "issue9-test-key").toBuffer());
                }
            }
        });
        socket.write(CtrlPacket.createSyncCtrl().toBuffer());
        await waitFor(() => {
            if(server!.clientStatus().length !== 1) throw new Error("Waiting for authenticated control channel");
            return true;
        });
        const pool = Array.from((server as any)._tunnelServer._clientHandlerPoolMap.values())[0] as any;
        socket.write(Buffer.concat([malformedClose(), CtrlPacket.message(pool.id, {
            type: "sysinfo", payload: {marker: "valid-tail"},
        }).toBuffer()]));
        await waitFor(() => {
            if(socket!.destroyed) throw new Error("Malformed payload destroyed the authenticated server control channel");
            if(pool.sysInfo.marker !== "valid-tail") throw new Error("Server did not consume the valid following frame");
            return true;
        }, {timeoutMs: 2000, intervalMs: 20});
        console.log("RESULT server-alive valid-tail");
    } finally {
        socket?.destroy();
        await server?.close();
        await cleanupTestRoot(root);
    }
};

const clientCase = async (pending: boolean) => {
    const sockets: net.Socket[] = [];
    let wire: net.Socket;
    const controlServer = net.createServer((socket) => {
        sockets.push(socket);
        wire = socket;
        const streamer = new CtrlPacketStreamer();
        socket.on("data", (data) => {
            for (const packet of streamer.readCtrlPacketList(data)) {
                if(packet.cmd === CtrlCmd.SyncCtrl) socket.write(CtrlPacket.createSyncCtrlAck(7).toBuffer());
            }
        });
    });
    const pausedPeer = net.createServer((socket) => { sockets.push(socket); socket.pause(); });
    controlServer.listen(0, "127.0.0.1");
    pausedPeer.listen(0, "127.0.0.1");
    await Promise.all([once(controlServer, "listening"), once(pausedPeer, "listening")]);
    const client = TunnelClient.create({key: "issue9-test-key", name: "issue9-client",
        host: "127.0.0.1", port: (controlServer.address() as net.AddressInfo).port, tls: false, keepAlive: 0});
    let dataHandler: SocketHandler | undefined;
    let closedSessions = 0;
    client.onEndPointCloseCallback = () => { closedSessions++; };
    try {
        await new Promise<void>((resolve) => {
            client.onCtrlStateCallback = (_client, state) => { if(state === "connected") resolve(); };
            client.connect();
        });
        dataHandler = await new Promise<SocketHandler>((resolve) => {
            SocketHandler.connect({host: "127.0.0.1", port: (pausedPeer.address() as net.AddressInfo).port, keepalive: 0},
                (handler, state) => { if(state === SocketState.Connected) resolve(handler); });
        });
        // Install a real connected transport as the active session. No handler,
        // queue, drain callback, parser or consumer implementation is replaced.
        (client as any)._activatedSessionDataHandlerMap.set(42, dataHandler);
        if(pending) {
            dataHandler.setBufferSizeLimit(-1);
            // Cork the actual socket so its write callback cannot race ahead
            // of the malformed control frame on the separate control socket.
            dataHandler.socket.cork();
            dataHandler.sendData(Buffer.alloc(64 * 1024, 1));
            if(dataHandler.isOutputDrained) throw new Error("Fixture did not create pending output");
            console.log("PENDING_OUTPUT_CONFIRMED");
        }
        const followed = new Promise<void>((resolve, reject) => {
            client.onConnectEndPointCallback = () => resolve();
            client.onCtrlStateCallback = (_client, state) => {
                if(state === "closed") reject(new Error("Malformed payload destroyed the client control channel"));
            };
        });
        wire!.write(Buffer.concat([malformedClose(), CtrlPacket.connectEndPoint(7, 42, {
            host: "127.0.0.1", port: 12345, tls: false, bufferLimit: -1,
        }).toBuffer()]));
        await followed;
        if((client as any)._ctrlHandler.socket.destroyed) throw new Error("Client control channel was destroyed");
        const queuedCallbacks = (dataHandler as any)._drainEventList.length;
        dataHandler.socket.destroy();
        // Before #9's fix, the deferred CloseSession getter throws from this
        // actual socket close event and kills the child process.
        // SocketHandler.release removes listeners during write-error cleanup,
        // so wait for queued write callbacks rather than an erased close listener.
        await new Promise<void>((resolve) => setImmediate(resolve));
        if(!dataHandler.socket.destroyed) throw new Error("Data socket did not terminate");
        if(closedSessions !== 0 || queuedCallbacks !== 0) throw new Error("Malformed packet reached the close-session consumer");
        console.log("RESULT client-alive valid-tail");
    } finally {
        client.destroy();
        dataHandler?.destroy();
        sockets.forEach((socket) => socket.destroy());
        await Promise.all([new Promise<void>((resolve) => controlServer.close(() => resolve())),
            new Promise<void>((resolve) => pausedPeer.close(() => resolve()))]);
    }
};

const watchdog = setTimeout(() => { console.error("Consumer fixture timed out"); process.exit(2); }, 15_000);
(process.argv[2] === "server" ? serverCase() : clientCase(process.argv[2] === "pending"))
    .then(() => clearTimeout(watchdog), (error) => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
