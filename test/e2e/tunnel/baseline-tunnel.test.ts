import {createTunnelHarness, TunnelHarness} from "../../helpers/tunnelHarness";

jest.setTimeout(30000);

describe("baseline tunnel behavior", () => {
    let harness: TunnelHarness;

    beforeEach(async () => {
        harness = await createTunnelHarness({reconnectIntervalMs: 100, clientName: "baseline-client"});
        await harness.start();
    });

    afterEach(async () => {
        await harness?.dispose();
    });

    it("echoes data through the tunnel without changing the current contract", async () => {
        const payload = Buffer.from("hello-through-tunnel", "utf-8");
        const received = await harness.sendAndReceive(payload);

        expect(received.equals(payload)).toBe(true);
    });
});
