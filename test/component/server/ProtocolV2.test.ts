import net from "net";
import {CtrlPacket, CtrlPacketStreamer, CtrlCmd} from "../../../src/commons/CtrlPacket";
import {buildHandshakeProof, CONTROL_PROTOCOL_V2, DEFAULT_PROTOCOL_V2_CAPABILITIES} from "../../../src/commons/ProtocolV2";
import DataStatePacket from "../../../src/commons/DataStatePacket";
import {ClientHandlerPool} from "../../../src/server/ClientHandlerPool";
import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import TTTServer from "../../../src/server/TTTServer";
import {SocketHandler} from "../../../src/util/SocketHandler";
import {DEFAULT_KEY, ServerOption} from "../../../src/types/TunnelingOption";
import {getFreePort, startEchoServer, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(30000);

class RawControlClient {
    private readonly _streamer = new CtrlPacketStreamer();
    private readonly _packetQueue: CtrlPacket[] = [];
    private readonly _waiters: Array<(packet: CtrlPacket) => void> = [];
    private readonly _socket: net.Socket;
    private _closed = false;

    public constructor(host: string, port: number) {
        this._socket = net.createConnection({host, port});
        this._socket.on("data", (chunk) => {
            const packets = this._streamer.readCtrlPacketList(chunk);
            packets.forEach((packet) => {
                const waiter = this._waiters.shift();
                if(waiter) {
                    waiter(packet);
                    return;
                }
                this._packetQueue.push(packet);
            });
        });
        this._socket.once("close", () => {
            this._closed = true;
        });
    }

    public async waitUntilConnected(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this._socket.once("connect", () => resolve());
            this._socket.once("error", reject);
        });
    }

    public send(packet: CtrlPacket): void {
        this._socket.write(packet.toBuffer());
    }

    public async readPacket(timeoutMs: number = 3000): Promise<CtrlPacket> {
        if(this._packetQueue.length > 0) {
            return this._packetQueue.shift()!;
        }

        return await new Promise<CtrlPacket>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms while waiting for packet`)), timeoutMs);
            this._waiters.push((packet) => {
                clearTimeout(timer);
                resolve(packet);
            });
        });
    }

    public async waitForClose(timeoutMs: number = 3000): Promise<void> {
        await waitFor(() => {
            if(!this._closed) {
                throw new Error("control socket is still open");
            }
            return true;
        }, {timeoutMs, intervalMs: 25});
    }

    public destroy(): void {
        this._socket.destroy();
    }
}

const completeV2Handshake = async (rawClient: RawControlClient, identity: {clientId: string, clientSecret: string, displayName: string}): Promise<CtrlPacket> => {
    rawClient.send(CtrlPacket.createSyncCtrl());
    const syncAck = await rawClient.readPacket();
    const syncMeta = syncAck.syncCtrlAckMeta;
    if(!syncMeta) {
        throw new Error("server did not return protocol v2 metadata");
    }
    const controlID = syncMeta.controlID ?? syncAck.ID;
    rawClient.send(CtrlPacket.createAckCtrl(syncAck.ID, identity.displayName, DEFAULT_KEY, {
        protocolVersion: CONTROL_PROTOCOL_V2,
        capabilities: DEFAULT_PROTOCOL_V2_CAPABILITIES,
        controlID,
        clientId: identity.clientId,
        displayName: identity.displayName,
        proof: buildHandshakeProof(identity.clientSecret, identity.clientId, controlID, syncMeta.challengeNonce)
    }));
    return syncAck;
};

describe("protocol v2 control plane", () => {
    let testRoot: TestRoot;
    let server: TTTServer;
    let serverPort: number;
    let forwardPort: number;
    let echoServer: Awaited<ReturnType<typeof startEchoServer>> | undefined;

    const startServer = async (optionOverride: Partial<ServerOption> = {}): Promise<void> => {
        await CertificationStore.instance.load();
        serverPort = await getFreePort();
        forwardPort = await getFreePort();
        const tunnelingOptions = optionOverride.tunnelingOptions ?? [];
        const serverOption: ServerOption = {
            key: DEFAULT_KEY,
            adminPort: 9300,
            adminBindHost: "127.0.0.1",
            adminTls: true,
            port: serverPort,
            tls: false,
            controlProtocolMode: "mixed",
            trustedClients: [{
                clientId: "client-a",
                clientSecret: "client-secret-a",
                displayName: "Client A"
            }],
            tunnelingOptions,
            keepAlive: 0,
            globalMemCacheLimit: 128,
            ...optionOverride
        };
        if(!ServerOptionStore.instance.updateServerOption(serverOption)) {
            throw new Error("failed to apply server option for protocol v2 test");
        }
        server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();
    };

    beforeEach(async () => {
        testRoot = await createTestRoot("protocol-v2");
        applyTestRoot(testRoot.rootDir);
    });

    afterEach(async () => {
        await server?.close();
        await echoServer?.close();
        await cleanupTestRoot(testRoot);
    });

    it("registers an authenticated v2 client identity", async () => {
        await startServer();

        const rawClient = new RawControlClient("127.0.0.1", serverPort);
        await rawClient.waitUntilConnected();
        await completeV2Handshake(rawClient, {
            clientId: "client-a",
            clientSecret: "client-secret-a",
            displayName: "Client A"
        });

        await waitFor(() => {
            const statuses = server.clientStatus();
            if(statuses.length !== 1) {
                throw new Error("client is not registered yet");
            }
            expect(statuses[0]).toMatchObject({
                clientId: "client-a",
                name: "Client A",
                protocolVersion: CONTROL_PROTOCOL_V2,
                legacy: false
            });
            return true;
        }, {timeoutMs: 5000, intervalMs: 25});

        rawClient.destroy();
    });

    it("rejects spoofed identity attempts with an invalid proof", async () => {
        await startServer();

        const rawClient = new RawControlClient("127.0.0.1", serverPort);
        await rawClient.waitUntilConnected();
        rawClient.send(CtrlPacket.createSyncCtrl());
        const syncAck = await rawClient.readPacket();
        const syncMeta = syncAck.syncCtrlAckMeta!;
        const controlID = syncMeta.controlID ?? syncAck.ID;
        rawClient.send(CtrlPacket.createAckCtrl(syncAck.ID, "Spoofed", DEFAULT_KEY, {
            protocolVersion: CONTROL_PROTOCOL_V2,
            capabilities: DEFAULT_PROTOCOL_V2_CAPABILITIES,
            controlID,
            clientId: "client-a",
            displayName: "Spoofed",
            proof: buildHandshakeProof("wrong-secret", "client-a", controlID, syncMeta.challengeNonce)
        }));

        await rawClient.waitForClose();
        expect(server.clientStatus()).toHaveLength(0);
    });

    it("rejects AckCtrl packets whose packet ID does not match the bound handler", async () => {
        await startServer();

        const rawClient = new RawControlClient("127.0.0.1", serverPort);
        await rawClient.waitUntilConnected();
        rawClient.send(CtrlPacket.createSyncCtrl());
        const syncAck = await rawClient.readPacket();
        const syncMeta = syncAck.syncCtrlAckMeta!;
        rawClient.send(CtrlPacket.createAckCtrl(syncAck.ID + 1, "Client A", DEFAULT_KEY, {
            protocolVersion: CONTROL_PROTOCOL_V2,
            capabilities: DEFAULT_PROTOCOL_V2_CAPABILITIES,
            controlID: (syncMeta.controlID ?? syncAck.ID) + 1,
            clientId: "client-a",
            displayName: "Client A",
            proof: buildHandshakeProof("client-secret-a", "client-a", (syncMeta.controlID ?? syncAck.ID) + 1, syncMeta.challengeNonce)
        }));

        await rawClient.waitForClose();
        expect(server.clientStatus()).toHaveLength(0);
    });

    it("accepts legacy clients only in mixed mode", async () => {
        await startServer({
            trustedClients: [],
            allowLegacyControlAuth: true
        });

        const rawClient = new RawControlClient("127.0.0.1", serverPort);
        await rawClient.waitUntilConnected();
        rawClient.send(CtrlPacket.createSyncCtrl());
        const syncAck = await rawClient.readPacket();
        rawClient.send(CtrlPacket.createAckCtrl(syncAck.ID, "legacy-client", DEFAULT_KEY));

        await waitFor(() => {
            const statuses = server.clientStatus();
            if(statuses.length !== 1) {
                throw new Error("legacy client is not registered yet");
            }
            expect(statuses[0]).toMatchObject({
                clientId: "legacy:legacy-client",
                name: "legacy-client",
                protocolVersion: 1,
                legacy: true
            });
            return true;
        }, {timeoutMs: 5000, intervalMs: 25});

        rawClient.destroy();
    });

    it("rejects legacy shared-key clients unless the server explicitly opts in", async () => {
        await startServer({
            trustedClients: []
        });

        const rawClient = new RawControlClient("127.0.0.1", serverPort);
        await rawClient.waitUntilConnected();
        rawClient.send(CtrlPacket.createSyncCtrl());
        const syncAck = await rawClient.readPacket();
        rawClient.send(CtrlPacket.createAckCtrl(syncAck.ID, "legacy-client", DEFAULT_KEY));

        await rawClient.waitForClose();
        expect(server.clientStatus()).toHaveLength(0);
    });

    it("rejects mismatched data channel binding tokens", async () => {
        echoServer = await startEchoServer();
        const tunnelForwardPort = await getFreePort();
        await startServer({
            tunnelingOptions: [{
                forwardPort: tunnelForwardPort,
                protocol: "tcp",
                destinationAddress: "127.0.0.1",
                destinationPort: echoServer.port,
                allowedClientIds: ["client-a"],
                tls: false,
                keepAlive: 0
            }]
        });

        const rawClient = new RawControlClient("127.0.0.1", serverPort);
        await rawClient.waitUntilConnected();
        const syncAck = await completeV2Handshake(rawClient, {
            clientId: "client-a",
            clientSecret: "client-secret-a",
            displayName: "Client A"
        });

        const externalSocket = net.createConnection({host: "127.0.0.1", port: tunnelForwardPort});
        await new Promise<void>((resolve, reject) => {
            externalSocket.once("connect", () => resolve());
            externalSocket.once("error", reject);
        });

        const newDataHandlerPacket = await waitFor(async () => {
            const packet = await rawClient.readPacket();
            if(packet.cmd !== CtrlCmd.NewDataHandler) {
                throw new Error(`expected NewDataHandler but received ${CtrlCmd[packet.cmd]}`);
            }
            return packet;
        }, {timeoutMs: 5000, intervalMs: 25});

        const spoofedDataSocket = net.createConnection({host: "127.0.0.1", port: serverPort});
        await new Promise<void>((resolve, reject) => {
            spoofedDataSocket.once("connect", () => resolve());
            spoofedDataSocket.once("error", reject);
        });
        spoofedDataSocket.write(DataStatePacket.create(syncAck.ID, newDataHandlerPacket.ID, newDataHandlerPacket.sessionID, "wrong-binding-token").toBuffer());

        const failPacket = await waitFor(async () => {
            const packet = await rawClient.readPacket();
            if(packet.cmd !== CtrlCmd.FailOfOpenSession) {
                throw new Error(`expected FailOfOpenSession but received ${CtrlCmd[packet.cmd]}`);
            }
            return packet;
        }, {timeoutMs: 5000, intervalMs: 25});

        expect(failPacket.sessionID).toBe(newDataHandlerPacket.sessionID);
        spoofedDataSocket.destroy();
        externalSocket.destroy();
        rawClient.destroy();
    });

    it("keeps protocol v2 sessions alive when control and data handler IDs exceed 16-bit", async () => {
        const originalSocketLastId = (SocketHandler as any).LAST_ID;
        const originalDataHandlerLastId = (ClientHandlerPool as any).LAST_DATA_HANDLER_ID;
        (SocketHandler as any).LAST_ID = 70000;
        (ClientHandlerPool as any).LAST_DATA_HANDLER_ID = 70000;
        echoServer = await startEchoServer();
        const tunnelForwardPort = await getFreePort();
        await startServer({
            tunnelingOptions: [{
                forwardPort: tunnelForwardPort,
                protocol: "tcp",
                destinationAddress: "127.0.0.1",
                destinationPort: echoServer.port,
                allowedClientIds: ["client-a"],
                tls: false,
                keepAlive: 0
            }]
        });

        try {
            const rawClient = new RawControlClient("127.0.0.1", serverPort);
            await rawClient.waitUntilConnected();
            const syncAck = await completeV2Handshake(rawClient, {
                clientId: "client-a",
                clientSecret: "client-secret-a",
                displayName: "Client A"
            });
            const controlID = syncAck.syncCtrlAckMeta?.controlID ?? syncAck.ID;

            const externalSocket = net.createConnection({host: "127.0.0.1", port: tunnelForwardPort});
            await new Promise<void>((resolve, reject) => {
                externalSocket.once("connect", () => resolve());
                externalSocket.once("error", reject);
            });
            externalSocket.write(Buffer.from("wide-id-echo", "utf-8"));

            const newHandlerPacket = await waitFor(async () => {
                const packet = await rawClient.readPacket();
                if(packet.cmd !== CtrlCmd.NewDataHandler) {
                    throw new Error(`expected NewDataHandler but received ${CtrlCmd[packet.cmd]}`);
                }
                return packet;
            }, {timeoutMs: 5000, intervalMs: 25});

            expect((newHandlerPacket.newDataHandlerMeta?.handlerID ?? 0)).toBeGreaterThan(65535);

            const dataSocket = net.createConnection({host: "127.0.0.1", port: serverPort});
            await new Promise<void>((resolve, reject) => {
                dataSocket.once("connect", () => resolve());
                dataSocket.once("error", reject);
            });
            dataSocket.write(DataStatePacket.create(
                controlID,
                newHandlerPacket.newDataHandlerMeta?.handlerID ?? 0,
                newHandlerPacket.sessionID,
                newHandlerPacket.newDataHandlerMeta?.bindingToken
            ).toBuffer());

            const openPacket = await waitFor(async () => {
                const packet = await rawClient.readPacket();
                if(packet.cmd !== CtrlCmd.OpenSession) {
                    throw new Error(`expected OpenSession but received ${CtrlCmd[packet.cmd]}`);
                }
                return packet;
            }, {timeoutMs: 5000, intervalMs: 25});

            expect(openPacket.sessionID).toBe(newHandlerPacket.sessionID);

            dataSocket.destroy();
            externalSocket.destroy();
            rawClient.destroy();
        } finally {
            (SocketHandler as any).LAST_ID = originalSocketLastId;
            (ClientHandlerPool as any).LAST_DATA_HANDLER_ID = originalDataHandlerLastId;
        }
    });
});
