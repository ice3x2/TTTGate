import {AllowedProtocol, RewritePermissions} from "./IdentityTypes";
import {Principal} from "./Principal";
import {TunnelingOption} from "../../types/TunnelingOption";

export type EnforceMode = 'create' | 'update';

/** enforce 는 저장소를 조회하지 않는다. 호출자가 소유 터널 수와 서버에 등록된 clientId 를 넘긴다. */
export type EnforceContext = {ownedCount: number; trustedClientIds: string[]};

export type EnforceResult = {success: true} | {success: false; status: 403 | 409 | 422; code: string; message: string};

const ALLOWED: EnforceResult = Object.freeze({success: true});

const BASE_PROTOCOLS: ReadonlyMap<string, AllowedProtocol> = new Map([['tcp', 'TCP'], ['http', 'HTTP'], ['https', 'HTTPS']]);

type RewriteField = {field: string; permission: keyof RewritePermissions; kind: 'flag' | 'list'};

/**
 * 리라이트로 보는 httpOption 필드와 각각이 요구하는 권한. requiredProtocols 와 권한 검사가
 * 이 표 하나만 읽어, HTTP_REWRITE 를 요구하는 판정과 플래그 권한을 요구하는 판정이 갈리지 않는다.
 * 순서는 거부 메시지에 먼저 나올 플래그 순서다.
 */
const REWRITE_FIELDS: readonly RewriteField[] = [
    {field: 'replaceAccessControlAllowOrigin', permission: 'cors', kind: 'flag'},
    {field: 'rewriteHostInTextBody', permission: 'host', kind: 'flag'},
    {field: 'customRequestHeaders', permission: 'header', kind: 'list'},
    {field: 'customResponseHeaders', permission: 'header', kind: 'list'},
    {field: 'bodyRewriteRules', permission: 'body', kind: 'list'}
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isAbsent = (value: unknown): boolean => value === undefined || value === null;

/**
 * 요청 쪽 값이 리라이트를 켜는가. 런타임(HttpHandler)은 플래그를 == true 로 읽어 1 이나 "1" 에서도 켠다.
 * 그 규칙을 따라가는 대신, 명시적으로 꺼져 있지 않은 값은 모두 켜진 것으로 본다(거부 쪽으로 떨어진다).
 */
const isRewriteRequested = (value: unknown, kind: RewriteField['kind']): boolean => {
    if(isAbsent(value)) {
        return false;
    }
    return kind === 'flag' ? value !== false : !(Array.isArray(value) && value.length === 0);
};

/** 요청한 리라이트 필드 목록. httpOption 이 객체가 아니면 무엇을 뜻하는지 알 수 없으므로 전부 요청한 것으로 본다. */
function requestedRewrites(option: TunnelingOption): readonly RewriteField[] {
    const httpOption: unknown = option.httpOption;
    if(isAbsent(httpOption)) {
        return [];
    }
    if(!isRecord(httpOption)) {
        return REWRITE_FIELDS;
    }
    return REWRITE_FIELDS.filter((entry) => isRewriteRequested(httpOption[entry.field], entry.kind));
}

/**
 * 터널이 요구하는 프로토콜 목록. protocol 이 tcp·http·https 가 아니면 어떤 그룹도 만족시킬 수 없다는 뜻으로
 * undefined 를 돌려준다(빈 배열을 돌려주면 "요구 없음" 으로 읽혀 허용으로 떨어진다).
 */
export function requiredProtocols(option: TunnelingOption): AllowedProtocol[] | undefined {
    const protocol: unknown = option.protocol;
    const base = typeof protocol === 'string' ? BASE_PROTOCOLS.get(protocol) : undefined;
    if(base === undefined) {
        return undefined;
    }
    return requestedRewrites(option).length > 0 ? [base, 'HTTP_REWRITE'] : [base];
}

// 그룹 속성은 identity.yaml 을 읽을 때 형식 검증을 거치지 않는다. 아래 판독기는 형식이 틀린 값을 모두 "허용 없음" 으로 읽는다.

const tunnelLimitOf = (attributes: Record<string, unknown>): number => {
    const limit = attributes.max_tunnel_count;
    return typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 0 ? limit : 0;
};

const isPortAllowed = (attributes: Record<string, unknown>, port: unknown): boolean => {
    const ranges = attributes.allowed_port_range;
    if(typeof port !== 'number' || !Number.isInteger(port) || !Array.isArray(ranges)) {
        return false;
    }
    return ranges.some((range) => isRecord(range)
        && typeof range.from === 'number' && Number.isInteger(range.from)
        && typeof range.to === 'number' && Number.isInteger(range.to)
        && range.from <= range.to && range.from <= port && port <= range.to);
};

const listOf = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];

