import {IncomingMessage, ServerResponse} from "http";
import SessionStore, {Session} from "./SessionStore";
import {Action, Target} from "../rbac/AdminAuthorizer";
import {Principal} from "../rbac/Principal";
import ServerOptionStore from "../ServerOptionStore";
import type {AuditTarget} from "../audit/AuditSink";

export type {Action, Target};

export type RouteContext = {
    req: IncomingMessage;
    res: ServerResponse;
    params: Record<string, string>;
    body?: any;
    session?: Session;
    principal?: Principal;
    ip: string;
};

export type RouteAction = Action | 'public' | 'session' | ((ctx: RouteContext) => Action);

/** audited() 가 record 직전까지 들고 있는 감사 메타. 요청 본문·주체가 준비된 뒤 계산된다. */
export type AuditRouteMeta = {
    type: string;
    target?: AuditTarget;
    summary: string;
    detail?: Record<string, unknown>;
};

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

type RouteEntry = {
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
        audit: (ctx) => auditMeta(ctx.body?.active ? 'tunnel_activated' : 'tunnel_deactivated', tunnelAuditTarget(ctx)), handler: 'onActiveTunneling'},
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
    {method: 'GET', pattern: new RegExp('^/api/security/stats$'), action: 'security:manage', handler: 'onGetSecurityStats'}
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
