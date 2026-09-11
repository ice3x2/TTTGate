import net from "net";
import {Browser, chromium, Page} from "playwright";
import {startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness, readRssMiB} from "../../helpers/processTunnelHarness";

jest.setTimeout(120_000);

const connectAndEnd = (port: number, timeoutMs: number = 2000): Promise<void> => new Promise((resolve, reject) => {
    const socket = net.connect({host: "127.0.0.1", port});
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("connect did not complete in time")); }, timeoutMs);
    socket.once("connect", () => { clearTimeout(timer); socket.end(); resolve(); });
    socket.once("error", (err) => { clearTimeout(timer); reject(err); });
});

const connectAndCollectUntilClose = (port: number, timeoutMs: number = 1000): Promise<Buffer> => new Promise((resolve, reject) => {
    const socket = net.connect({host: "127.0.0.1", port});
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new Error(`socket did not close within ${timeoutMs}ms`)), timeoutMs);
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once("close", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    socket.once("error", () => { /* a destroyed socket also raises ECONNRESET; close still fires */ });
});

const sendTcpGetRequest = (port: number, timeoutMs: number = 5000): Promise<string> => new Promise((resolve, reject) => {
    const socket = net.connect({host: "127.0.0.1", port});
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("no response within time")); }, timeoutMs);
    socket.once("connect", () => socket.write("GET / HTTP/1.0\r\n\r\n"));
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString("utf-8")); });
    socket.once("error", reject);
});

const waitForText = async (page: Page, selector: string, expected: string, timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    let lastText: string | null = null;
    while(Date.now() < deadline) {
        lastText = await page.locator(selector).textContent();
        if(lastText === expected) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${selector} to equal "${expected}" (last: "${lastText}")`);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("rate-limit e2e", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;
    let tcpForwardPort: number;
    let httpForwardPort: number;

    beforeAll(async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({
            tunnels: [
                {
                    protocol: "tcp",
                    destinationPort: target.port,
                    extra: {rateLimit: {enabled: true, windowMs: 5000, maxConnections: 5, banMs: 30000, customized: false}}
                },
                {protocol: "http", destinationPort: target.port}
            ]
        });
        tcpForwardPort = harness.tunnels[0].forwardPort;
        httpForwardPort = harness.tunnels[1].forwardPort;
        await harness.waitForTunnelOnline(tcpForwardPort);
        await harness.waitForTunnelOnline(httpForwardPort);
    });

    afterAll(async () => {
        try {
            await harness?.dispose();
        } finally {
            await target?.close();
        }
    });

    test("bans a tcp IP past its configured maxConnections, exposes it via the bans API, and unban restores service", async () => {
        const baselineRssMiB = readRssMiB(harness.server.pid);

        for(let i = 0; i < 5; i++) {
            await connectAndEnd(tcpForwardPort);
        }

        const sixth = await connectAndCollectUntilClose(tcpForwardPort);
        expect(sixth.length).toBe(0);

        const bansAfterFirstBan = await harness.adminRequest("/api/security/bans");
        expect(bansAfterFirstBan.status).toBe(200);
        const initialBan = (bansAfterFirstBan.json.bans as Array<{port: number; ip: string}>).find((b) => b.port === tcpForwardPort);
        expect(initialBan).toBeDefined();

        await Promise.all(Array.from({length: 100}, () => connectAndCollectUntilClose(tcpForwardPort, 2000).catch(() => undefined)));

        if(process.platform === "linux") {
            const samples: number[] = [];
            for(let i = 0; i < 3; i++) {
                const rss = readRssMiB(harness.server.pid);
                if(rss !== undefined) samples.push(rss);
                await sleep(1000);
            }
            expect(Math.min(...samples)).toBeLessThanOrEqual((baselineRssMiB ?? 0) + 32);
        }

        const statuses = await harness.adminRequest("/api/externalServerStatuses");
        expect(statuses.status).toBe(200);
        const tcpStatus = (statuses.json.statuses as Array<{port: number; rejected: {rateLimit: number}; bannedIps: number}>)
            .find((s) => s.port === tcpForwardPort);
        expect(tcpStatus).toBeDefined();
        expect(tcpStatus!.rejected.rateLimit).toBeGreaterThanOrEqual(96);
        expect(tcpStatus!.bannedIps).toBe(1);

        const bansBeforeUnban = await harness.adminRequest("/api/security/bans");
        const ban = (bansBeforeUnban.json.bans as Array<{port: number; ip: string}>).find((b) => b.port === tcpForwardPort)!;
        expect(ban).toBeDefined();

        const unbanResult = await harness.adminRequest(`/api/security/bans/${ban.port}/${encodeURIComponent(ban.ip)}`, {method: "DELETE"});
        expect(unbanResult.status).toBe(200);
        expect(unbanResult.json.removed).toBe(true);

        const responseAfterUnban = await sendTcpGetRequest(tcpForwardPort);
        expect(responseAfterUnban).toContain("Target OK");

        const bansAfterUnban = await harness.adminRequest("/api/security/bans");
        expect((bansAfterUnban.json.bans as unknown[]).filter((b: any) => b.port === tcpForwardPort)).toEqual([]);
    });

    test("http tunnel keeps serving normally under the default rate limit", async () => {
        const browser: Browser = await chromium.launch();
        const errors: string[] = [];
        try {
            const page = await browser.newPage();
            page.on("pageerror", (error) => errors.push(error.message));

            for(let i = 0; i < 10; i++) {
                if(i === 0) {
                    await page.goto(`http://127.0.0.1:${httpForwardPort}/`);
                } else {
                    await page.reload();
                }
                await page.waitForSelector("#ready", {timeout: 30_000});
                await waitForText(page, "#ready", "ready", 30_000);
            }

            expect(errors).toEqual([]);
        } finally {
            await browser.close();
        }
    });
});
