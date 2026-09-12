import {IncomingMessage, ServerResponse} from "http";
import {Session} from "./SessionStore";
import {Action, Target} from "../rbac/AdminAuthorizer";
import {Principal} from "../rbac/Principal";
import ServerOptionStore from "../ServerOptionStore";

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

export type Route = {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    pattern: RegExp;
    action: RouteAction;
    target?: (ctx: RouteContext) => Target | undefined;
    handler: (ctx: RouteContext) => Promise<void>;
};

export type RouteHandlers = {[name: string]: (ctx: RouteContext) => Promise<void>};

/** tunnel:* action 의 대상. owner 는 #100 (U2-08) 이 채운다 — 이 단계에서는 항상 undefined 다. */
const tunnelTarget = (ctx: RouteContext): Target => ({port: Number(ctx.params.port ?? ctx.body?.forwardPort)});

/** POST·PUT /api/tunnelingOption 은 본문의 forwardPort 가 이미 등록된 포트인지로 update/create 가 갈린다. */
const tunnelWriteAction = (ctx: RouteContext): Action =>
    ServerOptionStore.instance.getTunnelingOption(ctx.body?.forwardPort) ? 'tunnel:update' : 'tunnel:create';

type RouteEntry = {
    method: Route['method'];
    pattern: RegExp;
    action: RouteAction;
    target?: (ctx: RouteContext) => Target | undefined;
    handler: string;
};

// 표(순서 = 매칭 우선순위). 인스턴스 없이 순회할 수 있도록 handler 는 이름(문자열)으로만 가리킨다.
// pattern 은 new RegExp(string) 으로 만든다: 정규식 리터럴(/.../)은 '/' 이스케이프가 source 에 그대로
// 남아 표(이슈 #95)에 적힌 패턴 문자열과 pattern.source 가 어긋나 보이므로 피한다.
export const ADMIN_ROUTES: ReadonlyArray<RouteEntry> = [
    {method: 'POST', pattern: new RegExp('^/api/login$'), action: 'public', handler: 'onLogin'},
    {method: 'GET', pattern: new RegExp('^/api/version$'), action: 'public', handler: 'onGetVersion'},
    {method: 'POST', pattern: new RegExp('^/api/logout$'), action: 'session', handler: 'onLogout'},
    {method: 'GET', pattern: new RegExp('^/api/validateSession$'), action: 'session', handler: 'onGetValidateSession'},
    {method: 'GET', pattern: new RegExp('^/api/csrfToken$'), action: 'session', handler: 'onGetCsrfToken'},
    {method: 'GET', pattern: new RegExp('^/api/me$'), action: 'me:read', handler: 'onGetMe'},
    {method: 'PUT', pattern: new RegExp('^/api/me/password$'), action: 'me:password', handler: 'onUpdateMePassword'},
    {method: 'POST', pattern: new RegExp('^/api/me/acknowledge-migration$'), action: 'me:read', handler: 'onAcknowledgeMigration'},
    {method: 'GET', pattern: new RegExp('^/api/serverOption$'), action: 'server:manage', handler: 'onGetServerOption'},
    {method: 'POST', pattern: new RegExp('^/api/serverOption$'), action: 'server:manage', handler: 'onUpdateServerOption'},
    {method: 'PUT', pattern: new RegExp('^/api/serverOption$'), action: 'server:manage', handler: 'onUpdateServerOption'},
    {method: 'GET', pattern: new RegExp('^/api/serverOptionHash$'), action: 'server:manage', handler: 'onGetServerOptionHash'},
    {method: 'GET', pattern: new RegExp('^/api/adminCert$'), action: 'server:manage', handler: 'onGetAdminCert'},
    {method: 'POST', pattern: new RegExp('^/api/adminCert$'), action: 'server:manage', handler: 'onUpdateAdminCert'},
    {method: 'PUT', pattern: new RegExp('^/api/adminCert$'), action: 'server:manage', handler: 'onUpdateAdminCert'},
    {method: 'GET', pattern: new RegExp('^/api/sysInfo$'), action: 'status:read', handler: 'onGetSysInfo'},
    {method: 'GET', pattern: new RegExp('^/api/sysUsage$'), action: 'status:read', handler: 'onGetSysUsage'},
    {method: 'GET', pattern: new RegExp('^/api/clientStatus$'), action: 'status:read', handler: 'onGetClientStatus'},
    {method: 'GET', pattern: new RegExp('^/api/clientSysInfo/(?<id>[^/]*)$'), action: 'status:read', handler: 'onGetClientSysInfo'},
    {method: 'GET', pattern: new RegExp('^/api/tunnelingOption$'), action: 'tunnel:list', target: tunnelTarget, handler: 'onGetTunnelingOption'},
    {method: 'POST', pattern: new RegExp('^/api/tunnelingOption$'), action: tunnelWriteAction, target: tunnelTarget, handler: 'onUpdateTunnelingOption'},
    {method: 'PUT', pattern: new RegExp('^/api/tunnelingOption$'), action: tunnelWriteAction, target: tunnelTarget, handler: 'onUpdateTunnelingOption'},
    {method: 'DELETE', pattern: new RegExp('^/api/tunnelingOption$'), action: 'tunnel:delete', target: tunnelTarget, handler: 'onRemoveTunnelingOption'},
    {method: 'POST', pattern: new RegExp('^/api/tunneling/active/(?<port>[^/]*)$'), action: 'tunnel:activate', target: tunnelTarget, handler: 'onActiveTunneling'},
    {method: 'GET', pattern: new RegExp('^/api/externalServerStatuses$'), action: 'tunnel:list', target: tunnelTarget, handler: 'onGetExternalServerStatuses'},
    {method: 'GET', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'tunnel:cert', target: tunnelTarget, handler: 'onGetExternalServerCert'},
    {method: 'POST', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'tunnel:cert', target: tunnelTarget, handler: 'onUpdateExternalServerCert'},
    {method: 'PUT', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'tunnel:cert', target: tunnelTarget, handler: 'onUpdateExternalServerCert'},
    {method: 'DELETE', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'tunnel:cert', target: tunnelTarget, handler: 'onDeleteExternalServerCert'},
    // U5-02 / #117 이 임시로 추가한 차단 목록 라우트. #120 (U5-05) 이 감사까지 더한다.
    {method: 'GET', pattern: new RegExp('^/api/security/bans$'), action: 'security:manage', handler: 'onGetSecurityBans'},
    {method: 'DELETE', pattern: new RegExp('^/api/security/bans/(?<port>[^/]+)/(?<ip>[^/]+)$'), action: 'security:manage', handler: 'onDeleteSecurityBan'}
];

export function buildAdminRoutes(handlers: RouteHandlers): readonly Route[] {
    return ADMIN_ROUTES.map(entry => {
        const handler = handlers[entry.handler];
        if(typeof handler !== 'function') {
            throw new Error(`AdminServer route handler not found: ${entry.handler}`);
        }
        return {method: entry.method, pattern: entry.pattern, action: entry.action, target: entry.target, handler};
    });
}
