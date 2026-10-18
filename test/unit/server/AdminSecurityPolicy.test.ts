import {
    AdminSecurityPolicyRegistry,
    buildAdminSecurityAllowancesFromCliOptions,
    clientAddressFromForwardedFor,
    evaluateAdminSecurityPolicy,
    formatAdminSecurityPolicyErrors,
    isLoopbackAdminHost,
    LEGACY_ADMIN_HTTP_FLAG,
    LEGACY_ADMIN_REMOTE_FLAG,
    trustedProxyHopsCliWarning
} from "../../../src/server/AdminSecurityPolicy";
import {ServerOption} from "../../../src/types/TunnelingOption";

const createServerOption = (): ServerOption => ({
    key: "hello-TTTGate",
    adminPort: 9300,
    adminBindHost: "127.0.0.1",
    adminTls: true,
    port: 9126,
    tls: false,
    tunnelingOptions: [],
    keepAlive: 0
});

describe("AdminSecurityPolicy", () => {
    afterEach(() => {
        AdminSecurityPolicyRegistry.reset();
    });

    it("allows the secure default admin policy without legacy flags", () => {
        const decision = evaluateAdminSecurityPolicy(createServerOption());

        expect(decision.allowed).toBe(true);
        expect(decision.requiredFlags).toEqual([]);
    });

    it("rejects insecure admin http and remote bind until explicit legacy flags are present", () => {
        const option = createServerOption();
        option.adminTls = false;
        option.adminBindHost = "0.0.0.0";

        const decision = evaluateAdminSecurityPolicy(option);

        expect(decision.allowed).toBe(false);
        expect(decision.missingFlags).toEqual([LEGACY_ADMIN_HTTP_FLAG, LEGACY_ADMIN_REMOTE_FLAG]);
        expect(formatAdminSecurityPolicyErrors(decision)).toContain(`-${LEGACY_ADMIN_HTTP_FLAG}`);
        expect(formatAdminSecurityPolicyErrors(decision)).toContain(`-${LEGACY_ADMIN_REMOTE_FLAG}`);
    });

    it("allows insecure legacy admin policy only when the exact flags are enabled", () => {
        const option = createServerOption();
        option.adminTls = false;
        option.adminBindHost = "0.0.0.0";
        AdminSecurityPolicyRegistry.configure({
            allowLegacyAdminHttp: true,
            allowLegacyAdminRemote: true
        });

        const decision = evaluateAdminSecurityPolicy(option);

        expect(decision.allowed).toBe(true);
        expect(decision.warnings[0]).toContain(`-${LEGACY_ADMIN_HTTP_FLAG}`);
        expect(decision.warnings[0]).toContain(`-${LEGACY_ADMIN_REMOTE_FLAG}`);
    });

    it("builds legacy allowances from cli options and treats undefined host as remote bind", () => {
        const option = createServerOption();
        delete option.adminBindHost;

        const allowances = buildAdminSecurityAllowancesFromCliOptions({
            [LEGACY_ADMIN_REMOTE_FLAG]: "",
            [LEGACY_ADMIN_HTTP_FLAG]: "false"
        });
        const decision = evaluateAdminSecurityPolicy(option, allowances);

        // P5-T2/P5-T4: allowances 객체에 trustXForwardedFor(기본 false) 및 requireCsrfHeader(기본 true) 필드가 포함된다.
        expect(allowances).toEqual({
            allowLegacyAdminHttp: false,
            allowLegacyAdminRemote: true,
            trustXForwardedFor: false,
            trustedProxyHops: 1,
            requireCsrfHeader: true
        });
        expect(decision.allowed).toBe(true);
        expect(decision.insecureBind).toBe(true);
    });

    it("recognizes supported loopback host variants", () => {
        expect(isLoopbackAdminHost("127.0.0.1")).toBe(true);
        expect(isLoopbackAdminHost("localhost")).toBe(true);
        expect(isLoopbackAdminHost("[::1]")).toBe(true);
        expect(isLoopbackAdminHost("0.0.0.0")).toBe(false);
        expect(isLoopbackAdminHost(undefined)).toBe(false);
    });
});

// #178 — 신뢰 프록시가 붙인 값만 쓴다. 왼쪽은 클라이언트가 마음대로 넣는다.
describe("clientAddressFromForwardedFor", () => {
    test.each([
        ["one hop takes the rightmost entry", "10.0.0.1, 203.0.113.9", 1, "203.0.113.9"],
        ["two hops take the second entry from the right", "10.0.0.1, 203.0.113.9, 198.51.100.1", 2, "203.0.113.9"],
        ["more hops than entries falls back", "203.0.113.9", 2, undefined],
        ["an empty trailing entry is not an address", "203.0.113.9,", 1, undefined],
        ["spaces are trimmed", "  10.0.0.1 ,  203.0.113.9  ", 1, "203.0.113.9"],
        ["a port on IPv4 is stripped", "203.0.113.9:5678", 1, "203.0.113.9"],
        ["brackets and port on IPv6 are stripped", "[2001:db8::1]:443", 1, "2001:db8::1"],
        ["a non-address falls back", "not-an-ip", 1, undefined],
        ["an empty header falls back", "", 1, undefined],
        ["no header falls back", undefined, 1, undefined],
    ])("%s", (_name, header, hops, expected) => {
        expect(clientAddressFromForwardedFor(header as string | undefined, hops as number)).toBe(expected);
    });

    it("reads repeated header lines in order", () => {
        expect(clientAddressFromForwardedFor(["10.0.0.1", "203.0.113.9"], 1)).toBe("203.0.113.9");
    });
});

describe("trusted proxy hops options (#178)", () => {
    afterEach(() => AdminSecurityPolicyRegistry.reset());

    it("reads -trustedProxyHops and falls back to 1 for invalid values", () => {
        expect(buildAdminSecurityAllowancesFromCliOptions({trustXForwardedFor: "", trustedProxyHops: "2"}).trustedProxyHops).toBe(2);
        for(const value of ["0", "17", "abc", "2x", "-1"]) {
            expect(buildAdminSecurityAllowancesFromCliOptions({trustedProxyHops: value}).trustedProxyHops).toBe(1);
        }
    });

    it("warns about an invalid value or a value without -trustXForwardedFor", () => {
        expect(trustedProxyHopsCliWarning({})).toBeUndefined();
        expect(trustedProxyHopsCliWarning({trustXForwardedFor: "", trustedProxyHops: "2"})).toBeUndefined();
        expect(trustedProxyHopsCliWarning({trustXForwardedFor: "", trustedProxyHops: "abc"})).toContain("must be an integer");
        expect(trustedProxyHopsCliWarning({trustedProxyHops: "2"})).toContain("no effect without -trustXForwardedFor");
    });

    it("startup warnings state the hop count while XFF is trusted", () => {
        const option = createServerOption();
        const allowances = {...AdminSecurityPolicyRegistry.current(), trustXForwardedFor: true, trustedProxyHops: 2};
        expect(evaluateAdminSecurityPolicy(option, allowances).warnings.join("\n")).toContain("entry 2 from the right");
        expect(evaluateAdminSecurityPolicy(option, {...allowances, trustXForwardedFor: false}).warnings.join("\n")).not.toContain("X-Forwarded-For");
    });
});
