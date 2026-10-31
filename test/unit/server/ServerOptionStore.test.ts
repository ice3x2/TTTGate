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

    // #170 — 예전 서버가 저장한 문자열 포트("18083")는 읽을 때 숫자로 바꾼다. 거절하면 업그레이드 뒤 기동하지 못한다.
    it("loads a legacy string forwardPort as a number", () => {
        const configFile = new File(Environment.path.configDir, "server.yaml");
        Files.writeSync(configFile, YAML.stringify({
            key: "srv-existing", adminPort: 9300, adminBindHost: "127.0.0.1", adminTls: true, port: 9126, tls: false,
            controlProtocolMode: "mixed", allowLegacyControlAuth: false, trustedClients: [], globalMemCacheLimit: 128, keepAlive: 10000,
            tunnelingOptions: [{forwardPort: "18083", protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 8080, keepAlive: 0}]
        }));
        ServerOptionStore.resetForTest();
        const store = ServerOptionStore.instance;
        expect(store.getTunnelingOptions().map((option) => option.forwardPort)).toEqual([18083]);
    });
});

describe("ServerOptionStore 감사 옵션 검증", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("server-option-store-audit");
        applyTestRoot(testRoot.rootDir);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    const verify = (patch: object): {result: {success: boolean, message: string}, option: any} => {
        const store = ServerOptionStore.instance;
        const option: any = {...store.serverOption, ...patch};
        return {result: store.verificationServerOption(option), option};
    };

    it("auditRetentionDays 를 생략하면 90 으로 채운다", () => {
        const {result, option} = verify({auditRetentionDays: undefined});
        expect(result.success).toBe(true);
        expect(option.auditRetentionDays).toBe(90);
    });

    it("auditRetentionDays 0 은 무제한으로 허용한다", () => {
        const {result, option} = verify({auditRetentionDays: 0});
        expect(result.success).toBe(true);
        expect(option.auditRetentionDays).toBe(0);
    });

    it("auditRetentionDays 3650 은 통과하고 3651 은 실패한다", () => {
        expect(verify({auditRetentionDays: 3650}).option.auditRetentionDays).toBe(3650);

        const over = verify({auditRetentionDays: 3651});
        expect(over.result.success).toBe(false);
        expect(over.result.message).toBe("auditRetentionDays must be 0 or an integer within 1..3650");
    });

    it("auditRetentionDays 가 정수가 아니거나 음수면 실패한다", () => {
        expect(verify({auditRetentionDays: 1.5}).result.success).toBe(false);
        expect(verify({auditRetentionDays: -1}).result.success).toBe(false);
        expect(verify({auditRetentionDays: -1}).result.message).toBe("auditRetentionDays must be 0 or an integer within 1..3650");
    });

    it("auditQueueSize 를 생략하면 1000 으로 채운다", () => {
        const {result, option} = verify({auditQueueSize: undefined});
        expect(result.success).toBe(true);
        expect(option.auditQueueSize).toBe(1000);
    });

    it("auditQueueSize 범위는 100..100000 이다", () => {
        const under = verify({auditQueueSize: 99});
        expect(under.result.success).toBe(false);
        expect(under.result.message).toBe("auditQueueSize must be an integer within 100..100000");

        expect(verify({auditQueueSize: 100000}).result.success).toBe(true);
        expect(verify({auditQueueSize: 100000}).option.auditQueueSize).toBe(100000);
        expect(verify({auditQueueSize: 100001}).result.success).toBe(false);
        expect(verify({auditQueueSize: 0}).result.success).toBe(false);
    });

    // #267 REQ-1·REQ-3 — logLevel 은 error·warn·info·debug 가운데 하나다. 없으면 info, 틀리면 저장 전에 거부한다.
    it("logLevel 을 생략하면 info 로 채우고, 허용값은 그대로 둔다", () => {
        const {result, option} = verify({logLevel: undefined});
        expect(result.success).toBe(true);
        expect(option.logLevel).toBe("info");
        expect(verify({logLevel: "debug"}).option.logLevel).toBe("debug");
    });

    // #268 REQ-1·REQ-3 — 닫기 기한. 없으면 기본값(정체 60초·FIN 10초), 범위 밖이면 저장 전에 거부한다.
    it("closeStallMs·closeGraceMs 를 생략하면 기본값으로 채운다", () => {
        const {result, option} = verify({closeStallMs: undefined, closeGraceMs: undefined});
        expect(result.success).toBe(true);
        expect(option.closeStallMs).toBe(60_000);
        expect(option.closeGraceMs).toBe(10_000);
    });

    it.each([
        ["closeStallMs", 1_000, 600_000, "closeStallMs must be an integer within 1000..600000"],
        ["closeGraceMs", 1_000, 120_000, "closeGraceMs must be an integer within 1000..120000"]
    ] as const)("%s 는 %d..%d 의 정수만 받는다", (field, min, max, message) => {
        expect(verify({[field]: min}).option[field]).toBe(min);
        expect(verify({[field]: max}).option[field]).toBe(max);
        for(const wrong of [min - 1, max + 1, 1_500.5, "60000", null]) {
            const result = verify({[field]: wrong}).result;
            expect(result.success).toBe(false);
            expect(result.message).toBe(message);
        }
    });

    it("logLevel 이 허용값이 아니면 실패한다", () => {
        const wrong = verify({logLevel: "verbose"});
        expect(wrong.result.success).toBe(false);
        expect(wrong.result.message).toBe("logLevel must be one of error, warn, info, debug");
        expect(verify({logLevel: 3}).result.success).toBe(false);
    });

    // #303 — adminAllowedOrigins 는 정확한 Origin(스킴·호스트·포트)의 목록이다. 없으면 빈 목록, 형식이 틀리면 저장 전에 거부한다.
    it("adminAllowedOrigins 를 생략하면 빈 목록이고, 올바른 Origin 은 정규화해 둔다", () => {
        expect(verify({adminAllowedOrigins: undefined}).option.adminAllowedOrigins).toEqual([]);
        const ok = verify({adminAllowedOrigins: [" https://Admin.Example.com ", "HTTPS://admin.example.com:8443/", "https://[2001:db8::7]:9300",
            "https://관리.example.com", "https://admin.example.com:443"]});
        expect(ok.result.success).toBe(true);
        expect(ok.option.adminAllowedOrigins).toEqual(["https://admin.example.com", "https://admin.example.com:8443", "https://[2001:db8::7]:9300",
            "https://xn--zb0b93v.example.com", "https://admin.example.com"]);
    });

    it("adminAllowedOrigins 의 형식이 틀리면 실패한다", () => {
        // http:// 는 받지 않는다. TLS 관리 서버의 세션 쿠키는 Secure 라서 http 페이지에서는 브라우저가 버린다.
        for(const wrong of [["http://admin.example.com"], ["http://10.0.0.5:9300"], ["https://admin.example.com/console"], ["https://*.example.com"], ["admin.example.com"], ["ftp://admin.example.com"],
            ["https://user:pw@admin.example.com"], ["https://admin.example.com?x=1"], ["https://admin.example.com#x"], ["*"], [""], [1],
            "https://admin.example.com", null]) {
            const result = verify({adminAllowedOrigins: wrong}).result;
            expect({wrong, success: result.success}).toEqual({wrong, success: false});
            expect(result.message).toMatch(/^adminAllowedOrigins /);
        }
    });
});

describe("ServerOptionStore mfaRequiredForSuperusers (#112 U4-04)", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("server-option-store-mfa");
        applyTestRoot(testRoot.rootDir);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    const normalized = (value: unknown): unknown => {
        const store = ServerOptionStore.instance;
        const option: any = {...store.serverOption, mfaRequiredForSuperusers: value};
        if(value === undefined) delete option.mfaRequiredForSuperusers;
        expect(store.verificationServerOption(option).success).toBe(true);
        return option.mfaRequiredForSuperusers;
    };

    it("생략하면 false, true 면 true, 그 밖의 값은 false 다", () => {
        expect(normalized(undefined)).toBe(false);
        expect(normalized(true)).toBe(true);
        expect(normalized("yes")).toBe(false);
        expect(normalized(1)).toBe(false);
        expect(normalized(false)).toBe(false);
    });
});
