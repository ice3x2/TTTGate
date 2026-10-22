import net from "net";
import {ExternalPortServerPool} from "../../../src/server/ExternalPortServerPool";
import {AdmissionController} from "../../../src/server/security/AdmissionController";
import SocketState from "../../../src/util/SocketState";
import {getFreePort, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

// U5-09 / #124 — 실제 풀에서 그룹 대역폭 버킷(1 MiB/s)이 양방향 전송을 늦춘다.
jest.setTimeout(30_000);

const MiB = 1_048_576;
const CHUNK = 64 * 1024;

const chunkOf = (i: number): Buffer => Buffer.alloc(CHUNK, i % 256);

type Client = {socket: net.Socket; chunks: Buffer[]; received: () => number; lastReceivedAt: () => number; ended: Promise<void>; closed: Promise<void>};

const connectClient = (port: number): Client => {
    const socket = net.connect({host: "127.0.0.1", port});
    const chunks: Buffer[] = [];
    let total = 0;
    let lastAt = 0;
    socket.on("data", (chunk) => { chunks.push(Buffer.from(chunk)); total += chunk.length; lastAt = Date.now(); });
    socket.once("error", () => { /* forced close raises ECONNRESET */ });
    return {
        socket, chunks, received: () => total, lastReceivedAt: () => lastAt,
        ended: new Promise((resolve) => socket.once("end", () => resolve())),
        closed: new Promise((resolve) => socket.once("close", () => resolve()))
    };
};

describe("bandwidth-send-queue", () => {
    let testRoot: TestRoot;
    let pool: ExternalPortServerPool;
    let sessionIds: number[];
    let receivedFromClient: Array<{at: number; length: number}>;

    const startTunnel = async (bufferLimitOnServer?: number): Promise<number> => {
        const forwardPort = await getFreePort();
        await expect(pool.startServer({forwardPort, protocol: "tcp" as const, destinationAddress: "127.0.0.1",
            destinationPort: 18080, keepAlive: 0, ...(bufferLimitOnServer !== undefined ? {bufferLimitOnServer} : {})})).resolves.toBe(true);
        return forwardPort;
    };

    const openSession = async (port: number): Promise<{client: Client; id: number}> => {
        const before = sessionIds.length;
        const client = connectClient(port);
        await waitFor(() => { if(sessionIds.length <= before) throw new Error("waiting for session"); }, {timeoutMs: 2000});
        return {client, id: sessionIds[sessionIds.length - 1]};
    };

    beforeEach(async () => {
        testRoot = await createTestRoot("bandwidth-send-queue");
        applyTestRoot(testRoot.rootDir);
        AdmissionController.resetForTest();
        pool = ExternalPortServerPool.create([]);
        sessionIds = [];
        receivedFromClient = [];
        pool.OnNewSessionCallback = (sessionID: number) => { sessionIds.push(sessionID); };
        pool.OnHandlerEventCallback = (_id: number, state: SocketState, data?: any) => {
            if(state === SocketState.Receive && data?.data) receivedFromClient.push({at: Date.now(), length: data.data.length});
        };
        pool.OnTerminateSessionCallback = () => undefined;
        pool.BandwidthPolicy = () => ({groupId: "g", bytesPerSecond: MiB});
    });

    afterEach(async () => {
        await pool.stopAll();
        AdmissionController.resetForTest();
        await cleanupTestRoot(testRoot);
    });

    it("클라이언트→외부 3 MiB 는 순서대로 2.7~3.3초에 걸쳐 도착하고, closeSession 은 다 보낸 뒤에야 끝낸다", async () => {
        const port = await startTunnel();
        const {client, id} = await openSession(port);

        const startedAt = Date.now();
        const results: boolean[] = [];
        for(let i = 0; i < 48; i++) results.push(pool.send(id, chunkOf(i)));
        expect(results.every((ok) => ok)).toBe(true);
        pool.closeSession(id, 48 * CHUNK);

        // 시간은 첫 send 부터 마지막 바이트 수신까지다. 종료(end)는 그 뒤 기존 종료 경로가 처리한다.
        await waitFor(() => { if(client.received() < 3 * MiB) throw new Error(`waiting for 3 MiB (got ${client.received()})`); }, {timeoutMs: 10_000});
        const elapsed = client.lastReceivedAt() - startedAt;
        await client.ended;
        expect(client.received()).toBe(3 * MiB);
        const all = Buffer.concat(client.chunks);
        for(let i = 0; i < 48; i++) {
            expect({i, first: all[i * CHUNK], last: all[(i + 1) * CHUNK - 1]}).toEqual({i, first: i % 256, last: i % 256});
        }
        expect(elapsed).toBeGreaterThanOrEqual(2700);
        expect(elapsed).toBeLessThanOrEqual(3300);
    });

    it("큐가 bufferLimitOnServer 를 넘으면 그 뒤 send 는 false 이고 세션을 닫는다", async () => {
        const port = await startTunnel(1);
        const {client, id} = await openSession(port);
        const results: boolean[] = [];
        for(let i = 0; i < 40; i++) results.push(pool.send(id, chunkOf(i)));
        const firstFalse = results.indexOf(false);
        expect(firstFalse).toBeGreaterThan(0);
        expect(results.slice(firstFalse).every((ok) => !ok)).toBe(true);
        // 버킷이 비어서 시작하므로 첫 청크부터 큐에 들어간다. 1 MiB 상한이라 16 청크까지 담기고 17 번째(인덱스 16)에서 넘친다.
        expect(firstFalse).toBe(16);
        await client.closed;
        await waitFor(() => { if(pool.getServerStatus(port).sessions !== 0) throw new Error("waiting for 0 sessions"); }, {timeoutMs: 2000});
    });

    it("외부→클라이언트 2 MiB 는 pauseRead 로 1.7초 이상에 걸쳐 들어온다", async () => {
        const port = await startTunnel();
        const {client} = await openSession(port);
        client.socket.write(Buffer.alloc(2 * MiB, 7));
        await waitFor(() => {
            const total = receivedFromClient.reduce((sum, entry) => sum + entry.length, 0);
            if(total < 2 * MiB) throw new Error(`waiting for 2 MiB (got ${total})`);
        }, {timeoutMs: 10_000});
        expect(receivedFromClient.reduce((sum, entry) => sum + entry.length, 0)).toBe(2 * MiB);
        const span = receivedFromClient[receivedFromClient.length - 1].at - receivedFromClient[0].at;
        expect(span).toBeGreaterThanOrEqual(1700);
        client.socket.destroy();
    });

    it("백프레셔를 지키는 생산자는 큐 상한보다 큰 전송도 끊기지 않고 순서대로 보낸다", async () => {
        const port = await startTunnel(1);
        const {client, id} = await openSession(port);
        let paused = 0;
        for(let i = 0; i < 48; i++) {
            // TTTServer 가 하듯이 배압이면 해소될 때까지 기다린다.
            if(pool.isSessionBackpressured(id)) {
                paused++;
                await new Promise<void>((resolve) => pool.addSessionPressureReliefListener(id, resolve));
            }
            expect({i, ok: pool.send(id, chunkOf(i))}).toEqual({i, ok: true});
        }
        await waitFor(() => { if(client.received() < 3 * MiB) throw new Error(`waiting for 3 MiB (got ${client.received()})`); }, {timeoutMs: 10_000});
        expect(paused).toBeGreaterThan(0);
        const all = Buffer.concat(client.chunks);
        for(let i = 0; i < 48; i++) expect({i, first: all[i * CHUNK]}).toEqual({i, first: i % 256});
        expect(pool.getServerStatus(port).sessions).toBe(1);
        client.socket.destroy();
    });

    it("전송 중 정책이 사라져도 이미 큐에 있는 청크가 먼저 나간다", async () => {
        const port = await startTunnel();
        const {client, id} = await openSession(port);
        for(let i = 0; i < 4; i++) expect(pool.send(id, chunkOf(i))).toBe(true);
        pool.BandwidthPolicy = null;
        for(let i = 4; i < 8; i++) expect(pool.send(id, chunkOf(i))).toBe(true);
        await waitFor(() => { if(client.received() < 8 * CHUNK) throw new Error("waiting for 8 chunks"); }, {timeoutMs: 5_000});
        const all = Buffer.concat(client.chunks);
        expect(Array.from({length: 8}, (_, i) => all[i * CHUNK])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        client.socket.destroy();
    });

    it("세션이 끝나면 대기 중인 큐와 타이머를 지운다", async () => {
        const port = await startTunnel();
        const {client, id} = await openSession(port);
        for(let i = 0; i < 8; i++) expect(pool.send(id, chunkOf(i))).toBe(true);
        expect((pool as any)._sendQueues.size).toBe(1);
        client.socket.destroy();
        await waitFor(() => { if(pool.getServerStatus(port).sessions !== 0) throw new Error("waiting for 0 sessions"); }, {timeoutMs: 2000});
        expect((pool as any)._sendQueues.size).toBe(0);
        expect(pool.send(id, chunkOf(9))).toBe(false);
    });

    it("정책이 없으면 큐 없이 바로 쓴다", async () => {
        pool.BandwidthPolicy = null;
        const port = await startTunnel();
        const {client, id} = await openSession(port);
        const startedAt = Date.now();
        for(let i = 0; i < 48; i++) expect(pool.send(id, chunkOf(i))).toBe(true);
        await waitFor(() => { if(client.received() < 3 * MiB) throw new Error("waiting for 3 MiB"); }, {timeoutMs: 5_000});
        expect(client.lastReceivedAt() - startedAt).toBeLessThan(1500);
    });
});
