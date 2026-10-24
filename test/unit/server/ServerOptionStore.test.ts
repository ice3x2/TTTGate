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

    it("logLevel 이 허용값이 아니면 실패한다", () => {
        const wrong = verify({logLevel: "verbose"});
        expect(wrong.result.success).toBe(false);
        expect(wrong.result.message).toBe("logLevel must be one of error, warn, info, debug");
        expect(verify({logLevel: 3}).result.success).toBe(false);
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
