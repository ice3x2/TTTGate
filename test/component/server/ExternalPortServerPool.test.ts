import {ExternalPortServerPool} from "../../../src/server/ExternalPortServerPool";
import {getFreePort} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

describe("ExternalPortServerPool operational contracts", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("external-port-pool");
        applyTestRoot(testRoot.rootDir);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    it("returns true on successful stop and clears the forward-port slot for reuse", async () => {
        const forwardPort = await getFreePort();
        const pool = ExternalPortServerPool.create([]);
        const option = {
            forwardPort,
            protocol: "tcp" as const,
            destinationAddress: "127.0.0.1",
            destinationPort: 18080,
            keepAlive: 0
        };

        await expect(pool.startServer(option)).resolves.toBe(true);
        await expect(pool.stop(forwardPort)).resolves.toBe(true);
        expect(pool.getServerStatus(forwardPort).online).toBe(false);
        await expect(pool.startServer(option)).resolves.toBe(true);
        await pool.stopAll();
    });
});
