import net from "net";
import TTTServer from "../../../src/server/TTTServer";
import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {TunnelHandshakePolicyRegistry} from "../../../src/server/TunnelHandshakePolicy";
import {CtrlPacket} from "../../../src/commons/CtrlPacket";
import {DEFAULT_KEY, ServerOption} from "../../../src/types/TunnelingOption";
import {getFreePort} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";
import LoggerFactory from "../../../src/util/logger/LoggerFactory";

jest.setTimeout(60_000);

/** SyncCtrl 을 보내고 SyncCtrlAck 를 받을 때까지 기다린다. */
const syncAndAwaitAck = (port: number): Promise<net.Socket> => new Promise((resolve, reject) => {
    const socket = net.createConnection({host: "127.0.0.1", port});
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("no SyncCtrlAck within 5s")); }, 5_000);
    socket.on("error", () => {});
    socket.once("connect", () => socket.write(CtrlPacket.createSyncCtrl().toBuffer()));
    socket.once("data", () => { clearTimeout(timer); resolve(socket); });
});

const waitFor = async (check: () => boolean, timeoutMs: number): Promise<boolean> => {
    const until = Date.now() + timeoutMs;
    while(Date.now() < until) {
        if(check()) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return check();
};

// #247 — 핸드셰이크를 마치지 못하고 닫힌 제어 연결의 대기 항목이 남지 않는다.
describe("pending control handshakes are released when the connection closes (#247)", () => {
    let testRoot: TestRoot;
    let server: TTTServer | undefined;
    let port: number;
    const sockets: net.Socket[] = [];

    beforeEach(async () => {
        testRoot = await createTestRoot("pending-handshake-cleanup");
        applyTestRoot(testRoot.rootDir);
        TunnelHandshakePolicyRegistry.configure({timeoutMs: 1_500, maxUnauthenticatedConnections: 1000, maxUnauthenticatedPerAddress: 1000} as any);
        await CertificationStore.instance.load();
        port = await getFreePort();
        const option: ServerOption = {key: DEFAULT_KEY, adminPort: 9300, adminBindHost: "127.0.0.1", adminTls: true, port, tls: false,
            tunnelingOptions: [], keepAlive: 0, globalMemCacheLimit: 128};
        ServerOptionStore.instance.updateServerOption(option);
        server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();
    });
    afterEach(async () => {
        sockets.splice(0).forEach((socket) => socket.destroy());
        await server?.close();
        server = undefined;
        TunnelHandshakePolicyRegistry.reset();
        await cleanupTestRoot(testRoot);
    });

    const pendingCount = (): number => ((server as any)._tunnelServer._pendingControlHandshakeMap as Map<number, unknown>).size;

    // REQ-1 / AC-1
    test("a connection that closes after receiving SyncCtrlAck leaves no pending handshake", async () => {
        for(let n = 0; n < 50; n++) {
            const socket = await syncAndAwaitAck(port);
            socket.destroy();
        }
        expect(await waitFor(() => pendingCount() === 0, 3_000)).toBe(true);
    });

    // REQ-1 / AC-2 — 연결 20개를 동시에 열어 기한(1.5초) 안에 모두 대기 항목이 생긴 것을 본 뒤, 기한 경로로 닫히기를 기다린다.
    test("a connection closed by the server at the handshake deadline leaves no pending handshake", async () => {
        const warn = jest.spyOn(LoggerFactory.getLogger("server", "TunnelServer"), "warn");
        try {
            sockets.push(...await Promise.all(Array.from({length: 20}, () => syncAndAwaitAck(port))));
            expect(pendingCount()).toBe(20);
            expect(await waitFor(() => sockets.every((socket) => socket.destroyed || socket.readableEnded), 6_000)).toBe(true);
            expect(await waitFor(() => pendingCount() === 0, 3_000)).toBe(true);
            const deadlineCloses = warn.mock.calls.filter((call) => String(call[0]).startsWith("Closing unauthenticated connection at the handshake deadline"));
            expect(deadlineCloses.length).toBe(20);
        } finally { warn.mockRestore(); }
    });

    // REQ-1 — 한 번에 온 패킷 묶음 안에서 연결이 닫혀도, 뒤따르는 SyncCtrl 이 대기 항목을 다시 만들지 않는다.
    test("SyncCtrl packets that follow a close within the same chunk do not recreate a pending handshake", async () => {
        const chunk = Buffer.concat([CtrlPacket.createSyncCtrl(), CtrlPacket.message(0, {type: "x", payload: "y"}),
            CtrlPacket.createSyncCtrl(), CtrlPacket.createSyncCtrl()].map((packet) => packet.toBuffer()));
        for(let n = 0; n < 20; n++) {
            await new Promise<void>((resolve) => {
                const socket = net.createConnection({host: "127.0.0.1", port});
                socket.on("error", () => {});
                socket.once("connect", () => socket.write(chunk));
                socket.once("close", () => resolve());
                setTimeout(() => socket.destroy(), 500);
            });
        }
        expect(await waitFor(() => pendingCount() === 0, 3_000)).toBe(true);
    });
});
