import {IncomingMessage, ServerResponse} from "http";
import SessionStore, {Session} from "./SessionStore";
import {Action, Target} from "../rbac/AdminAuthorizer";
import {Principal} from "../rbac/Principal";
import ServerOptionStore from "../ServerOptionStore";
import {AuthorizationContext} from "../rbac/AuthorizationContext";
import type {AuditEvent, AuditTarget} from "../audit/AuditSink";
import {AUDIT_EVENT_TYPES, AuditEventType} from "../audit/AuditEventTypes";
import {ClockRngProvider} from "../../util/ClockRng";
import {truncateAuditValue} from "./auditValue";
import {parseBlockedAddress} from "../security/IpBlocklist";
import type {MfaTicketStore, PendingEnrollmentStore} from "../mfa/MfaTickets";

export type {Action, Target};

export type RouteContext = {
    /** 활성 터널의 수명 상한을 다시 계산한다(#137). 소유자·사용자 그룹·그룹 속성이 바뀐 뒤 부른다. */
    reapplyTunnelCaps?: () => void;
    req: IncomingMessage;
    res: ServerResponse;
    params: Record<string, string>;
    body?: any;
    session?: Session;
    principal?: Principal;
    ip: string;
    /** 성공 응답. status 는 생성 라우트가 201 을 낼 때만 넘긴다. */
    ok: (data: object, status?: number) => void;
    /** 실패 응답. 401·403 은 route() 가 내므로 핸들러는 404·409·422·503 만 쓴다. */
    fail: (status: number, code: string, message: string) => void;
    /** 요청 전에 계산한 audit 메타에 뒤늦게 알게 된 값을 더한다. audited() 가 record 직전에 합친다. */
    auditDetail: (patch: Record<string, unknown>) => void;
    /** #113 (U4-05) 본인 세션을 끊은 응답에 sessionKey·csrfToken 만료 쿠키를 붙인다(POST /api/logout 과 같은 형식). */
    expireSessionCookies: () => void;
    /** #112 (U4-04) MFA 메모리 저장소. AdminServer 가 한 벌을 갖고 요청마다 넘긴다. */
    mfa?: {pending: PendingEnrollmentStore; tickets: MfaTicketStore};
};

export type RouteAction = Action | 'public' | 'session' | ((ctx: RouteContext) => Action);

/** audited() 가 record 직전까지 들고 있는 감사 메타. 요청 본문·주체가 준비된 뒤 계산된다. */
export type AuditRouteMeta = {
    type: AuditEventType;
    target?: AuditTarget;
    summary: string;
    detail?: Record<string, unknown>;
};

/**
 * RouteContext 가 아는 주체·세션·IP 를 감사 이벤트의 공통 필드로 옮긴다.
 * audited() 와 핸들러가 흘리는 이벤트가 같은 모양을 갖도록 이 함수 하나만 쓴다.
 */
export function auditEventOf(ctx: RouteContext, meta: AuditRouteMeta, outcome: AuditEvent['outcome']): AuditEvent {
    return {
        at: ClockRngProvider.current().now(),
        actor: ctx.principal
            ? {userId: ctx.principal.userId, username: ctx.principal.username, role: ctx.principal.role}
            : {userId: 'system'},
        sessionIdHash: ctx.session ? SessionStore.sessionIdOf(ctx.session.key) : undefined,
        ip: ctx.ip,
        type: meta.type,
        target: meta.target,
        outcome,
        summary: meta.summary,
        detail: meta.detail
    };
}

export type Route = {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    pattern: RegExp;
    action: RouteAction;
    target?: (ctx: RouteContext) => Target | undefined;
    /**
     * 함수면 route() 가 핸들러를 audited() 로 감싼다. GET 에는 달지 않는다.
     * false 는 "상태를 바꾸지 않아 감사하지 않는다" 는 표의 명시적 예외다(#112 의 MFA enroll).
     */
    audit?: ((ctx: RouteContext) => AuditRouteMeta) | false;
    /** 권한 판정 대상(target)을 본문에서 읽는다. 이런 라우트는 본문을 읽은 뒤에만 권한을 판정할 수 있다(#173). */
    targetFromBody?: true;
    /** 로그인 경로. 본문을 읽기 전에 차단과 동시 처리 칸을 판정한다(#265). password 는 거절도 login_failure 로 감사한다. */
    loginSlot?: 'password' | 'mfa';
    handler: (ctx: RouteContext) => Promise<void>;
};

