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

describe("ExternalPortServerPool geo admission", () => {
    let testRoot: TestRoot;
    let pool: ExternalPortServerPool;

    beforeEach(async () => {
        testRoot = await createTestRoot("external-port-pool-geo-admission");
        applyTestRoot(testRoot.rootDir);
        AdmissionController.resetForTest();
        pool = ExternalPortServerPool.create([]);
    });

    afterEach(async () => {
        await pool.stopAll();
        await cleanupTestRoot(testRoot);
        AdmissionController.resetForTest();
    });

    it("closes a tcp connection with 0 bytes and tallies rejected.geo when geo denies loopback via unknownPolicy", async () => {
        const forwardPort = await getFreePort();
        const option = {
            forwardPort,
            protocol: "tcp" as const,
            destinationAddress: "127.0.0.1",
            destinationPort: 18080,
            keepAlive: 0
        };
        await expect(pool.startServer(option)).resolves.toBe(true);

        AdmissionController.instance.configureGeo({mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "deny"});

        const rejected = await connectAndCollectUntilClose(forwardPort);
        expect(rejected.length).toBe(0);
        expect(pool.getServerStatus(forwardPort).rejected.geo).toBe(1);
    });

    it("keeps the connection alive after reconfiguring to unknownPolicy allow, without restarting the listener", async () => {
        const forwardPort = await getFreePort();
        const option = {
            forwardPort,
            protocol: "tcp" as const,
            destinationAddress: "127.0.0.1",
            destinationPort: 18080,
            keepAlive: 0
        };
        await expect(pool.startServer(option)).resolves.toBe(true);
        AdmissionController.instance.configureGeo({mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "deny"});

        AdmissionController.instance.configureGeo({mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "allow"});

        const socket = net.connect({host: "127.0.0.1", port: forwardPort});
        await waitFor(() => {
            if(pool.getServerStatus(forwardPort).sessions !== 1) throw new Error("waiting for 1 session");
        }, {timeoutMs: 2000});

        socket.destroy();
    });
});
