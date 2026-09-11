import fs from "fs";
import os from "os";
import {Browser, chromium, Page} from "playwright";
import {startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness, readRssMiB} from "../../helpers/processTunnelHarness";
import {httpsRequest} from "../../helpers/http";

jest.setTimeout(120_000);

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

describe("tcp-page", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;
    let browser: Browser;
    let page: Page;
    let errors: string[];
    let forwardPort: number;

    beforeAll(async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({tunnels: [{protocol: "tcp", destinationPort: target.port}]});
        forwardPort = harness.tunnels[0].forwardPort;
        await harness.waitForTunnelOnline(forwardPort);
        browser = await chromium.launch();
        page = await browser.newPage();
        errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
    });

    afterAll(async () => {
        try {
            await browser?.close();
        } finally {
            try {
                await harness?.dispose();
            } finally {
                await target?.close();
            }
        }
    });

    test("loads the target page through the tcp tunnel without rewriting the host", async () => {
        for(let i = 0; i < 5; i++) {
            if(i === 0) {
                await page.goto(`http://127.0.0.1:${forwardPort}/`);
            } else {
                await page.reload();
            }
            await page.waitForSelector("#ready", {timeout: 30_000});
            await waitForText(page, "#ready", "ready", 30_000);
            expect(await page.locator("#host").textContent()).toBe(`127.0.0.1:${forwardPort}`);
            const loaded = await page.evaluate(() => (window as any).__loaded);
            expect(loaded).toBe(40);
        }

        expect(target.counters().requests).toBeGreaterThanOrEqual(255);
        expect(errors).toEqual([]);
        expect(harness.server.child.exitCode).toBeNull();
    });
});

describe("createProcessTunnelHarness failure paths", () => {
    test("rejects when no tunnels are provided", async () => {
        await expect(createProcessTunnelHarness({tunnels: []})).rejects.toThrow("At least one tunnel is required");
    });

    test("rejects insecure clientOptionExtra fields without leaving a temp directory behind", async () => {
        const before = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("tttgate-e2e-"));
        await expect(createProcessTunnelHarness({
            tunnels: [{protocol: "tcp", destinationPort: 1}],
            clientOptionExtra: {allowInsecureTls: true}
        })).rejects.toThrow("clientOptionExtra must not contain insecure fields");
        const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("tttgate-e2e-"));
        expect(after).toEqual(before);
    });

    test("readRssMiB is platform-gated and undefined for an invalid pid", () => {
        const own = readRssMiB(process.pid);
        if(process.platform === "linux") {
            expect(own).toBeGreaterThan(0);
        } else {
            expect(own).toBeUndefined();
        }
        expect(readRssMiB(2147483647)).toBeUndefined();
    });
});

describe("createProcessTunnelHarness admin access", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;

    beforeAll(async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({tunnels: [{protocol: "tcp", destinationPort: target.port}]});
    });

    afterAll(async () => {
        try {
            await harness?.dispose();
        } finally {
            await target?.close();
        }
    });

    test("adminRequest / httpsRequest can reach the admin api over TLS", async () => {
        const res = await httpsRequest({port: harness.adminPort, path: "/api/version"});
        expect(res.statusCode).toBe(200);
        const json = JSON.parse(res.body);
        expect(json).toHaveProperty("name");
    });
});
