import crypto from "crypto";
import {Browser, chromium, Page} from "playwright";
import {bigPayloadChunk, startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";

jest.setTimeout(120_000);

// #130 — 업로드 방향(브라우저 → 내부 서버) 대용량 전송. 목적지 배압이 터널 데이터 소켓까지 전파되지 않으면
// 클라이언트 쪽 대기 큐가 파일 캐시 한도를 넘어 연결이 끊긴다. 작은 세션 버퍼로 배압이 실제로 걸리게 한다.
// 서버 업로드 배압(#163)·일시정지 사유(#169)·청크 스트리밍(#176)이 함께 있어야 통과한다(에코 응답이 청크 하나로 온다).
const UPLOAD_BYTES = 100 * 1024 * 1024;

describe("large-upload", () => {
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

    test("uploads a 100MiB body intact through the tunnel and keeps the tunnel alive", async () => {
        const payload = bigPayloadChunk(0, UPLOAD_BYTES);
        const expectedDigest = crypto.createHash("sha256").update(payload).digest("hex");
        const res = await page.request.post(`http://127.0.0.1:${forwardPort}/echo-post`, {
            data: payload, headers: {"Content-Type": "application/octet-stream"}, timeout: 110_000
        });
        expect(res.status()).toBe(200);
        const body = await res.body();
        expect(body.length).toBe(UPLOAD_BYTES);
        expect(crypto.createHash("sha256").update(body).digest("hex")).toBe(expectedDigest);

        expect(harness.server.child.exitCode).toBeNull();
        expect(harness.clients[0].child.exitCode).toBeNull();
    });
});
