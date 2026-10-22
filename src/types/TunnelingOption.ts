


type Protocol = "tcp" | "http" | "https";
type ControlProtocolMode = "legacy" | "mixed" | "mtls-strict";
type CustomHeader = {
    name: string;
    value: string;
    replace: boolean;
}

type RewriteRule = {
    from: string;
    to: string;
}

type HttpOption = {
    rewriteHostInTextBody?: boolean;
    customRequestHeaders?: Array<CustomHeader>;
    customResponseHeaders?: Array<CustomHeader>;
    bodyRewriteRules?: Array<RewriteRule>;
    replaceAccessControlAllowOrigin?: boolean;
    keepAliveTimeout?: number;
}


type ClientOption = {
    key : string,
    host : string,
    port : number,
    tls : boolean,
    name : string,
    clientId?: string,
    clientSecret?: string,
    displayName?: string,
    ca?: string,
    cert?: string,
    privateKey?: string,
    serverName?: string,
    allowLegacyFallback?: boolean,
    allowInsecureTls?: boolean,
    globalMemCacheLimit: number,
    keepAlive: number
}

type TrustedClient = {
    clientId: string;
    clientSecret: string;
    displayName?: string;
}

type ServerOption = {
    sessionTtlMs?: number,
    key: string,
    adminPort?: number,
    adminBindHost?: string,
    adminTls?: boolean,
    /** #112 (U4-04) 슈퍼유저 MFA 강제. 기본 false. */
    mfaRequiredForSuperusers?: boolean,
    port: number,
    tls : boolean,
    controlProtocolMode?: ControlProtocolMode,
    allowLegacyControlAuth?: boolean,
    trustedClients?: Array<TrustedClient>,
    tunnelingOptions: Array<TunnelingOption>,
    globalMemCacheLimit?: number
    keepAlive: number,
    connectionSecurity?: ConnectionSecurityOption,
    /** 감사 파일 보존 기간(일). 기본 90, 0 이면 무제한. */
    auditRetentionDays?: number,
    /** 감사 쓰기 큐 상한. 기본 1000. 가득 차면 CUD API 가 503 으로 실패한다. */
    auditQueueSize?: number


}


type TunnelingOption = {
    forwardPort: number,
    protocol?: Protocol,
    httpOption?: HttpOption,
    destinationAddress: string,
    destinationPort?: number;
    allowedClientNames?: Array<string>;
    allowedClientIds?: Array<string>;
    inactiveOnStartup?: boolean;
    tls?: boolean,
    bufferLimitOnServer?: number,
    bufferLimitOnClient?: number,
    keepAlive: number,
    rateLimit?: RateLimitOption,
    /** 소유자 사용자 id 또는 'system:migrated'. 없으면 system:migrated 로 해석한다(#100 U2-08). */
    ownerId?: string
}

const DEFAULT_KEY = "hello-TTTGate";

/**
 * U5-03 / #118 — 국가 필터(geo) 설정.
 *
 * D10: 국가 허용·차단 목록은 서버 전역 하나이며 관리자 페이지에도 적용된다.
 */
type GeoMode = 'off' | 'allow' | 'deny';
type GeoConfig = {mode: GeoMode; countries: string[]; applyToAdmin: boolean; unknownPolicy: 'allow' | 'deny'};
type ConnectionSecurityOption = {geo: GeoConfig};
const DEFAULT_GEO_CONFIG: Readonly<GeoConfig> = Object.freeze({mode: 'off', countries: [], applyToAdmin: true, unknownPolicy: 'allow'});

/**
 * U5-02 / #117 — 터널 레이트 리밋 옵션.
 *
 * D9: 모든 터널은 프로토콜별 기본값으로 레이트 리밋을 켠 채 기동한다.
 * TCP는 60초/30회/10분 차단, HTTP·HTTPS는 60초/300회/10분 차단.
 */
type RateLimitOption = {enabled: boolean; windowMs: number; maxConnections: number; banMs: number; customized: boolean};

const RATE_LIMIT_RANGE = {
    windowMs: [1000, 3_600_000],
    maxConnections: [1, 100_000],
    banMs: [1000, 86_400_000]
} as const;

const RATE_LIMIT_DEFAULTS_BY_PROTOCOL: {tcp: {windowMs: number; maxConnections: number; banMs: number}, http: {windowMs: number; maxConnections: number; banMs: number}} = {
    tcp: {windowMs: 60000, maxConnections: 30, banMs: 600000},
    http: {windowMs: 60000, maxConnections: 300, banMs: 600000}
};

const defaultRateLimit = (protocol: Protocol | undefined): RateLimitOption => {
    const base = protocol === 'http' || protocol === 'https' ? RATE_LIMIT_DEFAULTS_BY_PROTOCOL.http : RATE_LIMIT_DEFAULTS_BY_PROTOCOL.tcp;
    return {enabled: true, ...base, customized: false};
};