export type RouteHandlers = {[name: string]: (ctx: RouteContext) => Promise<void>};

/**
 * #286 차단 목록 감사의 대상 id. 넣을 때와 풀 때 같은 id 로 이어지도록 정규화한 주소를 쓴다.
 * 틀린 문자열은 원문을, 문자열이 아니면(주소가 빠진 요청 등) 'invalid' 를 쓴다.
 */
const blocklistAuditId = (raw: unknown): string => {
    if(typeof raw !== 'string') return 'invalid';
    const parsed = parseBlockedAddress(raw);
    return truncateAuditValue(parsed.ok ? parsed.address : raw);
};

/** 경로 세그먼트를 퍼센트 디코딩한다. 잘못된 인코딩이면 던지지 않고 undefined 를 돌려준다. */
export const decodedPathSegment = (segment: string): string | undefined => {
    try {
        return decodeURIComponent(segment);
    } catch {
        return undefined;
    }
};

/**
 * 경로 세그먼트의 포트. 1–65535 의 십진 표기만 받는다(앞자리 0, 지수, 16진, 소수, 공백은 거절).
 * 권한 판정(tunnelPortOf)과 핸들러(getNumberInPath)가 이 함수 하나만 쓴다. 둘이 서로 다른 변환을 쓰면
 * "20.010e3" 처럼 판정은 내 포트, 동작은 남의 포트로 읽히는 표기가 생긴다(#138).
 */
export const parsePathPort = (raw: string | undefined): number | undefined => {
    if(raw === undefined || !/^[1-9]\d{0,4}$/.test(raw)) return undefined;
    const port = Number(raw);
    return port <= 65535 ? port : undefined;
};

/** 경로의 숫자 id. 십진 숫자만 받고, 포트와 같이 앞자리 0 은 받지 않는다("0" 자체는 허용). */
export const parsePathId = (raw: string | undefined): number | undefined =>
    raw !== undefined && /^(0|[1-9]\d{0,14})$/.test(raw) ? Number(raw) : undefined;

/** 형식이 틀린 경로 포트는 NaN 이 되어 어느 소유자와도 맞지 않는다. 핸들러는 같은 파싱으로 400 을 낸다. */
const tunnelPortOf = (ctx: RouteContext): number => ctx.params.port !== undefined
    ? parsePathPort(ctx.params.port) ?? NaN
    : Number(ctx.body?.forwardPort);

/** tunnel:* action 의 대상. 소유자는 AuthorizationContext 가 저장소에서 읽어 채운다(#100 U2-08). */
const tunnelTarget = (ctx: RouteContext): Target => AuthorizationContext.targetOf(tunnelPortOf(ctx));

/** 감사 조회는 슈퍼유저면 전체, 일반 유저면 본인 것만이다(#110 U4-02). 범위 제한은 핸들러가 userId 로 집행한다. */
const auditReadAction = (ctx: RouteContext): Action => ctx.principal?.role === 'superuser' ? 'audit:read-all' : 'audit:read-self';

/** POST·PUT /api/tunnelingOption 은 본문의 forwardPort 가 이미 등록된 포트인지로 update/create 가 갈린다. */
const tunnelWriteAction = (ctx: RouteContext): Action =>
    ServerOptionStore.instance.getTunnelingOption(ctx.body?.forwardPort) ? 'tunnel:update' : 'tunnel:create';

/** summary 는 '<type> <target.id>' 로 고정한다(설계 §4.6). 한 곳에서만 만든다. */
const auditMeta = (type: AuditEventType, target?: AuditTarget, detail?: Record<string, unknown>): AuditRouteMeta =>
    ({type, target, summary: target ? `${type} ${target.id}` : type, detail});

/**
 * POST /api/tunneling/active/:port 가 활성화를 요구했는지 판정한다.
 * 핸들러와 감사 메타가 이 함수 하나만 부르게 해, 감사 기록이 실제 동작과 갈리지 않게 한다.
 */
export const isTunnelActivationRequested = (ctx: RouteContext): boolean => ctx.body?.active == true;

