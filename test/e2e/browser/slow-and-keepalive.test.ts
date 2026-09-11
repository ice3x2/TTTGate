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

describe("slow-and-keepalive", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;
    let browser: Browser;
    let page: Page;
    let errors: string[];
    let forwardPort: number;

    beforeAll(async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({tunnels: [{protocol: "http", destinationPort: target.port, httpOption: {keepAliveTimeout: 5}}]});
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

    test("keeps a slow in-flight response alive within the timeout and reuses the connection until it idles out", async () => {
        await page.goto(`http://127.0.0.1:${forwardPort}/`);
        await page.waitForSelector("#ready", {timeout: 30_000});
        await waitForText(page, "#ready", "ready", 30_000);

        // keepAliveTimeout(5초)보다 짧은 3초 지연 응답은 진행 중에 끊기지 않아야 한다.
        const slowResult = await page.evaluate(() => fetch("/slow?ms=3000").then((r) => r.text()));
        expect(slowResult).toBe("slow-done");

        for(let i = 0; i < 20; i++) {
            const status = await page.evaluate(() => fetch("/custom-response").then((r) => r.status));
            expect(status).toBe(200);
        }

        // keepAliveTimeout(5초) 경과를 확인하기 위한 유휴 대기(6초). 상태 전이 판정 목적이 아니라
        // 타임아웃 경과 자체를 만들어내기 위한 것이라 예외적으로 sleep을 허용한다.
        await new Promise((resolve) => setTimeout(resolve, 6000));

        const statusAfterIdle = await page.evaluate(() => fetch("/custom-response").then((r) => r.status));
        expect(statusAfterIdle).toBe(200);

        expect(harness.server.child.exitCode).toBeNull();
        expect(harness.clients[0].child.exitCode).toBeNull();
        expect(errors).toEqual([]);
    });
});
