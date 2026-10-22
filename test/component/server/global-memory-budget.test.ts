import net from "net";
import {EventEmitter} from "events";
import {ExternalPortServerPool} from "../../../src/server/ExternalPortServerPool";
import {ClientHandlerPool} from "../../../src/server/ClientHandlerPool";
import {AdmissionController} from "../../../src/server/security/AdmissionController";
import {ResourcePolicyRegistry} from "../../../src/util/ResourcePolicy";
import {SocketHandler} from "../../../src/util/SocketHandler";
import SocketState from "../../../src/util/SocketState";
import {getFreePort, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

// #183 — 운영 서버의 메모리는 512MB 다. 세션별 상한만 있으면 세션 수만큼 곱해져 메모리를 넘는다.
// 대역폭 큐와 열리는 중인 세션의 대기열은 프로세스 전체 예산으로도 묶는다. 예산에 가까워지면 데이터를 버리지 않고 원천 읽기를 멈춘다.
jest.setTimeout(30_000);
const MiB = 1_048_576;

describe("global bandwidth queue budget (#183)", () => {
    let testRoot: TestRoot;
    let pool: ExternalPortServerPool;
    let sessionIds: number[];
    const sockets: net.Socket[] = [];

    beforeEach(async () => {
        testRoot = await createTestRoot("global-memory-budget");
        applyTestRoot(testRoot.rootDir);
        AdmissionController.resetForTest();
        pool = ExternalPortServerPool.create([]);
        sessionIds = [];
        pool.OnNewSessionCallback = (sessionID: number) => { sessionIds.push(sessionID); };
        pool.OnHandlerEventCallback = () => undefined;
        pool.OnTerminateSessionCallback = () => undefined;
        pool.BandwidthPolicy = () => ({groupId: "g", bytesPerSecond: MiB});
    });

    afterEach(async () => {
        sockets.forEach((socket) => socket.destroy());
        sockets.length = 0;
        await pool.stopAll();
        ResourcePolicyRegistry.reset();
        AdmissionController.resetForTest();
        await cleanupTestRoot(testRoot);
    });

    const openSession = async (port: number): Promise<number> => {
        const before = sessionIds.length;
        const socket = net.connect({host: "127.0.0.1", port});
        socket.on("error", () => {});
        socket.on("data", () => {});
        sockets.push(socket);
        await waitFor(() => { if(sessionIds.length <= before) throw new Error("waiting for session"); }, {timeoutMs: 5000});
        return sessionIds[sessionIds.length - 1];
    };

    it("pauses the queued sessions while the queues together reach the global high watermark, then resumes them", async () => {
        ResourcePolicyRegistry.configure({globalBandwidthQueueLimitBytes: 2 * MiB});
        const port = await getFreePort();
        await expect(pool.startServer({forwardPort: port, protocol: "tcp" as const, destinationAddress: "127.0.0.1",
            destinationPort: 18080, keepAlive: 0, bufferLimitOnServer: 8})).resolves.toBe(true);
        const first = await openSession(port);
        const second = await openSession(port);
        // 세션별 상단(8MiB 의 75% = 6MiB)에는 한참 못 미치지만 합이 전체 예산의 75%(1.5MiB)를 넘는다.
        for(let i = 0; i < 48; i++) expect(pool.send(first, Buffer.alloc(64 * 1024, i))).toBe(true);
        // 그룹 버킷이 비었으므로 두 번째 세션의 데이터도 큐에 들어간다.
        expect(pool.send(second, Buffer.alloc(1024, 1))).toBe(true);
        expect(pool.isSessionBackpressured(first)).toBe(true);
        expect(pool.isSessionBackpressured(second)).toBe(true);
        let relieved = false;
        pool.addSessionPressureReliefListener(second, () => { relieved = true; });
        await waitFor(() => { if(!relieved) throw new Error("waiting for relief"); }, {timeoutMs: 10_000});
        expect(pool.isSessionBackpressured(second)).toBe(false);
    });

    it("does not pause a session without its own queue, so one slow group cannot stall the others", async () => {
        ResourcePolicyRegistry.configure({globalBandwidthQueueLimitBytes: 2 * MiB});
        const port = await getFreePort();
        await expect(pool.startServer({forwardPort: port, protocol: "tcp" as const, destinationAddress: "127.0.0.1",
            destinationPort: 18080, keepAlive: 0, bufferLimitOnServer: 8})).resolves.toBe(true);
        const busy = await openSession(port);
        const idle = await openSession(port);
        for(let i = 0; i < 48; i++) pool.send(busy, Buffer.alloc(64 * 1024, i));
        expect(pool.isSessionBackpressured(busy)).toBe(true);
        expect(pool.isSessionBackpressured(idle)).toBe(false);
    });
});

class FastWritableSocket extends EventEmitter {
    public remoteAddress = "127.0.0.1";
    public remotePort = 5001;
    public localAddress = "127.0.0.1";
    public setNoDelay(): this { return this; }
    public setKeepAlive(): this { return this; }
    public setTimeout(): this { return this; }
    public pause(): this { return this; }
    public resume(): this { return this; }
    public write(_buffer: Buffer, callback?: (error?: Error | null) => void): boolean { callback?.(null); return true; }
    public end(): this { this.emit("end"); this.emit("close"); return this; }
    public destroy(): this { this.emit("close"); return this; }
}

describe("global waiting queue budget across clients (#183)", () => {
    let testRoot: TestRoot;
    beforeEach(async () => { testRoot = await createTestRoot("global-waiting-budget"); applyTestRoot(testRoot.rootDir); });
    afterEach(async () => { ResourcePolicyRegistry.reset(); await cleanupTestRoot(testRoot); });

    const poolWithWaitingSession = (id: number, sessionID: number) => {
        const control = SocketHandler.bound({socket: new FastWritableSocket() as any, port: 9126 + id, addr: "127.0.0.1", tls: false, keepAlive: 0}, () => {});
        const pool = ClientHandlerPool.create(id, control);
        const onSessionClose = jest.fn();
        pool.onSessionCloseCallback = onSessionClose;
        // 세션 한도는 없음(-1, 이전 버전 클라이언트 버퍼 기본값)이라 세션별로는 압력이 생기지 않는다.
        pool.sendConnectEndPoint(sessionID, {host: "127.0.0.1", port: 8080, tls: false, bufferLimit: -1});
        return {pool, onSessionClose};
    };

    it("pauses a client's sources at its own pool high watermark before the pool limit closes sessions", () => {
        ResourcePolicyRegistry.configure({defaultPoolQueueLimitBytes: MiB, globalPoolQueueLimitBytes: 64 * MiB});
        const control = SocketHandler.bound({socket: new FastWritableSocket() as any, port: 9200, addr: "127.0.0.1", tls: false, keepAlive: 0}, () => {});
        const pool = ClientHandlerPool.create(50, control);
        pool.onSessionCloseCallback = jest.fn();
        pool.sendConnectEndPoint(5000, {host: "127.0.0.1", port: 8080, tls: false, bufferLimit: -1});
        pool.sendConnectEndPoint(5001, {host: "127.0.0.1", port: 8080, tls: false, bufferLimit: -1});
        try {
            expect(pool.sendBuffer(5000, Buffer.alloc(800 * 1024))).toBe(true);
            expect(pool.isSessionBackpressured(5001)).toBe(true);
        } finally {
            pool.end();
        }
        expect(ClientHandlerPool.globalWaitingQueueBytes).toBe(0);
    });

    it("pauses sources at the global high watermark and closes the session that would exceed the global limit", () => {
        ResourcePolicyRegistry.configure({globalPoolQueueLimitBytes: MiB, defaultPoolQueueLimitBytes: 64 * MiB});
        const a = poolWithWaitingSession(41, 4100);
        const b = poolWithWaitingSession(42, 4200);
        try {
            expect(a.pool.sendBuffer(4100, Buffer.alloc(800 * 1024))).toBe(true);
            // 다른 클라이언트의 대기열이 전체 예산의 75% 를 넘었으므로 b 도 원천 읽기를 멈춘다.
            expect(b.pool.isSessionBackpressured(4200)).toBe(true);
            expect(b.pool.sendBuffer(4200, Buffer.alloc(300 * 1024))).toBe(false);
            expect(b.onSessionClose).toHaveBeenCalledWith(4200, 0);
            expect(a.onSessionClose).not.toHaveBeenCalled();
        } finally {
            a.pool.end();
            b.pool.end();
        }
        // 풀이 끝나면 예산에서 빠진다.
        expect(ClientHandlerPool.globalWaitingQueueBytes).toBe(0);
    });
});