/** 터널 감사 대상의 id 는 포트다. 경로 세그먼트가 없으면 본문의 forwardPort 를 쓴다. */
const tunnelAuditTarget = (ctx: RouteContext): AuditTarget =>
    ({kind: 'tunnel', id: truncateAuditValue(String(ctx.params.port ?? ctx.body?.forwardPort))});

const userAuditTarget = (ctx: RouteContext): AuditTarget => ({kind: 'user', id: ctx.principal!.userId});

// POST 와 PUT 이 같은 핸들러를 쓰는 쌍은 감사 메타도 같으므로 한 번만 정의해 두 행이 함께 가리킨다.
const serverOptionAudit = (): AuditRouteMeta => auditMeta(AUDIT_EVENT_TYPES.server_option_updated, {kind: 'server', id: 'server'});
const adminCertAudit = (): AuditRouteMeta => auditMeta(AUDIT_EVENT_TYPES.admin_cert_updated, {kind: 'server', id: 'admin-cert'});
const tunnelWriteAudit = (ctx: RouteContext): AuditRouteMeta =>
    auditMeta(tunnelWriteAction(ctx) === 'tunnel:create' ? AUDIT_EVENT_TYPES.tunnel_created : AUDIT_EVENT_TYPES.tunnel_updated, tunnelAuditTarget(ctx));
const tunnelCertAudit = (ctx: RouteContext): AuditRouteMeta => auditMeta(AUDIT_EVENT_TYPES.tunnel_cert_updated, tunnelAuditTarget(ctx));

/**
 * 요청 본문에 필드가 들어왔는지 판정한다. 감사 메타의 타입 분기와 핸들러의 패치 구성이
 * 이 함수 하나만 불러, 감사가 말하는 변경과 실제로 반영된 변경이 갈리지 않게 한다.
 */
export const isFieldProvided = (body: any, key: string): boolean => body?.[key] !== undefined;

/** 활성화 타임아웃(초)의 상한: 10년. 그룹 수명 상한(UI 최대 1년)보다 넉넉하고 타이머 계산이 안전한 범위다. */
const MAX_ACTIVE_TIMEOUT_SECONDS = 10 * 365 * 86_400;

/**
 * POST /api/tunneling/active/:port 의 timeout(초). 없으면 0(무기한), 상한 이하의 0 이상 유한 숫자만 받고 아니면 undefined 다.
 * 예전에는 isNaN 만 봐서 "30"·true 같은 값이 그대로 곱셈에 쓰였다(#141). 그룹 상한(ms)이 1000 의 배수가 아니면
 * 화면이 소수 초를 되돌려 보내므로 소수는 받는다.
 */
export const parseActiveTimeout = (value: unknown): number | undefined => {
    if(value === undefined || value === null) return 0;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_ACTIVE_TIMEOUT_SECONDS ? value : undefined;
};

/**
 * 예상하지 못한 예외를 응답·감사에 남길 때의 이름. 메시지에는 설정·인증서 파일의 절대 경로 같은 내부 정보가 들어 있으므로
 * 오류 코드(ENOENT 등)나 오류 이름만 쓴다(#146). 상세 내용은 로거에만 남긴다.
 */
export const errorLabelOf = (error: unknown): string => {
    const code = error && typeof error === 'object' ? (error as {code?: unknown}).code : undefined;
    if(typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code)) return code;
    return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error';
};

// 경로 id 는 URL 에서 오므로 헤더 상한까지 길어질 수 있다. 감사에는 정해진 길이로 잘라 넣는다(#173).
const pathIdTarget = (kind: AuditTarget['kind']) =>
    (ctx: RouteContext): AuditTarget => ({kind, id: truncateAuditValue(ctx.params.id ?? '')});

/** PUT /api/users/:id 의 감사 타입은 본문에 어떤 키가 왔는지로 갈린다(설계 §5.2). */
const userUpdateAuditType = (ctx: RouteContext): AuditEventType =>
    isFieldProvided(ctx.body, 'role') ? AUDIT_EVENT_TYPES.role_changed
        : isFieldProvided(ctx.body, 'status') ? AUDIT_EVENT_TYPES.user_status_changed
            : AUDIT_EVENT_TYPES.user_updated;

export type RouteEntry = {
    method: Route['method'];
    pattern: RegExp;
    action: RouteAction;
    target?: (ctx: RouteContext) => Target | undefined;
    audit?: ((ctx: RouteContext) => AuditRouteMeta) | false;
    targetFromBody?: true;
    loginSlot?: Route['loginSlot'];
    handler: string;
};

