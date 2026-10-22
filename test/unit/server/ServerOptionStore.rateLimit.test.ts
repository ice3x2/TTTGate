import YAML from "yaml";
import Environment from "../../../src/Environment";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {defaultRateLimit} from "../../../src/types/TunnelingOption";
import File from "../../../src/util/File";
import Files from "../../../src/util/Files";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

describe("ServerOptionStore rateLimit normalization", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("server-option-store-rate-limit");
        applyTestRoot(testRoot.rootDir);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    it("fills a missing rateLimit with the tcp default via updateTunnelingOption", () => {
        const store = ServerOptionStore.instance;
        const tunnelingOption = {
            forwardPort: 18090,
            protocol: "tcp",
            destinationAddress: "127.0.0.1",
            destinationPort: 9,
            keepAlive: -1
        } as any;

        expect(store.updateTunnelingOption(tunnelingOption)).toBe(true);
        expect(store.getTunnelingOption(18090)?.rateLimit).toEqual(defaultRateLimit("tcp"));
    });

    it("rejects an out-of-range rateLimit field with a message naming the field", () => {
        const store = ServerOptionStore.instance;
        const option = {
            forwardPort: 18091,
            protocol: "tcp",
            destinationAddress: "127.0.0.1",
            destinationPort: 9,
            keepAlive: -1,
            rateLimit: {maxConnections: 0}
        } as any;

        const result = store.verificationTunnelingOption(option, "legacy-load");
        expect(result.success).toBe(false);
        expect(result.message).toContain("rateLimit.maxConnections");
    });

    it("fills protocol-specific rateLimit defaults for tunnels loaded from server.yaml", () => {
        const configFile = new File(Environment.path.configDir, "server.yaml");
        Files.writeSync(configFile, YAML.stringify({
            key: "srv-rate-limit",
            adminPort: 9300,
            adminBindHost: "127.0.0.1",
            adminTls: true,
            port: 9126,
            tls: false,
            controlProtocolMode: "mixed",
            allowLegacyControlAuth: false,
            trustedClients: [],
            globalMemCacheLimit: 128,
            keepAlive: 10000,
            tunnelingOptions: [
                {forwardPort: 18092, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: -1},
                {forwardPort: 18093, protocol: "http", destinationAddress: "127.0.0.1", keepAlive: -1}
            ]
        }));

        ServerOptionStore.resetForTest();
        const reloaded = ServerOptionStore.instance;

        expect(reloaded.loadStatus.ready).toBe(true);
        expect(reloaded.getTunnelingOption(18092)?.rateLimit?.maxConnections).toBe(30);
        expect(reloaded.getTunnelingOption(18093)?.rateLimit?.maxConnections).toBe(300);
    });

    it("fills a missing rateLimit through the bulk verificationServerOption path", () => {
        const store = ServerOptionStore.instance;
        const candidate = {
            ...store.serverOption,
            tunnelingOptions: [
                {forwardPort: 18094, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: -1}
            ]
        } as any;

        const result = store.verificationServerOption(candidate);
        expect(result.success).toBe(true);
        expect(result.serverOption!.tunnelingOptions[0].rateLimit).toEqual(defaultRateLimit("tcp"));
    });
});
