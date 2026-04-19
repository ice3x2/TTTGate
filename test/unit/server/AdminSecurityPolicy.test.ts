import {
    AdminSecurityPolicyRegistry,
    buildAdminSecurityAllowancesFromCliOptions,
    evaluateAdminSecurityPolicy,
    formatAdminSecurityPolicyErrors,
    isLoopbackAdminHost,
    LEGACY_ADMIN_HTTP_FLAG,
    LEGACY_ADMIN_REMOTE_FLAG
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

        expect(allowances).toEqual({
            allowLegacyAdminHttp: false,
            allowLegacyAdminRemote: true
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
