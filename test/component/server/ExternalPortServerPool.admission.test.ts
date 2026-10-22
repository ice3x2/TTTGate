import net from "net";
import {ExternalPortServerPool} from "../../../src/server/ExternalPortServerPool";
import {AdmissionController} from "../../../src/server/security/AdmissionController";
import {getFreePort, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(30_000);

const connectAndCollectUntilClose = (port: number, timeoutMs: number = 1000): Promise<Buffer> => new Promise((resolve, reject) => {
    const socket = net.connect({host: "127.0.0.1", port});
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new Error(`socket did not close within ${timeoutMs}ms`)), timeoutMs);
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once("close", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    socket.once("error", () => { /* a destroyed socket also raises ECONNRESET; close still fires */ });
});

describe("ExternalPortServerPool admission wiring", () => {
    let testRoot: TestRoot;
    let pool: ExternalPortServerPool;

    beforeEach(async () => {
        testRoot = await createTestRoot("external-port-pool-admission");
        applyTestRoot(testRoot.rootDir);
        AdmissionController.resetForTest();
        pool = ExternalPortServerPool.create([]);
    });

    afterEach(async () => {
        await pool.stopAll();
        await cleanupTestRoot(testRoot);
    });

    it("rejects and bans a third connection beyond the tunnel's configured maxConnections", async () => {
        const forwardPort = await getFreePort();
        const option = {
            forwardPort,
            protocol: "tcp" as const,
            destinationAddress: "127.0.0.1",
            destinationPort: 18080,
            keepAlive: 0,
            rateLimit: {enabled: true, windowMs: 60000, maxConnections: 2, banMs: 60000, customized: false}
        };

        await expect(pool.startServer(option)).resolves.toBe(true);

        const kept: net.Socket[] = [
            net.connect({host: "127.0.0.1", port: forwardPort}),
            net.connect({host: "127.0.0.1", port: forwardPort})
        ];

        await waitFor(() => {
            if(pool.getServerStatus(forwardPort).sessions !== 2) throw new Error("waiting for 2 sessions");
        }, {timeoutMs: 2000});

        const rejected = await connectAndCollectUntilClose(forwardPort);
        expect(rejected.length).toBe(0);

        const status = pool.getServerStatus(forwardPort);
        expect(status.rejected.rateLimit).toBe(1);
        expect(status.bannedIps).toBe(1);
        expect(AdmissionController.instance.sessionCount(forwardPort)).toBe(2);

        kept.forEach((socket) => socket.destroy());
    });

    it("clears rate-limit state on stop and re-admits after restart", async () => {
        const forwardPort = await getFreePort();
        const option = {
            forwardPort,
            protocol: "tcp" as const,
            destinationAddress: "127.0.0.1",
            destinationPort: 18080,
            keepAlive: 0,
            rateLimit: {enabled: true, windowMs: 60000, maxConnections: 1, banMs: 60000, customized: false}
        };

        await expect(pool.startServer(option)).resolves.toBe(true);
        const first = net.connect({host: "127.0.0.1", port: forwardPort});
        await waitFor(() => {
            if(pool.getServerStatus(forwardPort).sessions !== 1) throw new Error("waiting for 1 session");
        }, {timeoutMs: 2000});

        await expect(pool.stop(forwardPort)).resolves.toBe(true);
        expect(AdmissionController.instance.rateLimiter.stats(forwardPort)).toEqual({rejectedBans: 0, rejectedExceeded: 0, bannedIps: 0});
        first.destroy();

        await expect(pool.startServer(option)).resolves.toBe(true);
        const second = net.connect({host: "127.0.0.1", port: forwardPort});
        await waitFor(() => {
            if(pool.getServerStatus(forwardPort).sessions !== 1) throw new Error("waiting for 1 session after restart");
        }, {timeoutMs: 2000});

        second.destroy();
    });

    it("reports sessionCount as 0 for a controller with no concurrency provider configured", () => {
        AdmissionController.resetForTest();
        expect(AdmissionController.instance.sessionCount(1)).toBe(0);
    });
});
