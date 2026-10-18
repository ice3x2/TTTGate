import net from "node:net";
import {once} from "node:events";
import EndPointClientPool from "../../../src/client/EndPointClientPool";
import SocketState from "../../../src/util/SocketState";
import {DEFAULT_TUNNEL_HANDSHAKE_POLICY} from "../../../src/server/TunnelHandshakePolicy";

jest.setTimeout(30_000);

// #179 — 서버는 열리는 중인 세션을 30초 뒤에 닫는다(#174). 응답 없는 엔드포인트에 대한 클라이언트의 연결 시도는
// 그보다 먼저 실패해야 클라이언트가 실패를 알리고 연결 시도를 붙잡아 두지 않는다.
const wait = async (condition: () => boolean, label: string, ms = 5_000) => {
    const deadline = Date.now() + ms;
    while(!condition()) {
        if(Date.now() > deadline) throw new Error(label);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

describe("endpoint connect timeout (#179)", () => {
    const original = EndPointClientPool.connectTimeoutMs;
    afterEach(() => { EndPointClientPool.connectTimeoutMs = original; });

    it("defaults below the server's pending-session deadline", () => {
        expect(original).toBeGreaterThan(0);
        expect(original).toBeLessThan(DEFAULT_TUNNEL_HANDSHAKE_POLICY.pendingSessionOpenTimeoutMs);
    });

    it("a TLS endpoint that never answers the handshake fails within the connect timeout", async () => {
        EndPointClientPool.connectTimeoutMs = 300;
        const peers: net.Socket[] = [];
        const silent = net.createServer((socket) => { peers.push(socket); socket.on("error", () => {}); });
        silent.listen(0, "127.0.0.1");
        await once(silent, "listening");
        const pool = new EndPointClientPool();
        const states: SocketState[] = [];
        const terminated: unknown[] = [];
        pool.onEndPointClientStateChangeCallback = (_id, state) => { states.push(state); };
        pool.onEndPointTerminateCallback = (...args: unknown[]) => { terminated.push(args); };
        try {
            const started = Date.now();
            pool.open(7, {host: "127.0.0.1", port: (silent.address() as net.AddressInfo).port, tls: true, bufferLimit: 1024});
            await wait(() => terminated.length > 0, "endpoint connect attempt was never abandoned");
            expect(Date.now() - started).toBeLessThan(3_000);
            // 핸드셰이크 전에는 Connected 를 내지 않는다. 그래야 TunnelClient 가 성공 대신 FailOfOpenSession 을 보낸다.
            expect(states).not.toContain(SocketState.Connected);
            expect(states).toContain(SocketState.Closed);
        } finally {
            pool.dispose();
            peers.forEach((socket) => socket.destroy());
            await new Promise<void>((resolve) => silent.close(() => resolve()));
        }
    });

    it("a connected endpoint is not closed when the connect timeout passes", async () => {
        EndPointClientPool.connectTimeoutMs = 200;
        const peers: net.Socket[] = [];
        const server = net.createServer((socket) => { peers.push(socket); socket.on("error", () => {}); });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const pool = new EndPointClientPool();
        const states: SocketState[] = [];
        pool.onEndPointClientStateChangeCallback = (_id, state) => { states.push(state); };
        try {
            pool.open(8, {host: "127.0.0.1", port: (server.address() as net.AddressInfo).port, tls: false, bufferLimit: 1024});
            await wait(() => states.includes(SocketState.Connected), "endpoint never connected");
            await new Promise((resolve) => setTimeout(resolve, 600));
            expect(states).toEqual([SocketState.Connected]);
        } finally {
            pool.dispose();
            peers.forEach((socket) => socket.destroy());
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
