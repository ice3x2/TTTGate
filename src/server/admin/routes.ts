import {IncomingMessage, ServerResponse} from "http";
import {Session} from "./SessionStore";

// U2-03 임시. #96 이 유니온으로 교체한다.
export type Action = string;

export type RouteContext = {
    req: IncomingMessage;
    res: ServerResponse;
    params: Record<string, string>;
    body?: any;
    session?: Session;
    ip: string;
};

export type RouteAction = Action | 'public' | 'session' | ((ctx: RouteContext) => Action);

export type Route = {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    pattern: RegExp;
    action: RouteAction;
    handler: (ctx: RouteContext) => Promise<void>;
};

export type RouteHandlers = {[name: string]: (ctx: RouteContext) => Promise<void>};

// 표(순서 = 매칭 우선순위). 인스턴스 없이 순회할 수 있도록 handler 는 이름(문자열)으로만 가리킨다.
// pattern 은 new RegExp(string) 으로 만든다: 정규식 리터럴(/.../)은 '/' 이스케이프가 source 에 그대로
// 남아 표(이슈 #95)에 적힌 패턴 문자열과 pattern.source 가 어긋나 보이므로 피한다.
export const ADMIN_ROUTES: ReadonlyArray<{method: Route['method']; pattern: RegExp; action: RouteAction; handler: string}> = [
    {method: 'POST', pattern: new RegExp('^/api/login$'), action: 'public', handler: 'onLogin'},
    {method: 'GET', pattern: new RegExp('^/api/version$'), action: 'public', handler: 'onGetVersion'},
    {method: 'POST', pattern: new RegExp('^/api/logout$'), action: 'session', handler: 'onLogout'},
    {method: 'GET', pattern: new RegExp('^/api/validateSession$'), action: 'session', handler: 'onGetValidateSession'},
    {method: 'GET', pattern: new RegExp('^/api/csrfToken$'), action: 'session', handler: 'onGetCsrfToken'},
    {method: 'GET', pattern: new RegExp('^/api/serverOption$'), action: 'session', handler: 'onGetServerOption'},
    {method: 'POST', pattern: new RegExp('^/api/serverOption$'), action: 'session', handler: 'onUpdateServerOption'},
    {method: 'PUT', pattern: new RegExp('^/api/serverOption$'), action: 'session', handler: 'onUpdateServerOption'},
    {method: 'GET', pattern: new RegExp('^/api/serverOptionHash$'), action: 'session', handler: 'onGetServerOptionHash'},
    {method: 'GET', pattern: new RegExp('^/api/adminCert$'), action: 'session', handler: 'onGetAdminCert'},
    {method: 'POST', pattern: new RegExp('^/api/adminCert$'), action: 'session', handler: 'onUpdateAdminCert'},
    {method: 'PUT', pattern: new RegExp('^/api/adminCert$'), action: 'session', handler: 'onUpdateAdminCert'},
    {method: 'GET', pattern: new RegExp('^/api/sysInfo$'), action: 'session', handler: 'onGetSysInfo'},
    {method: 'GET', pattern: new RegExp('^/api/sysUsage$'), action: 'session', handler: 'onGetSysUsage'},
    {method: 'GET', pattern: new RegExp('^/api/clientStatus$'), action: 'session', handler: 'onGetClientStatus'},
    {method: 'GET', pattern: new RegExp('^/api/clientSysInfo/(?<id>[^/]*)$'), action: 'session', handler: 'onGetClientSysInfo'},
    {method: 'GET', pattern: new RegExp('^/api/tunnelingOption$'), action: 'session', handler: 'onGetTunnelingOption'},
    {method: 'POST', pattern: new RegExp('^/api/tunnelingOption$'), action: 'session', handler: 'onUpdateTunnelingOption'},
    {method: 'PUT', pattern: new RegExp('^/api/tunnelingOption$'), action: 'session', handler: 'onUpdateTunnelingOption'},
    {method: 'DELETE', pattern: new RegExp('^/api/tunnelingOption$'), action: 'session', handler: 'onRemoveTunnelingOption'},
    {method: 'POST', pattern: new RegExp('^/api/tunneling/active/(?<port>[^/]*)$'), action: 'session', handler: 'onActiveTunneling'},
    {method: 'GET', pattern: new RegExp('^/api/externalServerStatuses$'), action: 'session', handler: 'onGetExternalServerStatuses'},
    {method: 'GET', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'session', handler: 'onGetExternalServerCert'},
    {method: 'POST', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'session', handler: 'onUpdateExternalServerCert'},
    {method: 'PUT', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'session', handler: 'onUpdateExternalServerCert'},
    {method: 'DELETE', pattern: new RegExp('^/api/externalCert/(?<port>[^/]*)$'), action: 'session', handler: 'onDeleteExternalServerCert'},
    // U5-02 / #117 이 임시로 추가한 차단 목록 라우트. 세션 검사만 한다.
    {method: 'GET', pattern: new RegExp('^/api/security/bans$'), action: 'session', handler: 'onGetSecurityBans'},
    {method: 'DELETE', pattern: new RegExp('^/api/security/bans/(?<port>[^/]+)/(?<ip>[^/]+)$'), action: 'session', handler: 'onDeleteSecurityBan'}
];

export function buildAdminRoutes(handlers: RouteHandlers): readonly Route[] {
    return ADMIN_ROUTES.map(entry => {
        const handler = handlers[entry.handler];
        if(typeof handler !== 'function') {
            throw new Error(`AdminServer route handler not found: ${entry.handler}`);
        }
        return {method: entry.method, pattern: entry.pattern, action: entry.action, handler};
    });
}