const normalizeRateLimit = (protocol: Protocol | undefined, input: unknown):
    {success: true; rateLimit: RateLimitOption} | {success: false; message: string} => {
    const fallback = defaultRateLimit(protocol);
    if(input === undefined) {
        return {success: true, rateLimit: fallback};
    }
    if(typeof input !== 'object' || input === null || Array.isArray(input)) {
        return {success: false, message: 'rateLimit must be an object'};
    }
    const source = input as Record<string, unknown>;

    let enabled = fallback.enabled;
    if(source.enabled !== undefined) {
        if(typeof source.enabled !== 'boolean') return {success: false, message: 'rateLimit.enabled must be boolean'};
        enabled = source.enabled;
    }

    const numbers = {windowMs: fallback.windowMs, maxConnections: fallback.maxConnections, banMs: fallback.banMs};
    for(const field of ['windowMs', 'maxConnections', 'banMs'] as const) {
        const value = source[field];
        if(value === undefined) continue;
        const [min, max] = RATE_LIMIT_RANGE[field];
        if(typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
            return {success: false, message: `rateLimit.${field} must be an integer within ${min}..${max}`};
        }
        numbers[field] = value;
    }

    let customized = fallback.customized;
    if(source.customized !== undefined) {
        if(typeof source.customized !== 'boolean') return {success: false, message: 'rateLimit.customized must be boolean'};
        customized = source.customized;
    }

    return {success: true, rateLimit: {enabled, ...numbers, customized}};
};

/**
 * P6-T3 / REQ-15 — 클라이언트 옵션 범위 검증 공통화.
 *
 * 정책:
 *   - port: 1 ~ 65535. 벗어나면 기본값(9126)으로 폴백 + WARN.
 *   - keepAlive: 0은 비활성. 음수/잘못된 값은 공유 기본값으로 폴백 + WARN.
 *   - globalMemCacheLimit: >= 16 (MiB). 그 미만이면 기본값(128) 폴백 + WARN.
 *     단, -1 sentinel은 "제한 없음"으로 허용.
 *
 * logger 주입: 순환 의존 회피를 위해 console.warn 기반 `defaultWarn`이 기본. 호출부에서 외부 logger 주입 가능.
 */
type NormalizationClientOptionWarner = (msg: string) => void;

const DEFAULT_SESSION_TTL_MS = 3_600_000;
const resolveSessionTtlMs = (value: unknown): {success: true; ttlMs: number} | {success: false; message: string} => {
    if(value === undefined) return {success: true, ttlMs: DEFAULT_SESSION_TTL_MS};
    if(typeof value !== 'number' || !Number.isFinite(value) || (value !== 0 && (value < 1000 || value > DEFAULT_SESSION_TTL_MS)))
        return {success: false, message: 'sessionTtlMs must be 0 or within 1000..3600000'};
    return {success: true, ttlMs: value};
};

const DEFAULT_AUDIT_RETENTION_DAYS = 90;
const DEFAULT_AUDIT_QUEUE_SIZE = 1000;
const AUDIT_RETENTION_DAYS_RANGE = [1, 3650] as const;
const AUDIT_QUEUE_SIZE_RANGE = [100, 100_000] as const;

/** 0 은 무제한(PRD §12 Q3). 1..3650 은 입력 오류를 걸러내는 범위이지 정책 상한이 아니다. */
const resolveAuditRetentionDays = (value: unknown): {success: true; days: number} | {success: false; message: string} => {
    if(value === undefined) return {success: true, days: DEFAULT_AUDIT_RETENTION_DAYS};
    const [min, max] = AUDIT_RETENTION_DAYS_RANGE;
    const days = value as number;
    if(!Number.isInteger(days) || (days !== 0 && (days < min || days > max)))
        return {success: false, message: `auditRetentionDays must be 0 or an integer within ${min}..${max}`};
    return {success: true, days};
};

const resolveAuditQueueSize = (value: unknown): {success: true; size: number} | {success: false; message: string} => {
    if(value === undefined) return {success: true, size: DEFAULT_AUDIT_QUEUE_SIZE};
    const [min, max] = AUDIT_QUEUE_SIZE_RANGE;
    const size = value as number;
    if(!Number.isInteger(size) || size < min || size > max)
        return {success: false, message: `auditQueueSize must be an integer within ${min}..${max}`};
    return {success: true, size};
};

const DEFAULT_CLIENT_PORT = 9126;
const DEFAULT_CLIENT_KEEP_ALIVE = 10000;
const DEFAULT_CLIENT_MEM_LIMIT_MIB = 128;
const MIN_CLIENT_MEM_LIMIT_MIB = 16;
/** 클라이언트 메모리 버퍼 상한(MiB, #206). 명령줄과 client.yaml 이 함께 쓴다. -1 은 제한 없음. */
const MAX_CLIENT_MEM_LIMIT_MIB = 1048576;

/** -1(제한 없음) 또는 16..1048576 의 정수인지 본다(#206). */
const isValidClientMemLimit = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value)
    && (value === -1 || (value >= MIN_CLIENT_MEM_LIMIT_MIB && value <= MAX_CLIENT_MEM_LIMIT_MIB));

