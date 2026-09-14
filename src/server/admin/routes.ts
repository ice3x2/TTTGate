import {IncomingMessage, ServerResponse} from "http";
import SessionStore, {Session} from "./SessionStore";
import {Action, Target} from "../rbac/AdminAuthorizer";
import {Principal} from "../rbac/Principal";
import ServerOptionStore from "../ServerOptionStore";
import type {AuditEvent, AuditTarget} from "../audit/AuditSink";
import {ClockRngProvider} from "../../util/ClockRng";

export type {Action, Target};

export type RouteContext = {
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
};

export type RouteAction = Action | 'public' | 'session' | ((ctx: RouteContext) => Action);

/** audited() 가 record 직전까지 들고 있는 감사 메타. 요청 본문·주체가 준비된 뒤 계산된다. */
export type AuditRouteMeta = {
    type: string;
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
    /** 정의되어 있으면 route() 가 핸들러를 audited() 로 감싼다. GET 에는 달지 않는다. */
    audit?: (ctx: RouteContext) => AuditRouteMeta;
    handler: (ctx: RouteContext) => Promise<void>;
};

export type RouteHandlers = {[name: string]: (ctx: RouteContext) => Promise<void>};

/** tunnel:* action 의 대상. owner 는 #100 (U2-08) 이 채운다 — 이 단계에서는 항상 undefined 다. */
const tunnelTarget = (ctx: RouteContext): Target => ({port: Number(ctx.params.port ?? ctx.body?.forwardPort)});

/** POST·PUT /api/tunnelingOption 은 본문의 forwardPort 가 이미 등록된 포트인지로 update/create 가 갈린다. */
const tunnelWriteAction = (ctx: RouteContext): Action =>
    ServerOptionStore.instance.getTunnelingOption(ctx.body?.forwardPort) ? 'tunnel:update' : 'tunnel:create';

/** summary 는 '<type> <target.id>' 로 고정한다(설계 §4.6). 한 곳에서만 만든다. */
const auditMeta = (type: string, target?: AuditTarget, detail?: Record<string, unknown>): AuditRouteMeta =>
    ({type, target, summary: target ? `${type} ${target.id}` : type, detail});

/**
 * POST /api/tunneling/active/:port 가 활성화를 요구했는지 판정한다.
 * 핸들러와 감사 메타가 이 함수 하나만 부르게 해, 감사 기록이 실제 동작과 갈리지 않게 한다.
 */
export const isTunnelActivationRequested = (ctx: RouteContext): boolean => ctx.body?.active == true;

/** 터널 감사 대상의 id 는 포트다. 경로 세그먼트가 없으면 본문의 forwardPort 를 쓴다. */
const tunnelAuditTarget = (ctx: RouteContext): AuditTarget =>
    ({kind: 'tunnel', id: String(ctx.params.port ?? ctx.body?.forwardPort)});

const userAuditTarget = (ctx: RouteContext): AuditTarget => ({kind: 'user', id: ctx.principal!.userId});

// POST 와 PUT 이 같은 핸들러를 쓰는 쌍은 감사 메타도 같으므로 한 번만 정의해 두 행이 함께 가리킨다.
const serverOptionAudit = (): AuditRouteMeta => auditMeta('server_option_updated', {kind: 'server', id: 'server'});
const adminCertAudit = (): AuditRouteMeta => auditMeta('admin_cert_updated', {kind: 'server', id: 'admin-cert'});
const tunnelWriteAudit = (ctx: RouteContext): AuditRouteMeta =>
    auditMeta(tunnelWriteAction(ctx) === 'tunnel:create' ? 'tunnel_created' : 'tunnel_updated', tunnelAuditTarget(ctx));
const tunnelCertAudit = (ctx: RouteContext): AuditRouteMeta => auditMeta('tunnel_cert_updated', tunnelAuditTarget(ctx));

/**
 * 요청 본문에 필드가 들어왔는지 판정한다. 감사 메타의 타입 분기와 핸들러의 패치 구성이
 * 이 함수 하나만 불러, 감사가 말하는 변경과 실제로 반영된 변경이 갈리지 않게 한다.
 */
export const isFieldProvided = (body: any, key: string): boolean => body?.[key] !== undefined;

