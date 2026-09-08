


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
    key: string,
    adminPort?: number,
    adminBindHost?: string,
    adminTls?: boolean,
    port: number,
    tls : boolean,
    controlProtocolMode?: ControlProtocolMode,
    allowLegacyControlAuth?: boolean,
    trustedClients?: Array<TrustedClient>,
    tunnelingOptions: Array<TunnelingOption>,
    globalMemCacheLimit?: number
    keepAlive: number


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
    keepAlive: number
}

const DEFAULT_KEY = "hello-TTTGate";

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

const DEFAULT_CLIENT_PORT = 9126;
const DEFAULT_CLIENT_KEEP_ALIVE = 10000;
const DEFAULT_CLIENT_MEM_LIMIT_MIB = 128;
const MIN_CLIENT_MEM_LIMIT_MIB = 16;

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
    } else if(rawMem !== -1 && rawMem < MIN_CLIENT_MEM_LIMIT_MIB) {
        warn(`normalizationClientOption: globalMemCacheLimit below minimum ${MIN_CLIENT_MEM_LIMIT_MIB}MiB (got: ${rawMem}). Falling back to ${DEFAULT_CLIENT_MEM_LIMIT_MIB}.`);
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
    normalizationClientOption,
    resolveClientKeepAlive,
    NormalizationClientOptionWarner,
    DEFAULT_CLIENT_PORT,
    DEFAULT_CLIENT_KEEP_ALIVE,
    DEFAULT_CLIENT_MEM_LIMIT_MIB,
    MIN_CLIENT_MEM_LIMIT_MIB
};
