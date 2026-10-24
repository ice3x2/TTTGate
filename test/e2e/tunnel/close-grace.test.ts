import http from "http";
import net from "net";
import {once} from "events";
import {createTunnelHarness, TunnelHarness} from "../../helpers/tunnelHarness";
import {SocketHandler} from "../../../src/util/SocketHandler";

jest.setTimeout(120_000);

const GRACE = 500;
const STALL = 1_500;
const MiB = 1048576;

const waitFor = async (check: () => boolean, timeoutMs: number): Promise<boolean> => {
    const until = Date.now() + timeoutMs;
    while(Date.now() < until) {
        if(check()) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return check();
};

/** 서버·클라이언트에 남은 세션 수. 모두 0 이면 세션 전체가 정리된 것이다. */
const leftovers = (harness: TunnelHarness) => {
    const server: any = harness.getServer();
    const tunnelServer = server?._tunnelServer;
    const pools: any[] = tunnelServer ? Array.from(tunnelServer._clientHandlerPoolMap.values()) : [];
    const clientPool: any = (harness.getClient() as any)?._endPointClientPool;
    return {
        serverSessions: server?._sessions?.size ?? -1,
        sessionRoutes: tunnelServer?._sessionIDAndCtrlIDMap?.size ?? -1,
        poolSessions: pools.reduce((sum, pool) => sum + pool._activatedSessionHandlerMap_.size, 0),
        externalHandlers: server?._externalPortServerPool?._handlerMap?.size ?? -1,
        clientEndpoints: clientPool?._endPointClientMap?.size ?? -1,
    };
};
const CLEAN = {serverSessions: 0, sessionRoutes: 0, poolSessions: 0, externalHandlers: 0, clientEndpoints: 0};

/** 받은 것은 읽지만 FIN 을 받아도 답하지 않는 외부 사용자. */
const stubbornPeer = async (port: number): Promise<net.Socket> => {
    const socket = net.connect({port, host: "127.0.0.1", allowHalfOpen: true});
    socket.on("error", () => {});
    socket.on("data", () => {});
    socket.on("end", () => {});
    await once(socket, "connect");
    return socket;
};

// #248 — 닫기를 시작한 연결은 상대가 닫지 않아도 닫기 유예 시간 뒤 세션 전체가 정리된다.
describe("sessions whose close never completes are cleaned up after the close grace (#248)", () => {
    let harness: TunnelHarness | undefined;
    let destination: net.Server | undefined;
    const sockets = new Set<net.Socket>();
    let previous: {grace: number, stall: number};

    beforeEach(() => { previous = {grace: SocketHandler.closeGraceMs, stall: SocketHandler.closeStallMs}; });
    afterEach(async () => {
        SocketHandler.closeGraceMs = previous.grace;
        SocketHandler.closeStallMs = previous.stall;
        sockets.forEach((socket) => socket.destroy());
        sockets.clear();
        await harness?.dispose();
        if(destination) {
            (destination as http.Server).closeAllConnections?.();
            await new Promise<void>((resolve) => destination!.close(() => resolve()));
        }
        harness = undefined; destination = undefined;
    });

    const start = async (server: net.Server, tunnel: object = {}) => {
        destination = server;
        server.on("connection", (socket: net.Socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const port = (server.address() as net.AddressInfo).port;
        harness = await createTunnelHarness({clients: [{clientId: "close-grace", clientSecret: "close-grace-secret",
            endpointFactory: async () => ({port, close: async () => {}}), tunnelingOptionOverride: tunnel as any}]});
        SocketHandler.closeGraceMs = GRACE;
        SocketHandler.closeStallMs = STALL;
        await harness.start();
        return harness;
    };

    // AC-1 (S5) — 400 응답과 FIN 뒤 닫지 않는 외부 연결
    test("AC-1 connections answered with 400 whose peers never close are cleaned up", async () => {
        const h = await start(http.createServer((_req, res) => res.end("ok")), {protocol: "http"});
        const peers = await Promise.all(Array.from({length: 5}, () => stubbornPeer(h.forwardPort)));
        peers.forEach((peer) => { sockets.add(peer); peer.write("GET / HTTP/1.1\r\nHost: a.example\r\nHost: b.example\r\n\r\n"); });
        expect(await waitFor(() => peers.every((peer) => peer.readableEnded), 5_000)).toBe(true);
        expect(await waitFor(() => JSON.stringify(leftovers(h)) === JSON.stringify(CLEAN), GRACE + 5_000)).toBe(true);
        expect(leftovers(h)).toEqual(CLEAN);
    });

    // AC-2 (C2) — keep-alive 타임아웃 뒤 응답을 읽지 않고 닫지도 않는 외부 연결
    test("AC-2 a keep-alive connection whose peer stops reading is cleaned up after the idle timeout and the grace", async () => {
        const big = Buffer.alloc(32 * MiB, "y");
        const h = await start(http.createServer((_req, res) => { res.writeHead(200, {"content-length": big.length}); res.end(big); }),
            {protocol: "http", httpOption: {keepAliveTimeout: 1}});
        const peer = await stubbornPeer(h.forwardPort);
        sockets.add(peer);
        peer.write("GET /big HTTP/1.1\r\nHost: a.example\r\nConnection: keep-alive\r\n\r\n");
        await once(peer, "data");
        peer.pause();
        expect(await waitFor(() => JSON.stringify(leftovers(h)) === JSON.stringify(CLEAN), 1_000 + STALL + 8_000)).toBe(true);
        expect(SocketHandler.globalFileCacheSize).toBe(0);
    });

    // AC-3 (C1) — FIN 을 무시하고 계속 보내는 목적지
    test("AC-3 endpoints whose destination ignores FIN are cleaned up on the client", async () => {
        const h = await start(net.createServer({allowHalfOpen: true}, (socket) => {
            socket.on("error", () => {});
            const timer = setInterval(() => { if(!socket.destroyed) socket.write("x"); }, 100);
            socket.on("close", () => clearInterval(timer));
        }));
        for(let n = 0; n < 10; n++) {
            const external = net.connect(h.forwardPort, "127.0.0.1");
            external.on("error", () => {});
            await once(external, "data");
            external.destroy();
        }
        expect(await waitFor(() => JSON.stringify(leftovers(h)) === JSON.stringify(CLEAN), GRACE + 8_000)).toBe(true);
        expect(await waitFor(() => sockets.size === 0, 3_000)).toBe(true);
    });

    // AC-3 — FIN 에 답하지 않는 평범한 WebSocket 서버(http.Server 'upgrade')
    test("AC-3 WebSocket upgrades to a server that does not answer FIN leave no client endpoints", async () => {
        const upgrade = http.createServer();
        upgrade.on("upgrade", (_req, socket: net.Socket) => {
            socket.on("error", () => {});
            socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
        });
        const h = await start(upgrade, {protocol: "http"});
        for(let n = 0; n < 100; n++) {
            const external = net.connect(h.forwardPort, "127.0.0.1");
            external.on("error", () => {});
            external.write("GET /ws HTTP/1.1\r\nHost: a.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
            await once(external, "data");
            external.destroy();
        }
        expect(await waitFor(() => JSON.stringify(leftovers(h)) === JSON.stringify(CLEAN), GRACE + 8_000)).toBe(true);
    });
});
