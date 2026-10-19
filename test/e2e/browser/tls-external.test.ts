import fs from "fs";
import os from "os";
import path from "path";
import net from "net";
import tls, {TLSSocket} from "tls";
import {Browser, BrowserContext, chromium, Page} from "playwright";
import {startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";
import {generateSelfSignedCert} from "../../helpers/testCerts";

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

// `protocol: "https"` 터널은 `ServerOptionStore.verificationTunnelingOption`(src/server/ServerOptionStore.ts:448)이
// tls를 강제로 true로 만들고, 그 값이 그대로 `TTTServer.ts:126-129`의 openSession openOpt로 전달되어
// 클라이언트가 목적지에 `tls.connect`(src/util/SocketHandler.ts:245-247)로 접속한다. 즉 https 터널은
// 목적지도 실제 TLS 서버여야 한다 — targetService.ts는 평문 HTTP만 제공하므로, 그 앞단에
// TLS를 종료해 평문으로 릴레이하는 최소 프록시를 이 테스트 파일 안에서만 띄운다(공유 헬퍼는 수정하지 않음).
// 클라이언트 프로세스가 이 자체 서명 인증서를 신뢰하도록 NODE_EXTRA_CA_CERTS로 전달한다
// (SocketHandler가 목적지 접속에 rejectUnauthorized:false를 쓸 방법을 옵션으로 제공하지 않기 때문).
const startTlsTerminatingProxy = (upstreamPort: number): Promise<{port: number; certPem: string; close: () => Promise<void>}> => {
    const certBundle = generateSelfSignedCert("127.0.0.1");
    const server = tls.createServer({key: certBundle.keyPem, cert: certBundle.certPem}, (socket: TLSSocket) => {
        const upstream = net.connect(upstreamPort, "127.0.0.1");
        socket.pipe(upstream);
        upstream.pipe(socket);
        socket.on("error", () => upstream.destroy());
        upstream.on("error", () => socket.destroy());
    });
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;
            resolve({
                port,
                certPem: certBundle.certPem,
                close: () => new Promise((closeResolve) => server.close(() => closeResolve()))
            });
        });
    });
};

describe("tls-external", () => {
    let target: TargetService;
    let tlsProxy: {port: number; certPem: string; close: () => Promise<void>};
    let caCertFile: string;
    let previousExtraCaCerts: string | undefined;
    let harness: ProcessTunnelHarness;
    let browser: Browser;
    let context: BrowserContext;
    let page: Page;
    let errors: string[];
    let forwardPort: number;

    beforeAll(async () => {
        target = await startTargetService();
        tlsProxy = await startTlsTerminatingProxy(target.port);

        caCertFile = path.join(os.tmpdir(), `tttgate-e2e-tls-external-ca-${process.pid}.pem`);
        await fs.promises.writeFile(caCertFile, tlsProxy.certPem, {encoding: "utf-8"});
        previousExtraCaCerts = process.env.NODE_EXTRA_CA_CERTS;
        process.env.NODE_EXTRA_CA_CERTS = caCertFile;

        harness = await createProcessTunnelHarness({tunnels: [{protocol: "https", destinationPort: tlsProxy.port, tls: true}]});
        forwardPort = harness.tunnels[0].forwardPort;
        await harness.waitForTunnelOnline(forwardPort);
        browser = await chromium.launch();
        // 외부 포트 인증서가 자체 서명이므로 브라우저 컨텍스트에서 검증 오류를 무시한다.
        context = await browser.newContext({ignoreHTTPSErrors: true});
        page = await context.newPage();
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
                try {
                    await tlsProxy?.close();
                } finally {
                    try {
                        await target?.close();
                    } finally {
                        if(previousExtraCaCerts === undefined) {
                            delete process.env.NODE_EXTRA_CA_CERTS;
                        } else {
                            process.env.NODE_EXTRA_CA_CERTS = previousExtraCaCerts;
                        }
                        await fs.promises.rm(caCertFile, {force: true});
                    }
                }
            }
        }
    });

    test("serves the target page over the https external port with a self-signed certificate", async () => {
        await page.goto(`https://127.0.0.1:${forwardPort}/`);
        await page.waitForSelector("#ready", {timeout: 30_000});
        await waitForText(page, "#ready", "ready", 30_000);
        expect(await page.evaluate(() => (window as any).__loaded)).toBe(40);
        expect(await page.locator("#host").textContent()).toBe("127.0.0.1");
        expect(await page.evaluate(() => location.protocol)).toBe("https:");

        const res = await page.request.get(`https://127.0.0.1:${forwardPort}/custom-response`);
        expect(res.status()).toBe(200);
        expect(await res.text()).toBe("original-body");

        expect(errors).toEqual([]);
    });
});
