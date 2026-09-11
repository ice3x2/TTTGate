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

describe("multi-client", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;
    let browser: Browser;
    let page: Page;
    let errors: string[];
    let forwardPort0: number;
    let forwardPort1: number;

    beforeAll(async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({
            clientCount: 2,
            tunnels: [
                {protocol: "tcp", destinationPort: target.port, extra: {allowedClientIds: ["e2e-client-0"]}},
                {protocol: "tcp", destinationPort: target.port, extra: {allowedClientIds: ["e2e-client-1"]}}
            ]
        });
        forwardPort0 = harness.tunnels[0].forwardPort;
        forwardPort1 = harness.tunnels[1].forwardPort;
        await harness.waitForTunnelOnline(forwardPort0);
        await harness.waitForTunnelOnline(forwardPort1);
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

    test("each tunnel is served by its own dedicated client independently of the other client's lifecycle", async () => {
        await page.goto(`http://127.0.0.1:${forwardPort0}/`);
        await page.waitForSelector("#ready", {timeout: 30_000});
        await waitForText(page, "#ready", "ready", 30_000);

        await page.goto(`http://127.0.0.1:${forwardPort1}/`);
        await page.waitForSelector("#ready", {timeout: 30_000});
        await waitForText(page, "#ready", "ready", 30_000);

        await harness.stopClient(0);

        // 실패 확인용 탐색은 별도 페이지에서 수행한다. 실패한 goto가 브라우저 내부에
        // 남긴 대기 중인 탐색 상태가, 메인 page의 이후 탐색을 "interrupted by another
        // navigation" 으로 튕겨내는 것을 막기 위함이다.
        const probePage = await browser.newPage();
        let failedToLoad = false;
        try {
            await probePage.goto(`http://127.0.0.1:${forwardPort0}/`, {timeout: 5000});
            await probePage.waitForSelector("#ready:has-text(\"ready\")", {timeout: 5000});
        } catch {
            failedToLoad = true;
        } finally {
            await probePage.close();
        }
        expect(failedToLoad).toBe(true);

        await page.goto(`http://127.0.0.1:${forwardPort1}/`);
        await page.waitForSelector("#ready", {timeout: 30_000});
        await waitForText(page, "#ready", "ready", 30_000);

        await harness.startClient(0);

        await page.goto(`http://127.0.0.1:${forwardPort0}/`);
        await page.waitForSelector("#ready", {timeout: 20_000});
        await waitForText(page, "#ready", "ready", 20_000);

        expect(errors).toEqual([]);
    });
});
