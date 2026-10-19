import net from "net";
import TTTServer from "../../../src/server/TTTServer";
import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {TunnelHandshakePolicyRegistry} from "../../../src/server/TunnelHandshakePolicy";
import {CtrlPacket} from "../../../src/commons/CtrlPacket";
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

    // #157 — 기한이 유휴 시간이면 주기적으로 바이트를 보내는 미인증 연결이 슬롯을 영원히 차지한다. 바인드 시각 기준으로 닫는다.
    it("closes an unauthenticated socket at the absolute deadline even while it keeps sending SyncCtrl", async () => {
        const socket = net.createConnection({host: "127.0.0.1", port: serverPort});
        await waitForConnect(socket);
        socket.on("error", () => {});
        const sync = CtrlPacket.createSyncCtrl().toBuffer();
        const drip = setInterval(() => { if(!socket.destroyed) socket.write(sync); }, 40);
        try {
            await waitFor(() => {
                if(!socket.destroyed) throw new Error("unauthenticated socket outlived the handshake deadline");
                return true;
            }, {timeoutMs: 1500, intervalMs: 25});
        } finally {
            clearInterval(drip);
            socket.destroy();
        }
    });

    // #157 — 한 주소가 미인증 슬롯을 모두 차지하지 못하게 주소별 상한을 둔다.
    it("caps unauthenticated connections per remote address below the global cap", async () => {
        TunnelHandshakePolicyRegistry.configure({timeoutMs: 2000, maxUnauthenticatedConnections: 10, maxUnauthenticatedPerAddress: 2} as any);
        const sockets: net.Socket[] = [];
        try {
            for(let i = 0; i < 3; i += 1) {
                const socket = net.createConnection({host: "127.0.0.1", port: serverPort});
                socket.on("error", () => {});
                await waitForConnect(socket);
                sockets.push(socket);
            }
            await waitFor(() => {
                if(!sockets[2].destroyed) throw new Error("third unauthenticated socket from the same address was not rejected");
                return true;
            }, {timeoutMs: 1000, intervalMs: 25});
            expect(sockets[0].destroyed || sockets[1].destroyed).toBe(false);
        } finally {
            sockets.forEach((socket) => socket.destroy());
            TunnelHandshakePolicyRegistry.reset();
        }
    });

    // #157 — 데이터 연결은 첫 바이트로 구분되는 순간 제어 예산에서 빠진다. 미인증 제어 연결이 슬롯을 채워도 데이터 연결은 받는다.
    it("moves data connections out of the control budget once their first byte arrives", async () => {
        TunnelHandshakePolicyRegistry.configure({timeoutMs: 2000, maxUnauthenticatedConnections: 2, maxUnauthenticatedPerAddress: 2} as any);
        const sockets: net.Socket[] = [];
        try {
            const open = async (): Promise<net.Socket> => {
                const socket = net.createConnection({host: "127.0.0.1", port: serverPort});
                socket.on("error", () => {});
                await waitForConnect(socket);
                sockets.push(socket);
                return socket;
            };
            const dataLike = await open();
            dataLike.write(Buffer.from("D"));
            await new Promise((resolve) => setTimeout(resolve, 100));
            const control1 = await open();
            const control2 = await open();
            await new Promise((resolve) => setTimeout(resolve, 150));
            expect([dataLike.destroyed, control1.destroyed, control2.destroyed]).toEqual([false, false, false]);
        } finally {
            sockets.forEach((socket) => socket.destroy());
            TunnelHandshakePolicyRegistry.reset();
        }
    });

    it("closes an unauthenticated control connection on a framing error", async () => {
        TunnelHandshakePolicyRegistry.configure({timeoutMs: 5000} as any);
        const socket = net.createConnection({host: "127.0.0.1", port: serverPort});
        socket.on("error", () => {});
        await waitForConnect(socket);
        try {
            const sync = CtrlPacket.createSyncCtrl().toBuffer();
            const broken = Buffer.from(sync);
            broken.writeUInt32BE(0xffffffff, broken.length - 4);
            socket.write(Buffer.concat([sync.subarray(0, 1), Buffer.alloc(16, 0xff)]));
            await waitFor(() => {
                if(!socket.destroyed && socket.readable) throw new Error("framing error did not close the socket");
                return true;
            }, {timeoutMs: 1500, intervalMs: 25});
        } finally {
            socket.destroy();
            TunnelHandshakePolicyRegistry.reset();
        }
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
