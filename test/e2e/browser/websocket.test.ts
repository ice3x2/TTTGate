import {Browser, chromium, Page} from "playwright";
import {startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";

jest.setTimeout(120_000);

describe("websocket", () => {
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

    test("upgrades the websocket through the tunnel and exchanges messages with the target", async () => {
        await page.goto(`http://127.0.0.1:${forwardPort}/ws-page`);
        await page.waitForFunction(() => document.getElementById("ws-result")?.textContent === "ok", {timeout: 30_000});
        expect(await page.locator("#ws-result").textContent()).toBe("ok");

        const counters = target.counters();
        expect(counters.wsConnections).toBe(1);
        expect(counters.wsMessages).toBe(1);

        expect(errors).toEqual([]);
    });
});
