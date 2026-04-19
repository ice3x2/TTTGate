import net from "net";
import TTTServer from "../../../src/server/TTTServer";
import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {TunnelHandshakePolicyRegistry} from "../../../src/server/TunnelHandshakePolicy";
import {DEFAULT_KEY, ServerOption} from "../../../src/types/TunnelingOption";
import {getFreePort, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(30000);

const waitForConnect = (socket: net.Socket): Promise<void> => {
    return new Promise((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("error", reject);
    });
};

describe("TunnelServer handshake guardrails", () => {
    let testRoot: TestRoot;
    let server: TTTServer;
    let serverPort: number;

    beforeEach(async () => {
        testRoot = await createTestRoot("tunnel-handshake");
        applyTestRoot(testRoot.rootDir);
        TunnelHandshakePolicyRegistry.configure({
            timeoutMs: 150,
            maxUnauthenticatedConnections: 1
        });
        await CertificationStore.instance.load();
        serverPort = await getFreePort();
        const serverOption: ServerOption = {
            key: DEFAULT_KEY,
            adminPort: 9300,
            adminBindHost: "127.0.0.1",
            adminTls: true,
            port: serverPort,
            tls: false,
            tunnelingOptions: [],
            keepAlive: 0,
            globalMemCacheLimit: 128
        };
        ServerOptionStore.instance.updateServerOption(serverOption);
        server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();
    });

    afterEach(async () => {
        await server?.close();
        await cleanupTestRoot(testRoot);
    });

    it("closes partial handshake sockets after the configured deadline", async () => {
        const socket = net.createConnection({host: "127.0.0.1", port: serverPort});
        await waitForConnect(socket);
        socket.write(Buffer.from("C"));

        await waitFor(() => {
            if(!socket.destroyed) {
                throw new Error("partial handshake socket is still open");
            }
            return true;
        }, {timeoutMs: 3000, intervalMs: 25});
    });

    it("rejects connections above the unauthenticated cap until a slot is freed", async () => {
        const first = net.createConnection({host: "127.0.0.1", port: serverPort});
        await waitForConnect(first);
        first.write(Buffer.from("C"));

        const second = net.createConnection({host: "127.0.0.1", port: serverPort});
        await waitForConnect(second);

        await waitFor(() => {
            if(!second.destroyed) {
                throw new Error("second unauthenticated socket was not rejected");
            }
            return true;
        }, {timeoutMs: 3000, intervalMs: 25});

        await waitFor(() => {
            if(!first.destroyed) {
                throw new Error("first unauthenticated socket is still occupying the slot");
            }
            return true;
        }, {timeoutMs: 3000, intervalMs: 25});

        const third = net.createConnection({host: "127.0.0.1", port: serverPort});
        await waitForConnect(third);
        third.write(Buffer.from("C"));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(third.destroyed).toBe(false);
        third.destroy();
    });
});
