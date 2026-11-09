import YAML from "yaml";
import Environment from "../../../src/Environment";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {resolveTunnelName} from "../../../src/types/TunnelingOption";
import File from "../../../src/util/File";
import Files from "../../../src/util/Files";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

// #338 REQ-4 — 터널 이름(선택). 앞뒤 공백을 뺀 1~40 코드 포인트, 제어·방향 제어 문자 금지.

describe("resolveTunnelName", () => {
    it.each([
        ["  nas-web ", "nas-web"],
        ["집 NAS", "집 NAS"],
        ["x".repeat(40), "x".repeat(40)],
        ["😀".repeat(40), "😀".repeat(40)],
    ])("%p → %p", (value, name) => {
        expect(resolveTunnelName(value)).toEqual({success: true, name});
    });

    it.each([[undefined], [""], ["   "]])("%p 은 이름 없음이다", (value) => {
        expect(resolveTunnelName(value)).toEqual({success: true, name: undefined});
    });

    it.each([
        ["41자", "x".repeat(41)],
        ["숫자", 42],
        ["줄바꿈", "a\nb"],
        ["NUL", "a\u0000b"],
        ["C1 제어 문자", "a\u0085b"],
        ["DEL", "a\u007fb"],
        ["RLO", "evil‮txt"],
        ["LRI", "a⁦b"],
    ])("%s 이면 거절한다", (_label, value) => {
        expect(resolveTunnelName(value)).toMatchObject({success: false});
    });
});

describe("ServerOptionStore tunnel name", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("server-option-store-tunnel-name");
        applyTestRoot(testRoot.rootDir);
        ServerOptionStore.resetForTest();
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    const tunnel = (overrides: Record<string, unknown> = {}) => ({
        forwardPort: 18190, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: -1, ...overrides
    } as any);

    it("이름을 다듬어 저장한다", () => {
        const store = ServerOptionStore.instance;
        expect(store.updateTunnelingOption(tunnel({name: "  nas-web  "}))).toBe(true);
        expect(store.getTunnelingOption(18190)?.name).toBe("nas-web");
    });

    it("빈 이름은 필드를 지운다", () => {
        const store = ServerOptionStore.instance;
        expect(store.updateTunnelingOption(tunnel({name: "  "}))).toBe(true);
        expect(store.getTunnelingOption(18190)).not.toHaveProperty("name");
    });

    it("새 설정의 형식이 틀린 이름은 거절한다", () => {
        const store = ServerOptionStore.instance;
        const result = store.verificationTunnelingOption(tunnel({name: "x".repeat(41)}));
        expect(result).toMatchObject({success: false, message: "name must be 1 to 40 characters without control characters"});
    });

    it("server.yaml 의 형식이 틀린 이름은 버리고 경고하며, 설정은 읽는다", () => {
        const configFile = new File(Environment.path.configDir, "server.yaml");
        Files.writeSync(configFile, YAML.stringify({
            key: "srv-tunnel-name", adminPort: 9300, adminBindHost: "127.0.0.1", adminTls: true, port: 9126, tls: false,
            controlProtocolMode: "mixed", allowLegacyControlAuth: false, trustedClients: [], globalMemCacheLimit: 128, keepAlive: 10000,
            tunnelingOptions: [
                tunnel({forwardPort: 18191, name: "bad‮name"}),
                tunnel({forwardPort: 18192, name: "good"})
            ]
        }));
        ServerOptionStore.resetForTest();
        const reloaded = ServerOptionStore.instance;
        expect(reloaded.loadStatus.ready).toBe(true);
        expect(reloaded.getTunnelingOption(18191)).not.toHaveProperty("name");
        expect(reloaded.getTunnelingOption(18192)?.name).toBe("good");
    });
});