const isRewriteGranted = (attributes: Record<string, unknown>, permission: keyof RewritePermissions): boolean => {
    const permissions = attributes.http_tunnel_rewrite_permissions;
    return isRecord(permissions) && permissions[permission] === true;
};

const hasNoLegacyClientNames = (names: unknown): boolean =>
    isAbsent(names) || (Array.isArray(names) && names.length === 0);

/** 각 id 가 그룹 허용 목록과 서버 등록 목록 양쪽에 모두 있어야 한다. */
const areClientIdsAllowed = (attributes: Record<string, unknown>, ids: unknown, registered: readonly string[]): boolean => {
    if(isAbsent(ids)) {
        return true;
    }
    if(!Array.isArray(ids)) {
        return false;
    }
    const groupAllowed = listOf(attributes.allowed_trusted_clients);
    return ids.every((id) => typeof id === 'string' && groupAllowed.includes(id) && registered.includes(id));
};

/** 호출자의 계약 위반(잘못된 mode·context·터널)은 판정 결과가 아니라 버그이므로 즉시 실패시킨다. */
function assertUsage(next: unknown, mode: unknown, context: unknown): void {
    if(mode !== 'create' && mode !== 'update') {
        throw new TypeError(`enforce: mode must be 'create' or 'update' (got ${String(mode)})`);
    }
    if(!isRecord(context)) {
        throw new TypeError('enforce: context must be an object');
    }
    const ownedCount = context.ownedCount;
    if(typeof ownedCount !== 'number' || !Number.isSafeInteger(ownedCount) || ownedCount < 0) {
        throw new TypeError(`enforce: context.ownedCount must be a non-negative integer (got ${String(ownedCount)})`);
    }
    if(!Array.isArray(context.trustedClientIds) || !context.trustedClientIds.every((id) => typeof id === 'string')) {
        throw new TypeError('enforce: context.trustedClientIds must be an array of strings');
    }
    if(!isRecord(next)) {
        throw new TypeError('enforce: next must be a tunneling option object');
    }
}

const failure = (status: 409 | 422, code: string, message: string): EnforceResult => ({success: false, status, code, message});

/**
 * 일반 유저의 터널 입력을 그룹 속성으로 검사한다. update 때도 next 전체를 검사하므로, 그룹 속성이 나중에 좁아져
 * 이미 범위 밖이 된 터널은 일반 유저가 고칠 수 없다. 첫 실패에서 멈춘다.
 * 슈퍼유저는 속성의 영향을 받지 않는다. 역할이 정확히 'superuser' 일 때만 우회한다.
 */
export function enforce(principal: Principal, next: TunnelingOption, mode: EnforceMode, context: EnforceContext): EnforceResult {
    if(principal.role === 'superuser') {
        return ALLOWED;
    }
    assertUsage(next, mode, context);
    const attributes: Record<string, unknown> = isRecord(principal.attributes) ? principal.attributes : {};

    if(mode === 'create' && context.ownedCount >= tunnelLimitOf(attributes)) {
        return failure(409, 'tunnel_count_exceeded', `tunnel count limit reached (${tunnelLimitOf(attributes)})`);
    }
    if(!isPortAllowed(attributes, next.forwardPort)) {
        return failure(422, 'port_not_allowed', `forwardPort ${String(next.forwardPort)} is outside allowed_port_range`);
    }
    const protocols = requiredProtocols(next);
    if(protocols === undefined) {
        return failure(422, 'protocol_not_allowed', `protocol ${String(next.protocol)} is not supported`);
    }
    const allowedProtocols = listOf(attributes.allowed_protocols);
    const missingProtocol = protocols.find((protocol) => !allowedProtocols.includes(protocol));
    if(missingProtocol !== undefined) {
        return failure(422, 'protocol_not_allowed', `protocol ${missingProtocol} is not in allowed_protocols`);
    }
    if(!hasNoLegacyClientNames(next.allowedClientNames)) {
        return failure(422, 'legacy_client_names_not_allowed', 'allowedClientNames is not allowed; use allowedClientIds');
    }
    // 그룹이 허용하지 않았는지, 서버에 등록되지 않았는지 구분하지 않는다(등록된 clientId 목록이 새지 않게 한다).
    if(!areClientIdsAllowed(attributes, next.allowedClientIds, context.trustedClientIds)) {
        return failure(422, 'trusted_client_not_allowed', 'allowedClientIds contains a client that is not allowed');
    }
    const deniedRewrite = requestedRewrites(next).find((entry) => !isRewriteGranted(attributes, entry.permission));
    if(deniedRewrite !== undefined) {
        return failure(422, 'rewrite_not_allowed',
            `http rewrite permission '${deniedRewrite.permission}' is required by ${deniedRewrite.field}`);
    }
    return ALLOWED;
}
