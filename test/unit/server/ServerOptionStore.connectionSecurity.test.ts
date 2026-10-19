import YAML from "yaml";
import Environment from "../../../src/Environment";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {DEFAULT_GEO_CONFIG} from "../../../src/types/TunnelingOption";
import File from "../../../src/util/File";
import Files from "../../../src/util/Files";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

describe("ServerOptionStore connectionSecurity normalization", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("server-option-store-connection-security");
        applyTestRoot(testRoot.rootDir);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    it("defaults connectionSecurity.geo when server.yaml has none", () => {
        const configFile = new File(Environment.path.configDir, "server.yaml");
        Files.writeSync(configFile, YAML.stringify({
            key: "srv-connection-security-default",
            adminPort: 9302,
            adminBindHost: "127.0.0.1",
            adminTls: true,
            port: 9128,
            tls: false,
            controlProtocolMode: "mixed",
            allowLegacyControlAuth: false,
            trustedClients: [],
            globalMemCacheLimit: 128,
            keepAlive: 10000,
            tunnelingOptions: []
        }));

        ServerOptionStore.resetForTest();
        const reloaded = ServerOptionStore.instance;

        expect(reloaded.loadStatus.ready).toBe(true);
        expect(reloaded.serverOption.connectionSecurity?.geo).toEqual(DEFAULT_GEO_CONFIG);
    });

    it("fails to load a server.yaml with an invalid connectionSecurity (allow mode, no countries)", () => {
        const configFile = new File(Environment.path.configDir, "server.yaml");
        Files.writeSync(configFile, YAML.stringify({
            key: "srv-connection-security",
            adminPort: 9301,
            adminBindHost: "127.0.0.1",
            adminTls: true,
            port: 9127,
            tls: false,
            controlProtocolMode: "mixed",
            allowLegacyControlAuth: false,
            trustedClients: [],
            globalMemCacheLimit: 128,
            keepAlive: 10000,
            tunnelingOptions: [],
            connectionSecurity: {geo: {mode: "allow", countries: []}}
        }));

        ServerOptionStore.resetForTest();
        const reloaded = ServerOptionStore.instance;

        expect(reloaded.readServerOption().success).toBe(false);
    });

    it("normalizes connectionSecurity.geo.countries through verificationServerOption", () => {
        const store = ServerOptionStore.instance;
        const candidate = {
            ...store.serverOption,
            connectionSecurity: {geo: {mode: "deny", countries: ["kr"]}}
        } as any;

        const result = store.verificationServerOption(candidate);
        expect(result.success).toBe(true);
        expect(result.serverOption!.connectionSecurity!.geo.countries).toEqual(["KR"]);
    });
});
