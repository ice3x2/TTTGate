import net from "net";
import {ExternalPortServerPool} from "../../../src/server/ExternalPortServerPool";
import {AdmissionController} from "../../../src/server/security/AdmissionController";
import {ConcurrencyContext, ConcurrencyDenial, ConcurrencyLimiter} from "../../../src/server/security/ConcurrencyLimiter";
import {getFreePort, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

// U5-08 / #123 — 실제 풀에서 그룹 동시 연결 상한. tcp 터널 T 와 http 터널 H 가 같은 그룹(상한 2)이다.
jest.setTimeout(30_000);

const HTTP_503 = "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";

const connectAndCollectUntilClose = (port: number, timeoutMs: number = 1000): Promise<Buffer> => new Promise((resolve, reject) => {
    const socket = net.connect({host: "127.0.0.1", port});
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new Error(`socket did not close within ${timeoutMs}ms`)), timeoutMs);
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once("close", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    socket.once("error", () => { /* a destroyed socket also raises ECONNRESET; close still fires */ });
});

describe("admission-concurrency", () => {
    let testRoot: TestRoot;
    let pool: ExternalPortServerPool;
    let tcpPort: number;
    let httpPort: number;
    let denied: Array<{port: number; denial: ConcurrencyDenial}>;
    const kept: net.Socket[] = [];

    const sessionsOf = (port: number): number => pool.getServerStatus(port).sessions;

    beforeEach(async () => {
        testRoot = await createTestRoot("admission-concurrency");
        applyTestRoot(testRoot.rootDir);
        AdmissionController.resetForTest();
        pool = ExternalPortServerPool.create([]);
        tcpPort = await getFreePort();
        httpPort = await getFreePort();

        const controller = AdmissionController.instance;
        const context: ConcurrencyContext = {
            ownerOf: (port) => (port === tcpPort || port === httpPort ? {userId: "u_alice", groupId: "g", role: "regular"} : undefined),
            groupAttributes: () => ({max_concurrent_connections: 2}),
            portsOfGroup: (groupId) => (groupId === "g" ? [tcpPort, httpPort] : [])
        };
        controller.attachConcurrency(new ConcurrencyLimiter(context, (port) => controller.sessionCount(port)));
        denied = [];
        controller.onConcurrencyDenied = (port, denial) => { denied.push({port, denial}); };

        const base = {destinationAddress: "127.0.0.1", destinationPort: 18080, keepAlive: 0};
        await expect(pool.startServer({...base, forwardPort: tcpPort, protocol: "tcp" as const})).resolves.toBe(true);
        await expect(pool.startServer({...base, forwardPort: httpPort, protocol: "http" as const})).resolves.toBe(true);

        kept.push(net.connect({host: "127.0.0.1", port: tcpPort}), net.connect({host: "127.0.0.1", port: tcpPort}));
        await waitFor(() => { if(sessionsOf(tcpPort) !== 2) throw new Error("waiting for 2 sessions"); }, {timeoutMs: 2000});
    });

    afterEach(async () => {
        kept.splice(0).forEach((socket) => socket.destroy());
        AdmissionController.instance.attachConcurrency(null);
        AdmissionController.instance.onConcurrencyDenied = null;
        await pool.stopAll();
        AdmissionController.resetForTest();
        await cleanupTestRoot(testRoot);
    });

    it("http 터널은 503 을 쓰고 닫고, tcp 터널은 아무것도 보내지 않고 닫는다", async () => {
        const denialLog = AdmissionController.instance.denialLog;
        expect(denialLog.pending()).toBe(0);
        expect((await connectAndCollectUntilClose(httpPort)).toString()).toBe(HTTP_503);
        // 거절은 집계 로그에도 남는다(포트마다 버킷 하나).
        expect(denialLog.pending()).toBe(1);
        expect((await connectAndCollectUntilClose(tcpPort)).length).toBe(0);
        expect(denialLog.pending()).toBe(2);
        const status = pool.getServerStatus(tcpPort);
        expect(status.sessions).toBe(2);
        expect(status.rejected.rateLimit).toBe(0);
        expect(sessionsOf(httpPort)).toBe(0);
    });

    it("거절 알림은 포트·그룹별로 1분에 한 번만 간다", async () => {
        await connectAndCollectUntilClose(tcpPort);
        await connectAndCollectUntilClose(tcpPort);
        await connectAndCollectUntilClose(tcpPort);
        await connectAndCollectUntilClose(httpPort);
        await connectAndCollectUntilClose(httpPort);
        expect(denied.filter((entry) => entry.port === tcpPort)).toEqual([{port: tcpPort, denial: {groupId: "g", limit: 2, sessions: 2}}]);
        expect(denied.filter((entry) => entry.port === httpPort)).toEqual([{port: httpPort, denial: {groupId: "g", limit: 2, sessions: 2}}]);
    });

    it("연결 하나가 끊기면 다시 받는다", async () => {
        expect((await connectAndCollectUntilClose(tcpPort)).length).toBe(0);
        kept.shift()!.destroy();
        await waitFor(() => { if(sessionsOf(tcpPort) !== 1) throw new Error("waiting for 1 session"); }, {timeoutMs: 2000});
        await new Promise((resolve) => setTimeout(resolve, 100));
        kept.push(net.connect({host: "127.0.0.1", port: tcpPort}));
        await waitFor(() => { if(sessionsOf(tcpPort) !== 2) throw new Error("waiting for 2 sessions"); }, {timeoutMs: 2000});
    });

    it("limiter 를 떼면 상한이 없다", async () => {
        AdmissionController.instance.attachConcurrency(null);
        kept.push(net.connect({host: "127.0.0.1", port: tcpPort}));
        await waitFor(() => { if(sessionsOf(tcpPort) !== 3) throw new Error("waiting for 3 sessions"); }, {timeoutMs: 2000});
    });
});
