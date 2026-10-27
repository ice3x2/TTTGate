import YAML from "yaml";
import Environment from "../../../src/Environment";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {DEFAULT_SESSION_TTL_MS, defaultRateLimit} from "../../../src/types/TunnelingOption";
import File from "../../../src/util/File";
import Files from "../../../src/util/Files";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

// #182 — main(운영 버전)에는 속도 제한과 세션 유휴 TTL 이 없다. 그 설정 파일을 불러오면 두 동작은 꺼진 채여야
// 업그레이드만으로 잘 되던 터널이 끊기지 않는다. 새로 만드는 설정은 지금처럼 켜진다.
const legacyYaml = (extra: Record<string, unknown> = {}, tunnelExtra: Record<string, unknown> = {}) => YAML.stringify({
    key: "srv-legacy-defaults", adminPort: 9300, adminBindHost: "127.0.0.1", adminTls: true, port: 9126, tls: false,
    // 이전 버전(main) 형식: controlProtocolMode·allowLegacyControlAuth 키가 없다.
    trustedClients: [], globalMemCacheLimit: 128, keepAlive: 10000,
    tunnelingOptions: [
        {forwardPort: 18192, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: -1, ...tunnelExtra},
        {forwardPort: 18193, protocol: "http", destinationAddress: "127.0.0.1", keepAlive: -1, ...tunnelExtra},
    ],
    ...extra,
});

describe("legacy configuration keeps the previous behaviour (#182)", () => {
    let testRoot: TestRoot;
    beforeEach(async () => { testRoot = await createTestRoot("legacy-defaults-182"); applyTestRoot(testRoot.rootDir); });
    afterEach(async () => { await cleanupTestRoot(testRoot); });

    const load = (text: string) => {
        Files.writeSync(new File(Environment.path.configDir, "server.yaml"), text);
        ServerOptionStore.resetForTest();
        const store = ServerOptionStore.instance;
        expect(store.loadStatus.ready).toBe(true);
        return store;
    };

    it("keeps rate limiting off for loaded tunnels without a rateLimit field, with protocol defaults ready to switch on", () => {
        const store = load(legacyYaml());
        expect(store.getTunnelingOption(18192)?.rateLimit).toEqual({...defaultRateLimit("tcp"), enabled: false});
        expect(store.getTunnelingOption(18193)?.rateLimit).toEqual({...defaultRateLimit("http"), enabled: false});
    });

    // 이슈 280: 값이 없는 설정 파일의 터널은 대상 서버의 인증서를 지금처럼 검증한다.
    it("reads a tunnel without allowSelfSignedDestinationCert as verifying the destination certificate", () => {
        const store = load(legacyYaml());
        expect(store.getTunnelingOption(18192)?.allowSelfSignedDestinationCert).toBe(false);
        expect(load(legacyYaml({}, {allowSelfSignedDestinationCert: true})).getTunnelingOption(18192)?.allowSelfSignedDestinationCert).toBe(true);
    });

    it("keeps the session idle TTL off when the loaded file has no sessionTtlMs", () => {
        expect(load(legacyYaml()).serverOption.sessionTtlMs).toBe(0);
    });

    it("honours values that the file sets explicitly", () => {
        const store = load(legacyYaml({sessionTtlMs: 60_000}, {rateLimit: {enabled: true, windowMs: 60_000, maxConnections: 50, banMs: 60_000}}));
        expect(store.serverOption.sessionTtlMs).toBe(60_000);
        expect(store.getTunnelingOption(18192)?.rateLimit).toMatchObject({enabled: true, maxConnections: 50});
    });

    it("loads an unlimited server buffer (-1, 0) from an earlier version as the default instead of refusing to start", () => {
        const store = load(YAML.stringify({...YAML.parse(legacyYaml()), tunnelingOptions: [
            {forwardPort: 18195, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: -1, bufferLimitOnServer: -1},
            {forwardPort: 18196, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: -1, bufferLimitOnServer: 0},
        ]}));
        expect(store.getTunnelingOption(18195)?.bufferLimitOnServer).toBe(8);
        expect(store.getTunnelingOption(18196)?.bufferLimitOnServer).toBe(8);
    });

    it("keeps an earlier tunnel's rate limit off and this version's tunnel on across a save and a restart", () => {
        const store = load(legacyYaml());
        expect(store.updateTunnelingOption({forwardPort: 18197, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: -1} as any)).toBe(true);
        ServerOptionStore.resetForTest();
        const restarted = ServerOptionStore.instance;
        expect(restarted.loadStatus.ready).toBe(true);
        expect(restarted.getTunnelingOption(18192)?.rateLimit?.enabled).toBe(false);
        expect(restarted.getTunnelingOption(18197)?.rateLimit?.enabled).toBe(true);
        expect(restarted.serverOption.sessionTtlMs).toBe(0);
    });

    it("applies the current defaults to a file in this version's format that omits the values", () => {
        const store = load(YAML.stringify({...YAML.parse(legacyYaml()), controlProtocolMode: "mixed", allowLegacyControlAuth: false}));
        expect(store.getTunnelingOption(18192)?.rateLimit).toEqual(defaultRateLimit("tcp"));
        expect(store.serverOption.sessionTtlMs).toBe(DEFAULT_SESSION_TTL_MS);
    });

    it("still enables both for new tunnels and new installations", () => {
        ServerOptionStore.resetForTest();
        const store = ServerOptionStore.instance;
        expect(store.serverOption.sessionTtlMs).toBe(DEFAULT_SESSION_TTL_MS);
        expect(store.updateTunnelingOption({forwardPort: 18194, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: -1} as any)).toBe(true);
        expect(store.getTunnelingOption(18194)?.rateLimit).toEqual(defaultRateLimit("tcp"));
    });
});
