import YAML from "yaml";
import Environment from "../../../src/Environment";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {DEFAULT_GEO_CONFIG} from "../../../src/types/TunnelingOption";
import File from "../../../src/util/File";
import LoggerFactory from "../../../src/util/logger/LoggerFactory";
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

    // #286 REQ-2 AC-3 — 틀린 차단 항목은 시작을 막지 않고 건너뛰며, 운영자가 알 수 있게 경고 로그를 남긴다.
    it("skips a broken blocklist entry at load and logs a warning only for the blocklist", () => {
        const configFile = new File(Environment.path.configDir, "server.yaml");
        Files.writeSync(configFile, YAML.stringify({
            key: "srv-connection-security-blocklist",
            adminPort: 9303,
            adminBindHost: "127.0.0.1",
            adminTls: true,
            port: 9129,
            tls: false,
            controlProtocolMode: "mixed",
            allowLegacyControlAuth: false,
            trustedClients: [],
            globalMemCacheLimit: 128,
            keepAlive: 10000,
            tunnelingOptions: [],
            // 국가 필터 경고(unknownPolicy=deny + applyToAdmin)는 저장 API 응답으로 알린다. 로드 로그에는 남기지 않는다.
            connectionSecurity: {
                geo: {mode: "deny", countries: ["KP"], applyToAdmin: true, unknownPolicy: "deny"},
                blocklist: [
                    {address: "203.0.113.7", port: null, note: "", createdAt: 1, createdBy: "admin"},
                    {address: "bogus", port: null, note: "", createdAt: 1, createdBy: "admin"}
                ]
            }
        }));
        const warn = jest.spyOn(LoggerFactory.getLogger("server", "ServerOptionStore"), "warn").mockImplementation(() => undefined);
        try {
            ServerOptionStore.resetForTest();
            const reloaded = ServerOptionStore.instance;

            expect(reloaded.loadStatus.ready).toBe(true);
            expect(reloaded.serverOption.connectionSecurity?.blocklist).toEqual(
                [{address: "203.0.113.7", port: null, note: "", createdAt: 1, createdBy: "admin"}]);
            const messages = warn.mock.calls.map((call) => String(call[0]));
            expect(messages.filter((message) => message.includes("connectionSecurity.blocklist[1]"))).toHaveLength(1);
            expect(messages.find((message) => message.includes("connectionSecurity.blocklist[1]"))).toContain("dropped at the next save");
            expect(messages.some((message) => message.includes("unknownPolicy=deny"))).toBe(false);

            // 경고대로 다음 저장 때 파일에서도 빠진다.
            const read = reloaded.readServerOption();
            if(!read.success) throw new Error("server option not ready");
            expect(reloaded.commitPreparedServerOption(read.serverOption).success).toBe(true);
            expect(YAML.parse(Files.toStringSync(configFile)).connectionSecurity.blocklist).toEqual(
                [{address: "203.0.113.7", port: null, note: "", createdAt: 1, createdBy: "admin"}]);
        } finally {
            warn.mockRestore();
        }
    });

    // #286 REQ-3 AC-2 — 터널이 없는 포트에 건 항목은 나중에 그 포트로 만든 다른 터널에 걸리므로 읽을 때 뺀다.
    it("drops a port-scoped blocklist entry whose tunnel does not exist, with a warning", () => {
        const configFile = new File(Environment.path.configDir, "server.yaml");
        Files.writeSync(configFile, YAML.stringify({
            key: "srv-connection-security-orphan",
            adminPort: 9304,
            adminBindHost: "127.0.0.1",
            adminTls: true,
            port: 9130,
            tls: false,
            controlProtocolMode: "mixed",
            allowLegacyControlAuth: false,
            trustedClients: [],
            globalMemCacheLimit: 128,
            keepAlive: 10000,
            tunnelingOptions: [{forwardPort: 20500, protocol: "tcp", tls: false, destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0}],
            connectionSecurity: {blocklist: [
                {address: "203.0.113.7", port: 20500, note: "", createdAt: 1, createdBy: "admin"},
                {address: "203.0.113.8", port: 7777, note: "", createdAt: 1, createdBy: "admin"},
                {address: "203.0.113.9", port: null, note: "", createdAt: 1, createdBy: "admin"}
            ]}
        }));
        const warn = jest.spyOn(LoggerFactory.getLogger("server", "ServerOptionStore"), "warn").mockImplementation(() => undefined);
        try {
            ServerOptionStore.resetForTest();
            const reloaded = ServerOptionStore.instance;
            expect(reloaded.loadStatus.ready).toBe(true);
            expect(reloaded.serverOption.connectionSecurity?.blocklist?.map((entry) => entry.address)).toEqual(["203.0.113.7", "203.0.113.9"]);
            expect(warn.mock.calls.map((call) => String(call[0])).filter((message) => message.includes("no tunnel uses port 7777"))).toHaveLength(1);
        } finally {
            warn.mockRestore();
        }
    });
});
