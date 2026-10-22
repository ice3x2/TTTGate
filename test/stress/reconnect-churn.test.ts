import {sleep} from "../helpers/network";
import {createTunnelHarness, TunnelHarness} from "../helpers/tunnelHarness";

jest.setTimeout(30000);

describe("reconnect churn baseline", () => {
    let harness: TunnelHarness;

    beforeEach(async () => {
        harness = await createTunnelHarness({reconnectIntervalMs: 100, clientName: "reconnect-client"});
        await harness.start();
    });

    afterEach(async () => {
        await harness?.dispose();
    });

    it("reconnects after repeated server restarts without runaway cache or handle growth", async () => {
        const baseline = harness.collectResourceStats();

        for(let i = 0; i < 3; i++) {
            const beforeRestart = Buffer.from(`before-restart-${i}`, "utf-8");
            const afterRestart = Buffer.from(`after-restart-${i}`, "utf-8");

            expect((await harness.sendAndReceive(beforeRestart)).equals(beforeRestart)).toBe(true);
            await harness.restartServer();
            expect((await harness.sendAndReceive(afterRestart)).equals(afterRestart)).toBe(true);
        }

        await sleep(200);
        const activeStats = harness.collectResourceStats();
        expect(activeStats.fdCount).toBeLessThanOrEqual(baseline.fdCount + 5);
        expect(activeStats.serverCacheBytes).toBeLessThanOrEqual(baseline.serverCacheBytes + (1024 * 1024));
        expect(activeStats.clientCacheBytes).toBeLessThanOrEqual(baseline.clientCacheBytes + (1024 * 1024));

        await harness.shutdown();
        await sleep(200);

        const stoppedStats = harness.collectResourceStats();
        expect(stoppedStats.fdCount).toBeLessThanOrEqual(baseline.fdCount + 5);
        expect(stoppedStats.serverCacheBytes).toBeLessThanOrEqual(baseline.serverCacheBytes + (1024 * 1024));
        expect(stoppedStats.clientCacheBytes).toBeLessThanOrEqual(baseline.clientCacheBytes + (1024 * 1024));
        expect(stoppedStats.socketGlobalBufferedBytes).toBe(0);
    });
});
