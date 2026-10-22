import {Browser, chromium, Page} from "playwright";
import {startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";

jest.setTimeout(120_000);

describe("http-rewrite", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;
    let browser: Browser;
    let page: Page;
    let errors: string[];
    let forwardPort: number;

    beforeAll(async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({
            tunnels: [{
                protocol: "http",
                destinationPort: target.port,
                httpOption: {
                    rewriteHostInTextBody: true,
                    replaceAccessControlAllowOrigin: true,
                    customRequestHeaders: [{name: "X-Injected", value: "yes", replace: true}],
                    customResponseHeaders: [{name: "X-Target", value: "rewritten", replace: true}],
                    bodyRewriteRules: [{from: "original-body", to: "rewritten-body"}]
                }
            }]
        });
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

    test("rewrites absolute URLs in the html body to the external host", async () => {
        await page.goto(`http://127.0.0.1:${forwardPort}/absolute`);
        expect(await page.locator("#link").getAttribute("href")).toBe(`http://127.0.0.1:${forwardPort}/absolute-target`);
        expect(await page.locator("#text").textContent()).toBe(`http://127.0.0.1:${forwardPort}`);
    });

    test("rewrites Access-Control-Allow-Origin to the page origin for a same-origin request without an Origin header", async () => {
        await page.goto(`http://127.0.0.1:${forwardPort}/`);
        const acao = await page.evaluate(() => fetch("/api/cors").then((r) => r.headers.get("access-control-allow-origin")));
        expect(acao).toBe(`http://127.0.0.1:${forwardPort}`);
    });

    test("injects the custom request header and rewrites the request host to the destination address", async () => {
        const json = await page.evaluate(() => fetch("/headers").then((r) => r.json()));
        expect(json["x-injected"]).toBe("yes");
        expect(json["host"]).toBe("127.0.0.1");
    });

    test("appends the custom response header and rewrites the response body by rule", async () => {
        const res = await page.request.get(`http://127.0.0.1:${forwardPort}/custom-response`);
        expect(res.headers()["x-target"]).toBe("rewritten");
        expect(await res.text()).toBe("rewritten-body");
    });

    test("raised no browser page errors over the whole run", () => {
        expect(errors).toEqual([]);
    });
});
