import {ServerOption} from "../types/TunnelingOption";
import {normalizeBooleanOption, SimpleCliOptions} from "./ServerCliOptions";

const LEGACY_ADMIN_HTTP_FLAG = "allowLegacyAdminHttp";
const LEGACY_ADMIN_REMOTE_FLAG = "allowLegacyAdminRemote";

type AdminSecurityAllowances = {
    allowLegacyAdminHttp: boolean;
    allowLegacyAdminRemote: boolean;
    // P5-T2 / REQ-07: X-Forwarded-For 신뢰 정책. 기본 false.
    // true 로 설정된 환경(역방향 프록시 뒤)에서만 XFF 최좌측 IP를 클라이언트 주소로 사용.
    trustXForwardedFor: boolean;
    // P5-T4 / REQ-12: CSRF 헤더(X-CSRF-Token) 강제 여부. 기본 true.
    requireCsrfHeader: boolean;
}

type AdminSecurityPolicyDecision = {
    allowed: boolean;
    insecureHttp: boolean;
    insecureBind: boolean;
    requiredFlags: string[];
    missingFlags: string[];
    warnings: string[];
    errors: string[];
}

const DEFAULT_ALLOWANCES: AdminSecurityAllowances = {
    allowLegacyAdminHttp: false,
    allowLegacyAdminRemote: false,
    trustXForwardedFor: false,
    requireCsrfHeader: true
};

let activeAllowances: AdminSecurityAllowances = {...DEFAULT_ALLOWANCES};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const normalizeHost = (host?: string): string | undefined => {
    if(host == undefined) {
        return undefined;
    }
    const trimmed = host.trim().toLowerCase();
    if(trimmed.length == 0) {
        return undefined;
    }
    if(trimmed.startsWith("[") && trimmed.endsWith("]")) {
        return trimmed.substring(1, trimmed.length - 1);
    }
    return trimmed;
};

const isLoopbackAdminHost = (host?: string): boolean => {
    const normalized = normalizeHost(host);
    if(normalized == undefined) {
        return false;
    }
    return LOOPBACK_HOSTS.has(normalized);
};

const buildAdminSecurityAllowancesFromCliOptions = (options: SimpleCliOptions): AdminSecurityAllowances => {
    return {
        allowLegacyAdminHttp: normalizeBooleanOption(options[LEGACY_ADMIN_HTTP_FLAG]) === true,
        allowLegacyAdminRemote: normalizeBooleanOption(options[LEGACY_ADMIN_REMOTE_FLAG]) === true,
        // P5-T2 / REQ-07: 기본 false — 역방향 프록시 환경에서만 명시적으로 true 로 설정해야 한다.
        trustXForwardedFor: normalizeBooleanOption(options["trustXForwardedFor"]) === true,
        // P5-T4 / REQ-12: 기본 true — 상태 변경 API 에 CSRF 토큰 헤더 강제.
        requireCsrfHeader: normalizeBooleanOption(options["requireCsrfHeader"]) !== false
    };
};

const evaluateAdminSecurityPolicy = (
    serverOption: ServerOption,
    allowances: AdminSecurityAllowances = activeAllowances
): AdminSecurityPolicyDecision => {
    const insecureHttp = serverOption.adminTls !== true;
    const insecureBind = !isLoopbackAdminHost(serverOption.adminBindHost);
    const requiredFlags: string[] = [];
    const missingFlags: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    if(insecureHttp) {
        requiredFlags.push(LEGACY_ADMIN_HTTP_FLAG);
        if(!allowances.allowLegacyAdminHttp) {
            missingFlags.push(LEGACY_ADMIN_HTTP_FLAG);
            errors.push("admin TLS is disabled");
        }
    }

    if(insecureBind) {
        requiredFlags.push(LEGACY_ADMIN_REMOTE_FLAG);
        if(!allowances.allowLegacyAdminRemote) {
            missingFlags.push(LEGACY_ADMIN_REMOTE_FLAG);
            errors.push(`admin bind host is not loopback (${serverOption.adminBindHost ?? "*"})`);
        }
    }

    if(requiredFlags.length > 0 && missingFlags.length == 0) {
        warnings.push(`legacy admin mode enabled via ${requiredFlags.map((flag) => `-${flag}`).join(", ")}`);
    }

    return {
        allowed: missingFlags.length == 0,
        insecureHttp,
        insecureBind,
        requiredFlags,
        missingFlags,
        warnings,
        errors
    };
};

const formatAdminSecurityPolicyErrors = (decision: AdminSecurityPolicyDecision): string => {
    const reasons = decision.errors.join(", ");
    const flags = decision.missingFlags.map((flag) => `-${flag}`).join(" ");
    return `Refusing insecure admin policy: ${reasons}. Configure loopback HTTPS or start once with explicit legacy flags: ${flags}`;
};

const AdminSecurityPolicyRegistry = {
    current(): AdminSecurityAllowances {
        return {...activeAllowances};
    },
    configure(allowances: Partial<AdminSecurityAllowances>): void {
        activeAllowances = {
            ...DEFAULT_ALLOWANCES,
            ...allowances
        };
    },
    reset(): void {
        activeAllowances = {...DEFAULT_ALLOWANCES};
    }
};

export {
    AdminSecurityAllowances,
    AdminSecurityPolicyDecision,
    AdminSecurityPolicyRegistry,
    LEGACY_ADMIN_HTTP_FLAG,
    LEGACY_ADMIN_REMOTE_FLAG,
    buildAdminSecurityAllowancesFromCliOptions,
    evaluateAdminSecurityPolicy,
    formatAdminSecurityPolicyErrors,
    isLoopbackAdminHost
};
