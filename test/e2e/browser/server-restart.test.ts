import {Browser, chromium, Page} from "playwright";
import {startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";

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

describe("server-restart", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;
    let browser: Browser;
    let page: Page;
    let errors: string[];
    let forwardPort: number;

    beforeAll(async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({tunnels: [{protocol: "http", destinationPort: target.port}]});
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

    test("the client survives a server process restart and reconnects on its own", async () => {
        await page.goto(`http://127.0.0.1:${forwardPort}/`);
        await page.waitForSelector("#ready", {timeout: 30_000});
        await waitForText(page, "#ready", "ready", 30_000);

        const previousPid = harness.server.pid;
        const clientBeforeRestart = harness.clients[0];
        await harness.restartServer();
        expect(harness.server.pid).not.toBe(previousPid);
        // 서버만 재시작되고 클라이언트 프로세스는 그대로 살아남아 스스로 재접속해야 한다.
        expect(clientBeforeRestart.child.exitCode).toBeNull();

        const deadline = Date.now() + 20_000;
        let lastError: unknown;
        while(Date.now() < deadline) {
            try {
                await page.goto("http://127.0.0.1:" + forwardPort + "/", {timeout: 5000});
                await page.waitForSelector("#ready", {timeout: 5000});
                await waitForText(page, "#ready", "ready", 5000);
                lastError = undefined;
                break;
            } catch(err) {
                lastError = err;
                await new Promise((resolve) => setTimeout(resolve, 300));
            }
        }
        if(lastError) throw lastError;

        expect(harness.clients[0].child.exitCode).toBeNull();
        expect(harness.clients[0].readChannel().stdout).toContain("Try reconnect after 5000ms");
        expect(errors).toEqual([]);
    });
});
