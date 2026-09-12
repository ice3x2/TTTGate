import net from "net";
import {startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";
import {httpsRequest} from "../../helpers/http";

jest.setTimeout(120_000);

const connectAndCollectUntilClose = (port: number, timeoutMs: number = 1000): Promise<Buffer> => new Promise((resolve, reject) => {
    const socket = net.connect({host: "127.0.0.1", port});
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new Error(`socket did not close within ${timeoutMs}ms`)), timeoutMs);
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once("close", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    socket.once("error", () => { /* a destroyed socket also raises ECONNRESET; close still fires */ });
});

const connectAndExpectOpen = (port: number, timeoutMs: number = 2000): Promise<void> => new Promise((resolve, reject) => {
    const socket = net.connect({host: "127.0.0.1", port});
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("connect did not complete in time")); }, timeoutMs);
    socket.once("connect", () => { clearTimeout(timer); socket.end(); resolve(); });
    socket.once("error", (err) => { clearTimeout(timer); reject(err); });
});

describe("geo-filter e2e", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;

    beforeAll(async () => {
        target = await startTargetService();
    });

    afterAll(async () => {
        await target.close();
    });

    afterEach(async () => {
        await harness?.dispose();
    });

    it("blocks both the external port and the admin console when 127.0.0.1 is treated as unknown-deny", async () => {
        harness = await createProcessTunnelHarness({
            tunnels: [{protocol: "tcp", destinationPort: target.port}],
            adminAccess: false,
            startClient: false,
            serverOptionExtra: {
                connectionSecurity: {geo: {mode: "allow", countries: ["KR"], unknownPolicy: "deny", applyToAdmin: true}}
            }
        });

        const rejected = await connectAndCollectUntilClose(harness.tunnels[0].forwardPort);
        expect(rejected.length).toBe(0);

        await expect(httpsRequest({port: harness.adminPort, path: "/api/version", rejectUnauthorized: false})).rejects.toBeDefined();
    });

    it("admits both the external port and the admin console after switching unknownPolicy to allow", async () => {
        harness = await createProcessTunnelHarness({
            tunnels: [{protocol: "tcp", destinationPort: target.port}],
            adminAccess: false,
            startClient: false,
            serverOptionExtra: {
                connectionSecurity: {geo: {mode: "allow", countries: ["KR"], unknownPolicy: "deny", applyToAdmin: true}}
            }
        });

        await harness.restartServer({
            serverOptionExtra: {
                connectionSecurity: {geo: {mode: "allow", countries: ["KR"], unknownPolicy: "allow", applyToAdmin: true}}
            }
        });

        await expect(connectAndExpectOpen(harness.tunnels[0].forwardPort)).resolves.toBeUndefined();
        const response = await httpsRequest({port: harness.adminPort, path: "/api/version", rejectUnauthorized: false});
        expect(response.statusCode).toBe(200);
    });

    it("blocks only the external port when applyToAdmin is false", async () => {
        harness = await createProcessTunnelHarness({
            tunnels: [{protocol: "tcp", destinationPort: target.port}],
            adminAccess: false,
            startClient: false,
            serverOptionExtra: {
                connectionSecurity: {geo: {mode: "allow", countries: ["KR"], unknownPolicy: "deny", applyToAdmin: true}}
            }
        });

        await harness.restartServer({
            serverOptionExtra: {
                connectionSecurity: {geo: {mode: "allow", countries: ["KR"], unknownPolicy: "deny", applyToAdmin: false}}
            }
        });

        const rejected = await connectAndCollectUntilClose(harness.tunnels[0].forwardPort);
        expect(rejected.length).toBe(0);

        const response = await httpsRequest({port: harness.adminPort, path: "/api/version", rejectUnauthorized: false});
        expect(response.statusCode).toBe(200);
    });
});