const defaultWarn: NormalizationClientOptionWarner = (msg: string): void => {
    try { console.warn(msg); } catch { /* noop */ }
};

const resolveClientKeepAlive = (value: unknown, warn: NormalizationClientOptionWarner = defaultWarn): number => {
    if(value == undefined || typeof value !== "number" || !Number.isFinite(value)) {
        if(value != undefined) warn(`normalizationClientOption: keepAlive invalid (got: ${value}). Falling back to ${DEFAULT_CLIENT_KEEP_ALIVE}.`);
        return DEFAULT_CLIENT_KEEP_ALIVE;
    }
    if(value < 0) {
        warn(`normalizationClientOption: keepAlive must be >= 0 (got: ${value}). Falling back to ${DEFAULT_CLIENT_KEEP_ALIVE}.`);
        return DEFAULT_CLIENT_KEEP_ALIVE;
    }
    return value;
};

/**
 * ClientOption 정규화 + 범위 검증.
 * - 입력 객체를 in-place 수정하지 않고 shallow copy를 반환한다.
 * - 범위 밖 값은 기본값 폴백 + warn.
 */
const normalizationClientOption = (clientOption: ClientOption, warn: NormalizationClientOptionWarner = defaultWarn): ClientOption => {
    const out: ClientOption = { ...clientOption } as ClientOption;

    if(out.key == undefined) {
        out.key = DEFAULT_KEY;
    }
    if(out.host == undefined) {
        out.host = "localhost";
    }

    // port: 1~65535
    const rawPort: any = out.port;
    if(rawPort == undefined
        || typeof rawPort !== "number"
        || !Number.isFinite(rawPort)
        || Math.floor(rawPort) !== rawPort
        || rawPort <= 0
        || rawPort > 65535) {
        if(rawPort != undefined) {
            warn(`normalizationClientOption: port out of range (got: ${rawPort}). Falling back to ${DEFAULT_CLIENT_PORT}.`);
        }
        out.port = DEFAULT_CLIENT_PORT;
    }

    if(out.tls == undefined) {
        out.tls = false;
    }
    if(out.name == undefined || typeof out.name !== "string" || out.name.length === 0) {
        // 이름은 ClientApp에서 무작위 생성 경로가 따로 존재한다. 여기서는 fall-through만.
        // 호출부(ClientApp._loadClientOption)가 이미 기본 이름을 세팅하므로 undefined일 가능성은 낮음.
        out.name = out.name ?? "";
    }

    out.keepAlive = resolveClientKeepAlive(out.keepAlive, warn);

    // globalMemCacheLimit: >= 16. -1 sentinel 허용.
    const rawMem: any = out.globalMemCacheLimit;
    if(rawMem == undefined
        || typeof rawMem !== "number"
        || !Number.isFinite(rawMem)) {
        if(rawMem != undefined) {
            warn(`normalizationClientOption: globalMemCacheLimit invalid (got: ${rawMem}). Falling back to ${DEFAULT_CLIENT_MEM_LIMIT_MIB}.`);
        }
        out.globalMemCacheLimit = DEFAULT_CLIENT_MEM_LIMIT_MIB;
    } else if(!isValidClientMemLimit(rawMem)) {
        warn(`normalizationClientOption: globalMemCacheLimit must be -1 or an integer within ${MIN_CLIENT_MEM_LIMIT_MIB}..${MAX_CLIENT_MEM_LIMIT_MIB} MiB (got: ${rawMem}). Falling back to ${DEFAULT_CLIENT_MEM_LIMIT_MIB}.`);
        out.globalMemCacheLimit = DEFAULT_CLIENT_MEM_LIMIT_MIB;
    }

    return out;
};

export {
    ControlProtocolMode,
    ServerOption,
    TunnelingOption,
    ClientOption,
    HttpOption,
    CustomHeader,
    TrustedClient,
    DEFAULT_KEY,
    DEFAULT_SESSION_TTL_MS,
    resolveSessionTtlMs,
    DEFAULT_AUDIT_RETENTION_DAYS,
    DEFAULT_AUDIT_QUEUE_SIZE,
    resolveAuditRetentionDays,
    resolveAuditQueueSize,
    normalizationClientOption,
    resolveClientKeepAlive,
    NormalizationClientOptionWarner,
    DEFAULT_CLIENT_PORT,
    DEFAULT_CLIENT_KEEP_ALIVE,
    DEFAULT_CLIENT_MEM_LIMIT_MIB,
    MIN_CLIENT_MEM_LIMIT_MIB,
    MAX_CLIENT_MEM_LIMIT_MIB,
    isValidClientMemLimit,
    RateLimitOption,
    RATE_LIMIT_RANGE,
    defaultRateLimit,
    normalizeRateLimit,
    GeoMode,
    GeoConfig,
    ConnectionSecurityOption,
    DEFAULT_GEO_CONFIG
};
