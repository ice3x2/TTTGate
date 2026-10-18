import {isIP} from "net";
import {ServerOption} from "../types/TunnelingOption";
import {normalizeBooleanOption, SimpleCliOptions} from "./ServerCliOptions";

const LEGACY_ADMIN_HTTP_FLAG = "allowLegacyAdminHttp";
const LEGACY_ADMIN_REMOTE_FLAG = "allowLegacyAdminRemote";

type AdminSecurityAllowances = {
    allowLegacyAdminHttp: boolean;
    allowLegacyAdminRemote: boolean;
    // P5-T2 / REQ-07: X-Forwarded-For 신뢰 정책. 기본 false.
    // true 로 설정된 환경(역방향 프록시 뒤)에서만 XFF 를 클라이언트 주소로 사용한다.
    trustXForwardedFor: boolean;
    // #178: 관리 서버 앞의 신뢰 프록시 수. XFF 의 최우측에서 이만큼 건너뛴 값을 쓴다(최좌측은 클라이언트가 고른다). 기본 1.
    trustedProxyHops: number;
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
    trustedProxyHops: 1,
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

const MAX_TRUSTED_PROXY_HOPS = 16;

const parseProxyHops = (value: unknown): number | undefined => {
    const hops = typeof value === 'number' ? value : (/^\d+$/.test(String(value ?? '').trim()) ? Number(String(value).trim()) : NaN);
    return Number.isSafeInteger(hops) && hops >= 1 && hops <= MAX_TRUSTED_PROXY_HOPS ? hops : undefined;
};

const normalizeProxyHops = (value: unknown): number => parseProxyHops(value) ?? DEFAULT_ALLOWANCES.trustedProxyHops;

/** -trustedProxyHops 가 잘못되었거나 -trustXForwardedFor 없이 쓰였으면 기동 경고 문구를 돌려준다. */
const trustedProxyHopsCliWarning = (options: SimpleCliOptions): string | undefined => {
    const raw = options["trustedProxyHops"];
    if(raw === undefined) return undefined;
    if(parseProxyHops(raw) === undefined) {
        return `-trustedProxyHops must be an integer from 1 to ${MAX_TRUSTED_PROXY_HOPS} (got: ${String(raw).slice(0, 32)}); using ${DEFAULT_ALLOWANCES.trustedProxyHops}`;
    }
    if(normalizeBooleanOption(options["trustXForwardedFor"]) !== true) {
        return '-trustedProxyHops has no effect without -trustXForwardedFor';
    }
    return undefined;
};

/**
 * 신뢰 프록시가 붙인 XFF 값에서 클라이언트 주소를 고른다(#178).
 * 프록시마다 받은 연결의 주소를 오른쪽에 붙이므로, 최우측에서 hop 수만큼 건너뛴 값이 마지막 신뢰 프록시가 본 주소다.
 * 그보다 왼쪽은 클라이언트가 마음대로 넣을 수 있다. 값이 hop 수보다 적거나 IP 형식이 아니면 undefined 를 돌려
 * 소켓 주소를 쓰게 한다. 아무 문자열이나 받으면 요청마다 바꿔 로그인 차단 버킷을 새로 만들 수 있다(#171).
 */
const clientAddressFromForwardedFor = (header: string | string[] | undefined, hops: number): string | undefined => {
    // Node 는 같은 헤더의 여러 줄을 ", " 로 이어 문자열로 준다. 배열이 오더라도 순서대로 이어 읽는다.
    const raw = Array.isArray(header) ? header.join(',') : header;
    if(typeof raw !== 'string' || raw.length === 0) return undefined;
    const entries = raw.split(',').map((entry) => entry.trim());
    const picked = entries.length >= hops ? entries[entries.length - hops] : undefined;
    // 일부 프록시는 포트를 붙인다(1.2.3.4:5678, [2001:db8::1]:443). 포트와 대괄호를 벗긴 뒤 검사한다.
    const host = picked?.replace(/^\[([^\]]+)\](?::\d+)?$/, '$1').replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, '$1');
    return host && host.length <= 64 && isIP(host) !== 0 ? host : undefined;
};

const buildAdminSecurityAllowancesFromCliOptions = (options: SimpleCliOptions): AdminSecurityAllowances => {
    return {
        allowLegacyAdminHttp: normalizeBooleanOption(options[LEGACY_ADMIN_HTTP_FLAG]) === true,
        allowLegacyAdminRemote: normalizeBooleanOption(options[LEGACY_ADMIN_REMOTE_FLAG]) === true,
        // P5-T2 / REQ-07: 기본 false — 역방향 프록시 환경에서만 명시적으로 true 로 설정해야 한다.
        trustXForwardedFor: normalizeBooleanOption(options["trustXForwardedFor"]) === true,
        trustedProxyHops: normalizeProxyHops(options["trustedProxyHops"]),
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
    if(allowances.trustXForwardedFor) {
        // hop 수가 실제 프록시 수보다 크면 클라이언트가 고른 값을, 작으면 프록시 주소 하나를 모두가 같이 쓴다(#178).
        warnings.push(`trustXForwardedFor is on: the admin client address is entry ${allowances.trustedProxyHops} from the right of X-Forwarded-For. `
            + 'Set -trustedProxyHops to the exact number of proxies and let only the proxy reach the admin port.');
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
        activeAllowances.trustedProxyHops = normalizeProxyHops(activeAllowances.trustedProxyHops);
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
    clientAddressFromForwardedFor,
    trustedProxyHopsCliWarning,
    evaluateAdminSecurityPolicy,
    formatAdminSecurityPolicyErrors,
    isLoopbackAdminHost
};
