import crypto from "crypto";
import {Browser, chromium, Page} from "playwright";
import {bigPayloadDigest, startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness, readRssMiB} from "../../helpers/processTunnelHarness";

jest.setTimeout(120_000);

// Linux 첫 실측 최대 RSS 증가량(MiB) × 2 vs 256 중 큰 값. 아직 Linux 실측이 없어 초기값 256을 사용한다(이슈 #77 코멘트 참조).
const RSS_LIMIT_MIB = 256;

describe("large-transfer", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;
    let browser: Browser;
    let page: Page;
    let forwardPort: number;

    beforeAll(async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({
            tunnels: [{
                protocol: "http",
                destinationPort: target.port,
                extra: {bufferLimitOnServer: 4, bufferLimitOnClient: 4}
            }]
        });
        forwardPort = harness.tunnels[0].forwardPort;
        await harness.waitForTunnelOnline(forwardPort);
        browser = await chromium.launch();
        page = await browser.newPage();
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

    test("transfers a 100MiB payload intact within a bounded RSS increase and keeps the tunnel alive", async () => {
        const baselineRssMiB = readRssMiB(harness.server.child.pid!);
        const samples: number[] = [];
        const interval = setInterval(() => {
            const sample = readRssMiB(harness.server.child.pid!);
            if(sample !== undefined) samples.push(sample);
        }, 500);

        let res;
        try {
            res = await page.request.get(`http://127.0.0.1:${forwardPort}/big?mb=100`, {timeout: 110_000});
        } finally {
            clearInterval(interval);
        }

        expect(res.status()).toBe(200);
        const body = await res.body();
        expect(body.length).toBe(104857600);
        expect(crypto.createHash("sha256").update(body).digest("hex")).toBe(bigPayloadDigest(100));

        if(process.platform === "linux") {
            expect(baselineRssMiB).toBeDefined();
            const maxSample = Math.max(...samples);
            expect(maxSample - (baselineRssMiB as number)).toBeLessThanOrEqual(RSS_LIMIT_MIB);
        } else {
            expect(baselineRssMiB).toBeUndefined();
            expect(samples).toEqual([]);
        }

        await page.goto(`http://127.0.0.1:${forwardPort}/`);
        await page.waitForSelector("#ready", {timeout: 30_000});
        expect(await page.locator("#ready").textContent()).toBe("ready");

        expect(harness.server.child.exitCode).toBeNull();
        expect(harness.clients[0].child.exitCode).toBeNull();
    });
});
