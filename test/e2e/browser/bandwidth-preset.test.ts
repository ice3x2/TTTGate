// U5-09 / #124 — 실제 서버·클라이언트 프로세스에서 그룹 대역폭 프리셋(1MB/s)이 양방향 전송을 제한한다(PRD K4).
import crypto from "crypto";
import {Browser, chromium, Page} from "playwright";
import {bigPayloadDigest, startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";
import {E2E_ADMIN_PASSWORD, IdentityFixture} from "../../helpers/identityFixture";

jest.setTimeout(120_000);

const PRESET = 1_048_576;
const MiB = 1_048_576;

const FIXTURE: IdentityFixture = {
    users: [
        {username: "admin", password: E2E_ADMIN_PASSWORD, role: "superuser"},
        {id: "u_00000000000a11ce", username: "alice", password: "alice-pass-1234", role: "regular", groupId: "g_slow"},
        {id: "u_0000000000000b0b", username: "bob", password: "bob-pass-1234", role: "regular", groupId: "g_fast"}
    ],
    groups: [
        {id: "g_slow", name: "Slow", attributes: {rate_limit: "1MB/s"}},
        {id: "g_fast", name: "Fast", attributes: {rate_limit: "unlimited"}}
    ]
};

/** 요청 직전부터 본문 마지막 바이트까지의 초. 연결 수립과 헤더 왕복도 포함된다. */
const timed = async <T>(work: () => Promise<T>): Promise<{value: T; seconds: number}> => {
    const startedAt = process.hrtime.bigint();
    const value = await work();
    return {value, seconds: Number(process.hrtime.bigint() - startedAt) / 1e9};
};

describe("bandwidth-preset e2e", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;
    let browser: Browser;
    let page: Page;
    let slowPort: number;
    let fastPort: number;
    const pageErrors: string[] = [];

    beforeAll(async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({
            tunnels: [
                {protocol: "http", destinationPort: target.port, extra: {ownerId: "u_00000000000a11ce"}},
                {protocol: "http", destinationPort: target.port, extra: {ownerId: "u_0000000000000b0b"}}
            ],
            identityFixture: FIXTURE
        });
        slowPort = harness.tunnels[0].forwardPort;
        fastPort = harness.tunnels[1].forwardPort;
        await harness.waitForTunnelOnline(slowPort);
        await harness.waitForTunnelOnline(fastPort);
        browser = await chromium.launch();
        page = await browser.newPage();
        page.on("pageerror", (error) => pageErrors.push(String(error)));
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

    test("1MB/s 그룹의 5 MiB 다운로드는 프리셋 -10%~+5% 속도다", async () => {
        const {value: body, seconds} = await timed(async () => {
            const res = await page.request.get(`http://127.0.0.1:${slowPort}/big?mb=5`, {timeout: 60_000});
            expect(res.status()).toBe(200);
            return res.body();
        });
        expect(body.length).toBe(5 * MiB);
        expect(crypto.createHash("sha256").update(body).digest("hex")).toBe(bigPayloadDigest(5));
        const rate = 5 * MiB / seconds;
        expect(rate).toBeGreaterThanOrEqual(PRESET * 0.90);
        expect(rate).toBeLessThanOrEqual(PRESET * 1.05);
    });

    test("1MB/s 그룹의 5 MiB 업로드+에코는 두 방향이 한 버킷을 공유해 10 MiB 기준으로 프리셋 속도다", async () => {
        // 버킷 용량은 1초 분량이라, 쉬는 동안 가득 차면 다음 전송 초반에 그만큼 한꺼번에 나간다.
        // 다운로드 직후 바로 이어 재어 그 몫이 측정에 끼지 않게 한다(사이에 다른 케이스를 두지 않는다).
        const payload = crypto.randomBytes(5 * MiB);
        const {value: body, seconds} = await timed(async () => {
            const res = await page.request.post(`http://127.0.0.1:${slowPort}/echo-post`, {data: payload, timeout: 60_000});
            expect(res.status()).toBe(200);
            return res.body();
        });
        expect(Buffer.compare(body, payload)).toBe(0);
        const rate = 10 * MiB / seconds;
        expect(rate).toBeGreaterThanOrEqual(PRESET * 0.90);
        expect(rate).toBeLessThanOrEqual(PRESET * 1.05);
    });

    test("unlimited 그룹의 같은 다운로드는 1초 안이다", async () => {
        const {value: body, seconds} = await timed(async () => {
            const res = await page.request.get(`http://127.0.0.1:${fastPort}/big?mb=5`, {timeout: 60_000});
            expect(res.status()).toBe(200);
            return res.body();
        });
        expect(body.length).toBe(5 * MiB);
        expect(seconds).toBeLessThan(1);
    });

    test("페이지 오류가 없다", () => {
        expect(pageErrors).toEqual([]);
    });
});