// 표(순서 = 매칭 우선순위). 인스턴스 없이 순회할 수 있도록 handler 는 이름(문자열)으로만 가리킨다.
// pattern 은 new RegExp(string) 으로 만든다: 정규식 리터럴(/.../)은 '/' 이스케이프가 source 에 그대로
// 남아 표(이슈 #95)에 적힌 패턴 문자열과 pattern.source 가 어긋나 보이므로 피한다.
export const ADMIN_ROUTES: ReadonlyArray<RouteEntry> = [
    {method: 'POST', pattern: new RegExp('^/api/login$'), action: 'public', loginSlot: 'password', handler: 'onLogin'},
    // U4-08 / #127 2단계 로그인. 세션이 없으므로 audited() 대신 핸들러가 직접 감사한다.
    {method: 'POST', pattern: new RegExp('^/api/login/mfa$'), action: 'public', loginSlot: 'mfa', handler: 'onLoginMfa'},
    {method: 'GET', pattern: new RegExp('^/api/version$'), action: 'public', handler: 'onGetVersion'},
    {method: 'POST', pattern: new RegExp('^/api/logout$'), action: 'session',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.logout, {kind: 'session', id: SessionStore.sessionIdOf(ctx.session!.key)}), handler: 'onLogout'},
    {method: 'GET', pattern: new RegExp('^/api/validateSession$'), action: 'session', handler: 'onGetValidateSession'},
    {method: 'GET', pattern: new RegExp('^/api/csrfToken$'), action: 'session', handler: 'onGetCsrfToken'},
    {method: 'GET', pattern: new RegExp('^/api/me$'), action: 'me:read', handler: 'onGetMe'},
    {method: 'PUT', pattern: new RegExp('^/api/me/password$'), action: 'me:password',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.password_changed, userAuditTarget(ctx), {firstLogin: ctx.principal!.mustChangePassword}), handler: 'onUpdateMePassword'},
    {method: 'POST', pattern: new RegExp('^/api/me/acknowledge-migration$'), action: 'me:read',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.user_updated, userAuditTarget(ctx), {field: 'migrationAcknowledged'}), handler: 'onAcknowledgeMigration'},
    // U4-04 / #112 본인 MFA. 핸들러는 rbacRoutes.ts 에 있다. enroll 은 상태를 바꾸지 않는 준비 단계라 감사하지 않는다.
    {method: 'POST', pattern: new RegExp('^/api/me/mfa/enroll$'), action: 'me:mfa', audit: false, handler: 'onEnrollMfa'},
    {method: 'POST', pattern: new RegExp('^/api/me/mfa/confirm$'), action: 'me:mfa',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.mfa_enrolled, userAuditTarget(ctx)), handler: 'onConfirmMfa'},
    {method: 'DELETE', pattern: new RegExp('^/api/me/mfa$'), action: 'me:mfa',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.mfa_disabled, userAuditTarget(ctx)), handler: 'onDisableMfa'},
    {method: 'POST', pattern: new RegExp('^/api/me/mfa/recovery-codes$'), action: 'me:mfa',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.mfa_recovery_codes_regenerated, userAuditTarget(ctx)), handler: 'onRegenerateRecoveryCodes'},
    // U4-05 / #113 본인 세션. 목록은 읽기라 감사하지 않는다. 핸들러는 rbacRoutes.ts 에 있다.
    {method: 'GET', pattern: new RegExp('^/api/me/sessions$'), action: 'me:sessions', handler: 'onListMySessions'},
    {method: 'POST', pattern: new RegExp('^/api/me/sessions/logout-others$'), action: 'me:sessions',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.sessions_killed_self_others, userAuditTarget(ctx)), handler: 'onLogoutOtherSessions'},
    {method: 'GET', pattern: new RegExp('^/api/serverOption$'), action: 'server:manage', handler: 'onGetServerOption'},
    {method: 'POST', pattern: new RegExp('^/api/serverOption$'), action: 'server:manage', audit: serverOptionAudit, handler: 'onUpdateServerOption'},
    {method: 'PUT', pattern: new RegExp('^/api/serverOption$'), action: 'server:manage', audit: serverOptionAudit, handler: 'onUpdateServerOption'},
    {method: 'GET', pattern: new RegExp('^/api/serverOptionHash$'), action: 'server:manage', handler: 'onGetServerOptionHash'},
    {method: 'GET', pattern: new RegExp('^/api/adminCert$'), action: 'server:manage', handler: 'onGetAdminCert'},
    {method: 'POST', pattern: new RegExp('^/api/adminCert$'), action: 'server:manage', audit: adminCertAudit, handler: 'onUpdateAdminCert'},
    {method: 'PUT', pattern: new RegExp('^/api/adminCert$'), action: 'server:manage', audit: adminCertAudit, handler: 'onUpdateAdminCert'},
    {method: 'GET', pattern: new RegExp('^/api/sysInfo$'), action: 'status:read', handler: 'onGetSysInfo'},
    {method: 'GET', pattern: new RegExp('^/api/sysUsage$'), action: 'status:read', handler: 'onGetSysUsage'},
    {method: 'GET', pattern: new RegExp('^/api/clientStatus$'), action: 'status:read', handler: 'onGetClientStatus'},
    {method: 'GET', pattern: new RegExp('^/api/clientSysInfo/(?<id>[^/]*)$'), action: 'status:read', handler: 'onGetClientSysInfo'},
    {method: 'GET', pattern: new RegExp('^/api/tunnelingOption$'), action: 'tunnel:list', target: tunnelTarget, handler: 'onGetTunnelingOption'},
    {method: 'POST', pattern: new RegExp('^/api/tunnelingOption$'), action: tunnelWriteAction, target: tunnelTarget, audit: tunnelWriteAudit, handler: 'onUpdateTunnelingOption'},
    {method: 'PUT', pattern: new RegExp('^/api/tunnelingOption$'), action: tunnelWriteAction, target: tunnelTarget, audit: tunnelWriteAudit, handler: 'onUpdateTunnelingOption'},
    {method: 'DELETE', pattern: new RegExp('^/api/tunnelingOption$'), action: 'tunnel:delete', target: tunnelTarget, targetFromBody: true,
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.tunnel_deleted, tunnelAuditTarget(ctx)), handler: 'onRemoveTunnelingOption'},
    {method: 'PUT', pattern: new RegExp('^/api/tunnelingOption/(?<port>[^/]*)/owner$'), action: 'tunnel:reassign', target: tunnelTarget,
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.tunnel_reassigned, tunnelAuditTarget(ctx)), handler: 'onReassignTunnelOwner'},
    {method: 'POST', pattern: new RegExp('^/api/tunneling/active/(?<port>[^/]*)$'), action: 'tunnel:activate', target: tunnelTarget,
        audit: (ctx) => auditMeta(isTunnelActivationRequested(ctx) ? AUDIT_EVENT_TYPES.tunnel_activated : AUDIT_EVENT_TYPES.tunnel_deactivated, tunnelAuditTarget(ctx)),
        handler: 'onActiveTunneling'},
    {method: 'GET', pattern: new RegExp('^/api/externalServerStatuses$'), action: 'tunnel:list', target: tunnelTarget, handler: 'onGetExternalServerStatuses'},
    {method: 'GET', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'tunnel:cert', target: tunnelTarget, handler: 'onGetExternalServerCert'},
    {method: 'POST', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'tunnel:cert', target: tunnelTarget, audit: tunnelCertAudit, handler: 'onUpdateExternalServerCert'},
    {method: 'PUT', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'tunnel:cert', target: tunnelTarget, audit: tunnelCertAudit, handler: 'onUpdateExternalServerCert'},
    {method: 'DELETE', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'tunnel:cert', target: tunnelTarget,
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.tunnel_cert_deleted, tunnelAuditTarget(ctx)), handler: 'onDeleteExternalServerCert'},
    // U5-02 / #117 이 추가한 차단 목록 라우트. 권한·감사는 #96·#97 이, 국가·감사 detail 은 #120 (U5-05) 이 더했다.
    {method: 'GET', pattern: new RegExp('^/api/security/bans$'), action: 'security:manage', handler: 'onGetSecurityBans'},
    {method: 'DELETE', pattern: new RegExp('^/api/security/bans/(?<port>[^/]+)/(?<ip>[^/]+)$'), action: 'security:manage',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.security_ban_removed, {kind: 'security', id: truncateAuditValue(`${ctx.params.port}/${ctx.params.ip}`)}), handler: 'onDeleteSecurityBan'},
    // U5-04 / #119 가 추가한 거절 집계 조회 라우트. bans 와 같은 성격이라 같은 권한을 쓴다.
    {method: 'GET', pattern: new RegExp('^/api/security/stats$'), action: 'security:manage', handler: 'onGetSecurityStats'},
    // U5-05 / #120 — 국가 필터는 서버 전역 설정이라 슈퍼유저 전용이다(결정 D10).
    // 대상 id 는 'geo' 로 고정이고, 정규화된 값은 핸들러가 auditDetail 로 더한다.
    {method: 'GET', pattern: new RegExp('^/api/security/geo$'), action: 'security:manage', handler: 'onGetSecurityGeo'},
    {method: 'PUT', pattern: new RegExp('^/api/security/geo$'), action: 'security:manage',
        audit: () => auditMeta(AUDIT_EVENT_TYPES.security_geo_updated, {kind: 'security', id: 'geo'}), handler: 'onUpdateSecurityGeo'},
    {method: 'GET', pattern: new RegExp('^/api/security/countries$'), action: 'security:manage', handler: 'onGetSecurityCountries'},
    // #286 — 관리자 차단 목록. 대상 id 는 요청한 주소(일시 차단에서 옮기면 그 주소)를 정규화한 값이다.
    {method: 'GET', pattern: new RegExp('^/api/security/blocklist$'), action: 'security:manage', handler: 'onGetSecurityBlocklist'},
    {method: 'POST', pattern: new RegExp('^/api/security/blocklist$'), action: 'security:manage',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.security_block_added,
            {kind: 'security', id: blocklistAuditId(ctx.body?.fromBan?.ip ?? ctx.body?.address)}), handler: 'onAddSecurityBlock'},
    {method: 'DELETE', pattern: new RegExp('^/api/security/blocklist/(?<address>[^/]+)$'), action: 'security:manage',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.security_block_removed,
            {kind: 'security', id: blocklistAuditId(decodedPathSegment(ctx.params.address) ?? ctx.params.address)}), handler: 'onDeleteSecurityBlock'},
    // U2-06 / #98 사용자·그룹 관리. 핸들러 본문은 rbacRoutes.ts 에 있고 표는 여기 한 곳에 모아 둔다.
    {method: 'GET', pattern: new RegExp('^/api/users$'), action: 'user:manage', handler: 'onListUsers'},
    {method: 'POST', pattern: new RegExp('^/api/users$'), action: 'user:manage',
        // 생성 전이라 id 가 없다. 요청한 username 을 대상으로 적고 새 id 는 핸들러가 auditDetail 로 더한다.
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.user_created, {kind: 'user', id: truncateAuditValue(String(ctx.body?.username))}), handler: 'onCreateUser'},
    {method: 'GET', pattern: new RegExp('^/api/users/(?<id>[^/]+)$'), action: 'user:manage', handler: 'onGetUser'},
    {method: 'PUT', pattern: new RegExp('^/api/users/(?<id>[^/]+)$'), action: 'user:manage',
        audit: (ctx) => auditMeta(userUpdateAuditType(ctx), pathIdTarget('user')(ctx)), handler: 'onUpdateUser'},
    {method: 'DELETE', pattern: new RegExp('^/api/users/(?<id>[^/]+)$'), action: 'user:manage',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.user_deleted, pathIdTarget('user')(ctx)), handler: 'onDeleteUser'},
    {method: 'POST', pattern: new RegExp('^/api/users/(?<id>[^/]+)/password-reset$'), action: 'user:manage',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.temp_password_issued, pathIdTarget('user')(ctx)), handler: 'onResetUserPassword'},
    // U4-08 / #127 슈퍼유저의 남의 MFA 초기화. 대상 사용자의 세션도 끊는다.
    {method: 'POST', pattern: new RegExp('^/api/users/(?<id>[^/]+)/mfa/reset$'), action: 'user:manage',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.mfa_reset, pathIdTarget('user')(ctx)), handler: 'onResetUserMfa'},
    {method: 'GET', pattern: new RegExp('^/api/groups$'), action: 'group:manage', handler: 'onListGroups'},
    // 그룹 편집 화면의 신뢰 클라이언트 선택지(id·표시 이름만, #155).
    {method: 'GET', pattern: new RegExp('^/api/trustedClients$'), action: 'group:manage', handler: 'onListTrustedClients'},
    // #212 신뢰 클라이언트 관리·등록 코드. 자격 증명을 만드는 일이라 그룹 관리보다 높은 server:manage 를 요구한다.
    {method: 'POST', pattern: new RegExp('^/api/trustedClients$'), action: 'server:manage',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.trusted_client_created, {kind: 'trusted_client', id: truncateAuditValue(String(ctx.body?.clientId))}),
        handler: 'onCreateTrustedClient'},
    {method: 'DELETE', pattern: new RegExp('^/api/trustedClients/(?<id>[^/]+)$'), action: 'server:manage',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.trusted_client_deleted, pathIdTarget('trusted_client')(ctx)), handler: 'onDeleteTrustedClient'},
    {method: 'POST', pattern: new RegExp('^/api/trustedClients/(?<id>[^/]+)/secret$'), action: 'server:manage',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.trusted_client_secret_rotated, pathIdTarget('trusted_client')(ctx)), handler: 'onRotateTrustedClientSecret'},
    {method: 'POST', pattern: new RegExp('^/api/trustedClients/(?<id>[^/]+)/enrollmentCode$'), action: 'server:manage',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.enrollment_code_issued, pathIdTarget('trusted_client')(ctx)), handler: 'onIssueEnrollmentCode'},
    {method: 'POST', pattern: new RegExp('^/api/groups$'), action: 'group:manage',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.group_created, {kind: 'group', id: truncateAuditValue(String(ctx.body?.name))}), handler: 'onCreateGroup'},
    {method: 'GET', pattern: new RegExp('^/api/groups/(?<id>[^/]+)$'), action: 'group:manage', handler: 'onGetGroup'},
    {method: 'PUT', pattern: new RegExp('^/api/groups/(?<id>[^/]+)$'), action: 'group:manage',
        audit: (ctx) => auditMeta(isFieldProvided(ctx.body, 'attributes') ? AUDIT_EVENT_TYPES.group_attributes_changed : AUDIT_EVENT_TYPES.group_updated,
            pathIdTarget('group')(ctx)), handler: 'onUpdateGroup'},
    {method: 'DELETE', pattern: new RegExp('^/api/groups/(?<id>[^/]+)$'), action: 'group:manage',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.group_deleted, pathIdTarget('group')(ctx)), handler: 'onDeleteGroup'},
    // U4-05 / #113 세션 관리(슈퍼유저). 대상 id 는 공개 세션 id(sessionIdOf) 또는 사용자 id 다. 세션 키는 어디에도 싣지 않는다.
    {method: 'GET', pattern: new RegExp('^/api/sessions$'), action: 'session:manage', handler: 'onListSessions'},
    {method: 'DELETE', pattern: new RegExp('^/api/sessions/(?<id>[^/]+)$'), action: 'session:manage',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.session_killed, {kind: 'session', id: truncateAuditValue(ctx.params.id ?? '')}), handler: 'onKillSession'},
    {method: 'DELETE', pattern: new RegExp('^/api/users/(?<id>[^/]+)/sessions$'), action: 'session:manage',
        audit: (ctx) => auditMeta(AUDIT_EVENT_TYPES.sessions_killed_for_user, pathIdTarget('user')(ctx)), handler: 'onKillUserSessions'},
    // U4-02 / #110 감사 조회. 조회는 감사하지 않으므로 audit 콜백을 달지 않는다. 핸들러는 auditRoutes.ts 에 있다.
    {method: 'GET', pattern: new RegExp('^/api/audit$'), action: auditReadAction, handler: 'onListAudit'},
    {method: 'GET', pattern: new RegExp('^/api/audit/types$'), action: auditReadAction, handler: 'onListAuditTypes'}
];

export function buildAdminRoutes(handlers: RouteHandlers): readonly Route[] {
    return ADMIN_ROUTES.map(entry => {
        const handler = handlers[entry.handler];
        if(typeof handler !== 'function') {
            throw new Error(`AdminServer route handler not found: ${entry.handler}`);
        }
        return {method: entry.method, pattern: entry.pattern, action: entry.action, target: entry.target, audit: entry.audit,
            targetFromBody: entry.targetFromBody, loginSlot: entry.loginSlot, handler};
    });
}
