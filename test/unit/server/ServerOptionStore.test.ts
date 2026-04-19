import Environment from "../../../src/Environment";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {DEFAULT_KEY} from "../../../src/types/TunnelingOption";
import File from "../../../src/util/File";
import Files from "../../../src/util/Files";
import YAML from "yaml";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

describe("ServerOptionStore baseline behavior", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("server-option-store");
        applyTestRoot(testRoot.rootDir);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    it("creates the default server option file when config is missing", () => {
        const store = ServerOptionStore.instance;
        const configFile = new File(Environment.path.configDir, "server.yaml");

        expect(configFile.isFile()).toBe(true);
        expect(store.serverOption.key).not.toBe(DEFAULT_KEY);
        expect(store.serverOption).toMatchObject({
            adminPort: 9300,
            adminBindHost: "127.0.0.1",
            adminTls: true,
            port: 9126,
            tls: false,
            controlProtocolMode: "mixed",
            allowLegacyControlAuth: false,
            tunnelingOptions: []
        });
    });

    it("normalizes tunneling options without altering valid baseline fields", () => {
        const store = ServerOptionStore.instance;
        const tunnelingOption = {
            forwardPort: 18081,
            protocol: "http",
            destinationAddress: "127.0.0.1",
            keepAlive: -7
        } as any;

        expect(store.updateTunnelingOption(tunnelingOption)).toBe(true);

        const savedOption = store.getTunnelingOption(18081);
        expect(savedOption).toMatchObject({
            forwardPort: 18081,
            protocol: "http",
            destinationAddress: "127.0.0.1",
            destinationPort: 80,
            keepAlive: -1,
            inactiveOnStartup: false,
            tls: false
        });
        expect(savedOption?.httpOption?.replaceAccessControlAllowOrigin).toBe(false);
    });

    it("rejects strict control mode when the control listener is not using TLS", () => {
        const store = ServerOptionStore.instance;
        const strictOption = {
            ...store.serverOption,
            tls: false,
            controlProtocolMode: "mtls-strict" as const
        };

        expect(store.updateServerOption(strictOption)).toBe(false);
    });

    it("preserves legacy origin reflection when loading an existing http tunnel without an explicit policy", () => {
        const configFile = new File(Environment.path.configDir, "server.yaml");
        Files.writeSync(configFile, YAML.stringify({
            key: "srv-existing",
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
            tunnelingOptions: [{
                forwardPort: 18082,
                protocol: "http",
                destinationAddress: "127.0.0.1",
                destinationPort: 8080,
                keepAlive: 0
            }]
        }));

        ServerOptionStore.resetForTest();
        const store = ServerOptionStore.instance;

        expect(store.getTunnelingOption(18082)?.httpOption?.replaceAccessControlAllowOrigin).toBe(true);
    });
});