const pathIdTarget = (kind: AuditTarget['kind']) =>
    (ctx: RouteContext): AuditTarget => ({kind, id: ctx.params.id});

/** PUT /api/users/:id 의 감사 타입은 본문에 어떤 키가 왔는지로 갈린다(설계 §5.2). */
const userUpdateAuditType = (ctx: RouteContext): string =>
    isFieldProvided(ctx.body, 'role') ? 'role_changed'
        : isFieldProvided(ctx.body, 'status') ? 'user_status_changed'
            : 'user_updated';

export type RouteEntry = {
    method: Route['method'];
    pattern: RegExp;
    action: RouteAction;
    target?: (ctx: RouteContext) => Target | undefined;
    audit?: (ctx: RouteContext) => AuditRouteMeta;
    handler: string;
};

// 표(순서 = 매칭 우선순위). 인스턴스 없이 순회할 수 있도록 handler 는 이름(문자열)으로만 가리킨다.
// pattern 은 new RegExp(string) 으로 만든다: 정규식 리터럴(/.../)은 '/' 이스케이프가 source 에 그대로
// 남아 표(이슈 #95)에 적힌 패턴 문자열과 pattern.source 가 어긋나 보이므로 피한다.
export const ADMIN_ROUTES: ReadonlyArray<RouteEntry> = [
    {method: 'POST', pattern: new RegExp('^/api/login$'), action: 'public', handler: 'onLogin'},
    {method: 'GET', pattern: new RegExp('^/api/version$'), action: 'public', handler: 'onGetVersion'},
    {method: 'POST', pattern: new RegExp('^/api/logout$'), action: 'session',
        audit: (ctx) => auditMeta('logout', {kind: 'session', id: SessionStore.sessionIdOf(ctx.session!.key)}), handler: 'onLogout'},
    {method: 'GET', pattern: new RegExp('^/api/validateSession$'), action: 'session', handler: 'onGetValidateSession'},
    {method: 'GET', pattern: new RegExp('^/api/csrfToken$'), action: 'session', handler: 'onGetCsrfToken'},
    {method: 'GET', pattern: new RegExp('^/api/me$'), action: 'me:read', handler: 'onGetMe'},
    {method: 'PUT', pattern: new RegExp('^/api/me/password$'), action: 'me:password',
        audit: (ctx) => auditMeta('password_changed', userAuditTarget(ctx), {firstLogin: ctx.principal!.mustChangePassword}), handler: 'onUpdateMePassword'},
    {method: 'POST', pattern: new RegExp('^/api/me/acknowledge-migration$'), action: 'me:read',
        audit: (ctx) => auditMeta('user_updated', userAuditTarget(ctx), {field: 'migrationAcknowledged'}), handler: 'onAcknowledgeMigration'},
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
    {method: 'DELETE', pattern: new RegExp('^/api/tunnelingOption$'), action: 'tunnel:delete', target: tunnelTarget,
        audit: (ctx) => auditMeta('tunnel_deleted', tunnelAuditTarget(ctx)), handler: 'onRemoveTunnelingOption'},
    {method: 'POST', pattern: new RegExp('^/api/tunneling/active/(?<port>[^/]*)$'), action: 'tunnel:activate', target: tunnelTarget,
        audit: (ctx) => auditMeta(isTunnelActivationRequested(ctx) ? 'tunnel_activated' : 'tunnel_deactivated', tunnelAuditTarget(ctx)),
        handler: 'onActiveTunneling'},
    {method: 'GET', pattern: new RegExp('^/api/externalServerStatuses$'), action: 'tunnel:list', target: tunnelTarget, handler: 'onGetExternalServerStatuses'},
    {method: 'GET', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'tunnel:cert', target: tunnelTarget, handler: 'onGetExternalServerCert'},
    {method: 'POST', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'tunnel:cert', target: tunnelTarget, audit: tunnelCertAudit, handler: 'onUpdateExternalServerCert'},
    {method: 'PUT', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'tunnel:cert', target: tunnelTarget, audit: tunnelCertAudit, handler: 'onUpdateExternalServerCert'},
    {method: 'DELETE', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'tunnel:cert', target: tunnelTarget,
        audit: (ctx) => auditMeta('tunnel_cert_deleted', tunnelAuditTarget(ctx)), handler: 'onDeleteExternalServerCert'},
    // U5-02 / #117 이 임시로 추가한 차단 목록 라우트. #120 (U5-05) 이 감사까지 더한다.
    {method: 'GET', pattern: new RegExp('^/api/security/bans$'), action: 'security:manage', handler: 'onGetSecurityBans'},
    {method: 'DELETE', pattern: new RegExp('^/api/security/bans/(?<port>[^/]+)/(?<ip>[^/]+)$'), action: 'security:manage',
        audit: (ctx) => auditMeta('security_ban_removed', {kind: 'security', id: `${ctx.params.port}/${ctx.params.ip}`}), handler: 'onDeleteSecurityBan'},
    // U5-04 / #119 가 추가한 거절 집계 조회 라우트. bans 와 같은 성격이라 같은 권한을 쓴다.
    {method: 'GET', pattern: new RegExp('^/api/security/stats$'), action: 'security:manage', handler: 'onGetSecurityStats'},
    // U2-06 / #98 사용자·그룹 관리. 핸들러 본문은 rbacRoutes.ts 에 있고 표는 여기 한 곳에 모아 둔다.
    {method: 'GET', pattern: new RegExp('^/api/users$'), action: 'user:manage', handler: 'onListUsers'},
    {method: 'POST', pattern: new RegExp('^/api/users$'), action: 'user:manage',
        // 생성 전이라 id 가 없다. 요청한 username 을 대상으로 적고 새 id 는 핸들러가 auditDetail 로 더한다.
        audit: (ctx) => auditMeta('user_created', {kind: 'user', id: String(ctx.body?.username)}), handler: 'onCreateUser'},
    {method: 'GET', pattern: new RegExp('^/api/users/(?<id>[^/]+)$'), action: 'user:manage', handler: 'onGetUser'},
    {method: 'PUT', pattern: new RegExp('^/api/users/(?<id>[^/]+)$'), action: 'user:manage',
        audit: (ctx) => auditMeta(userUpdateAuditType(ctx), pathIdTarget('user')(ctx)), handler: 'onUpdateUser'},
    {method: 'DELETE', pattern: new RegExp('^/api/users/(?<id>[^/]+)$'), action: 'user:manage',
        audit: (ctx) => auditMeta('user_deleted', pathIdTarget('user')(ctx)), handler: 'onDeleteUser'},
    {method: 'POST', pattern: new RegExp('^/api/users/(?<id>[^/]+)/password-reset$'), action: 'user:manage',
        audit: (ctx) => auditMeta('temp_password_issued', pathIdTarget('user')(ctx)), handler: 'onResetUserPassword'},
    {method: 'GET', pattern: new RegExp('^/api/groups$'), action: 'group:manage', handler: 'onListGroups'},
    {method: 'POST', pattern: new RegExp('^/api/groups$'), action: 'group:manage',
        audit: (ctx) => auditMeta('group_created', {kind: 'group', id: String(ctx.body?.name)}), handler: 'onCreateGroup'},
    {method: 'GET', pattern: new RegExp('^/api/groups/(?<id>[^/]+)$'), action: 'group:manage', handler: 'onGetGroup'},
    {method: 'PUT', pattern: new RegExp('^/api/groups/(?<id>[^/]+)$'), action: 'group:manage',
        audit: (ctx) => auditMeta(isFieldProvided(ctx.body, 'attributes') ? 'group_attributes_changed' : 'group_updated',
            pathIdTarget('group')(ctx)), handler: 'onUpdateGroup'},
    {method: 'DELETE', pattern: new RegExp('^/api/groups/(?<id>[^/]+)$'), action: 'group:manage',
        audit: (ctx) => auditMeta('group_deleted', pathIdTarget('group')(ctx)), handler: 'onDeleteGroup'}
];

export function buildAdminRoutes(handlers: RouteHandlers): readonly Route[] {
    return ADMIN_ROUTES.map(entry => {
        const handler = handlers[entry.handler];
        if(typeof handler !== 'function') {
            throw new Error(`AdminServer route handler not found: ${entry.handler}`);
        }
        return {method: entry.method, pattern: entry.pattern, action: entry.action, target: entry.target, audit: entry.audit, handler};
    });
}
