import http, {IncomingMessage, ServerResponse} from "http";
import https from "https";
import ServerOptionStore from "../ServerOptionStore";
import SessionStore, {Session} from "./SessionStore";
import {IdentityStore} from "../rbac/IdentityStore";
import {IdentityMigration, LEGACY_ADMIN_USERNAME} from "../rbac/IdentityMigration";
import {Role, validatePassword, validateUsername} from "../rbac/IdentityTypes";
import {createHash} from "node:crypto";

import {CertificationStore, CertInfo, PemData} from "../CertificationStore";
import ObjectUtil from "../../util/ObjectUtil";
import UsablePortChecker from "../../util/UsablePortChecker";
import TTTServer from "../TTTServer";
import Environment from "../../Environment";
import Path from "path";
import File from "../../util/File";
import Files from "../../util/Files";
import {SysMonitor} from "../../commons/SysMonitor";
import LoggerFactory from "../../util/logger/LoggerFactory";
import {TCPServer} from "../../util/TCPServer";
import {ClockRngProvider} from "../../util/ClockRng";
import {AdminSecurityPolicyRegistry, evaluateAdminSecurityPolicy, formatAdminSecurityPolicyErrors} from "../AdminSecurityPolicy";
import {timingSafeStringEqual} from "../../util/timingSafeStringEqual";
import {computeBackoffMs} from "./loginBackoff";
import crypto from "crypto";
import {DEFAULT_GEO_CONFIG, GeoConfig, TunnelingOption} from "../../types/TunnelingOption";
import {AdmissionController} from "../security/AdmissionController";
import {normalizeConnectionSecurity} from "../security/connectionSecurity";
import {listCountries} from "../security/countries";
import {auditEventOf, AuditRouteMeta, buildAdminRoutes, isTunnelActivationRequested, Route, RouteContext} from "./routes";
import {rbacRouteHandlers} from "./rbacRoutes";
import {MfaTicketStore, PendingEnrollmentStore} from "../mfa/MfaTickets";
import {mfaLoginHandler} from "./mfaLoginRoutes";
import {auditRouteHandlers} from "./auditRoutes";
import {AuditQuery} from "../audit/AuditQuery";
import {auditDirPath} from "../audit/FileAuditSink";
import {Action, authorize} from "../rbac/AdminAuthorizer";
import {LEGACY_PRINCIPAL, principalOf} from "../rbac/Principal";
import {admitTunnelWrite, isTunnelEditable, isTunnelVisibleTo, ownerViewOf, resolveOwnerId} from "../rbac/TunnelOwnership";
import {AuthorizationContext} from "../rbac/AuthorizationContext";
import {AuditEvent, AuditSinkRegistry, recordAuditEvent} from "../audit/AuditSink";
import {AUDIT_EVENT_TYPES} from "../audit/AuditEventTypes";

const logger = LoggerFactory.getLogger('server', 'AdminServer');
const MFA_NOW = (): number => ClockRngProvider.current().now();

/** 경로 세그먼트를 퍼센트 디코딩한다. 잘못된 인코딩이면 던지지 않고 undefined 를 돌려준다. */
const decodedPathSegment = (segment: string): string | undefined => {
    try {
        return decodeURIComponent(segment);
    } catch {
        return undefined;
    }
};

type LoginAttemptState = {
    failedCount: number;
    windowStartedAt: number;
    blockedUntil: number;
    lastSeenAt: number;
}

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_BLOCK_MS = 60_000;
const LOGIN_MAX_FAILURES = 5;
// P5-T2 / REQ-07: 실패 카운터 LRU 상한 (메모리 무제한 방지).
const LOGIN_ATTEMPT_MAP_LIMIT = 10_000;

// P5-T3 / REQ-11: JSON 본문 크기 / 타임아웃 상한.
const ADMIN_JSON_BODY_LIMIT_BYTES = 1 * 1024 * 1024; // 1MiB
const ADMIN_REQUEST_IDLE_TIMEOUT_MS = 10_000;
const ADMIN_HEADERS_TIMEOUT_MS = 15_000;
const ADMIN_REQUEST_TIMEOUT_MS = 30_000;

// P5-T4 / REQ-12: CSRF 토큰 쿠키명 / 헤더명.
const CSRF_COOKIE_NAME = 'csrfToken';
const CSRF_HEADER_NAME = 'x-csrf-token';

const EMPTY_PEM_DATA : PemData = {
    name: '',
    value: ''
}

const EMPTY_CERT_INFO : CertInfo = {
    cert: EMPTY_PEM_DATA,
    key: EMPTY_PEM_DATA,
    ca: EMPTY_PEM_DATA
}

export type AdminServerOptions = {
    /** authorize 소요 시간을 X-Authz-Us 응답 헤더(µs)로 노출한다. 성능 측정 전용이며 기본은 false. */
    exposeAuthzTiming?: boolean;
};

class AdminServer {

    private readonly _server : http.Server | https.Server;
    private readonly _tls: boolean;
    private _port : number = -1;
    private _bindHost: string = '';
    private _tttServer : TTTServer | undefined;
    private _loginAttempts: Map<string, LoginAttemptState> = new Map<string, LoginAttemptState>();
    // P3-T5 / REQ-08: hot-apply를 위해 현재 TLS 옵션을 보존.
    private _currentTlsOptions: { key: string, cert: string, ca?: string } | undefined;
    // P5-T6 / REQ-19: 영구 error 핸들러 참조 보존 (removeAllListeners 절대 사용 금지).
    private readonly _permanentErrorHandler: (err: Error) => void;
    // U2-03: 선언적 라우트 표. route() 가 이 표로 매칭·세션 해석을 한 번에 한다.
    private readonly _routes: readonly Route[];
    // U2-04 / #96: authorize 소요 시간을 X-Authz-Us 로 노출할지. 측정 전용이라 기본은 꺼 둔다.
    private readonly _exposeAuthzTiming: boolean;
    // U4-04 / #112: MFA 등록 대기·2단계 로그인 티켓(메모리). 만료 항목은 listen 동안 60초마다 쓸어 낸다.
    private readonly _mfa = {pending: new PendingEnrollmentStore(MFA_NOW), tickets: new MfaTicketStore(MFA_NOW)};
    private _mfaSweepTimer: NodeJS.Timeout | undefined;

    constructor(tttServer: TTTServer, tls : boolean, certInfo? : CertInfo, options: AdminServerOptions = {}) {
        this._tttServer = tttServer;
        this._tls = tls;
        this._exposeAuthzTiming = options.exposeAuthzTiming === true;
        if(tls) {
            if(!certInfo) throw new Error('AdminServer certInfo is undefined');
            let options : { key: string, cert: string, ca? : string} = {
                key: certInfo.key.value,
                cert: certInfo.cert.value
            }
            if(certInfo.ca.value.length > 0) {
                options.ca = certInfo.ca.value;
            }
            this._currentTlsOptions = { ...options };
            this._server = https.createServer(options, async (req, res) => {
                await this.route(req, res);
            });
        } else {
            this._server = http.createServer(async (req, res) => {
                await this.route(req, res);
            });
        }

        // P5-T6 / REQ-19: named function 참조로 영구 error 핸들러를 등록.
        // removeAllListeners 를 호출하면 이 영구 핸들러까지 사라지므로 절대 사용 금지.
        this._permanentErrorHandler = (err: Error) => {
            logger.error('HTTP Admin server error', err);
        };
        this._server.on('error', this._permanentErrorHandler);

        // U5-03 / #118: TLS 핸드셰이크 전 원시 소켓 단계에서 국가 필터를 적용한다.
        this._server.on('connection', (socket) => {
            if(!AdmissionController.instance.admit({kind: 'admin'}, socket.remoteAddress).allowed) socket.destroy();
        });

        // P5-T3 / REQ-11: HTTP 서버 수준 타임아웃.
        try {
            (this._server as any).headersTimeout = ADMIN_HEADERS_TIMEOUT_MS;
            (this._server as any).requestTimeout = ADMIN_REQUEST_TIMEOUT_MS;
        } catch { /* no-op: runtime 차이 보호 */ }

        this._routes = buildAdminRoutes({
            onLogin: this.onLogin,
            onLoginMfa: mfaLoginHandler(this._mfa.tickets, {
                isBlocked: (req) => this.isLoginBlocked(req),
                fail: async (req) => { this.recordLoginFailure(req); await this.delayFailedLogin(req); },
                issueSession: (req, res, user) => this.completeLogin(req, res, user.id,
                    {id: user.id, username: user.username, displayName: user.displayName, role: user.role}, user.mustChangePassword),
                sendFailure: (res, status, payload) => this.sendApiFailure(res, status, payload),
                emitAudit: (event) => this.emitAudit(event)
            }),
            onGetVersion: this.onGetVersion,
            onLogout: this.onLogout,
            onGetValidateSession: this.onGetValidateSession,
            onGetCsrfToken: this.onGetCsrfToken,
            onUpdateMePassword: this.onUpdateMePassword,
            onAcknowledgeMigration: this.onAcknowledgeMigration,
            onGetServerOption: this.onGetServerOption,
            onUpdateServerOption: this.onUpdateServerOption,
            onGetServerOptionHash: this.onGetServerOptionHash,
            onGetAdminCert: this.onGetAdminCert,
            onUpdateAdminCert: this.onUpdateAdminCert,
            onGetSysInfo: this.onGetSysInfo,
            onGetSysUsage: this.onGetSysUsage,
            onGetClientStatus: this.onGetClientStatus,
            onGetClientSysInfo: this.onGetClientSysInfo,
            onGetTunnelingOption: this.onGetTunnelingOption,
            onUpdateTunnelingOption: this.onUpdateTunnelingOption,
            onRemoveTunnelingOption: this.onRemoveTunnelingOption,
            onActiveTunneling: this.onActiveTunneling,
            onReassignTunnelOwner: this.onReassignTunnelOwner,
            onGetExternalServerStatuses: this.onGetExternalServerStatuses,
            onGetExternalServerCert: this.onGetExternalServerCert,
            onUpdateExternalServerCert: this.onUpdateExternalServerCert,
            onDeleteExternalServerCert: this.onDeleteExternalServerCert,
            onGetSecurityBans: this.onGetSecurityBans,
            onDeleteSecurityBan: this.onDeleteSecurityBan,
            onGetSecurityStats: this.onGetSecurityStats,
            onGetSecurityGeo: this.onGetSecurityGeo,
            onUpdateSecurityGeo: this.onUpdateSecurityGeo,
            onGetSecurityCountries: this.onGetSecurityCountries,
            // U2-06 / #98: 사용자·그룹 핸들러는 rbacRoutes.ts 가 갖는다(AdminServer.ts 를 2,000줄 아래로 유지).
            ...rbacRouteHandlers,
            // U4-02 / #110: 감사 조회. 422 본문에 status 를 담아야 하므로 sendApiFailure 를 넘긴다.
            ...auditRouteHandlers(new AuditQuery(auditDirPath()), (res, status, payload) => this.sendApiFailure(res, status, payload))
        });
    }

    public get routes(): readonly Route[] {
        return this._routes;
    }

    /**
     * P3-T5 / REQ-08: Admin 인증서 hot-apply.
     *
     * https.Server.setSecureContext를 호출해 재기동 없이 신규 cert/key를 활성화한다.
     * HTTP→HTTPS 전환(=tls 토글)은 listener 구조가 바뀌므로 이 경로로 처리하지 않으며,
     * 상위 TTTServer가 pendingRestartScopes로 별도 재기동을 예약한다.
     *
     * 빈 CA는 setSecureContext에 넘기지 않는다 (undefined는 무해하나 '' 빈 문자열은
     * OpenSSL이 실패로 간주할 수 있음).
     */
    public applyTlsCertificateHotSwap(certInfo: CertInfo): boolean {
        if(!this._tls) return false;
        if(!certInfo || !certInfo.cert?.value || !certInfo.key?.value) return false;
        const next: { key: string, cert: string, ca?: string } = {
            key: certInfo.key.value,
            cert: certInfo.cert.value
        };
        if(certInfo.ca && certInfo.ca.value && certInfo.ca.value.length > 0) {
            next.ca = certInfo.ca.value;
        }
        try {
            (this._server as https.Server).setSecureContext(next as any);
            this._currentTlsOptions = { ...next };
            logger.info('AdminServer: TLS secure context hot-swapped (setSecureContext)');
            return true;
        } catch (e) {
            logger.error('AdminServer: setSecureContext failed', e);
            return false;
        }
    }

    private async route(req: IncomingMessage, res: ServerResponse)  {
        let url = req.url;
        url = url == undefined ? "" : url;
        const pathname = this.pathname(url);
        let method = req.method;
        try {
           // P5-T3 / REQ-11: 요청 단위 idle timeout.
           try { req.setTimeout(ADMIN_REQUEST_IDLE_TIMEOUT_MS); } catch {}

           if(this._tls) {
               res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
           }
           // P5-T1 / REQ-03 (P7-T3 강화): Vary: Origin 은 인증 성공/실패와 무관하게 항상 설정한다.
           // 캐시 레이어가 Origin 기반 응답 분화를 올바르게 처리하도록 보장.
           res.setHeader('Vary', 'Origin');
           // P5-T4 / REQ-12: 상태 변경 메서드는 Origin+CSRF 검증.
           if(method === 'POST' || method === 'PUT' || method === 'DELETE') {
               // /api/login 은 CSRF 토큰 발급 전 호출 가능해야 하므로 헤더 검증은 스킵하되,
               // Origin(존재 시)은 여전히 화이트리스트 강제.
               const skipCsrfHeader = (pathname == '/api/login' || pathname == '/api/login/mfa');
               if(!this.verifyCsrfGuard(req, res, skipCsrfHeader)) {
                   return;
               }
           }

           const matched = this.matchRoute(method, pathname);

           if(method == 'GET') {
               // 캐시 하지 않기. 매칭 여부와 무관하게 모든 GET 응답에 적용된다.
               res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
           }

           if(!matched) {
               if(pathname.startsWith("/api/")) {
                   this.sendApiFailure(res, 404, {message: `Not Found ${url}`});
                   return;
               }
               if(method == 'GET') {
                   await this.onGetWebResource(req, res, pathname);
                   return;
               }
               this.sendApiFailure(res, 404, {message: `Not Found ${url}`});
               return;
           }

           // audited() 가 record 직전에 읽는 누적 객체. ctx.auditDetail 이 여기에 얕게 병합한다.
           const auditDetailPatch: Record<string, unknown> = {};
           const ctx: RouteContext = {
               req, res, params: matched.params, ip: this.getClientAddress(req),
               ok: (data, status = 200) => this.sendApiSuccess(res, data, status),
               fail: (status, code, message) => this.sendApiFailure(res, status, {code, message}),
               auditDetail: (patch) => { Object.assign(auditDetailPatch, patch); },
               mfa: this._mfa,
               expireSessionCookies: () => this.expireSessionCookies(res)
           };
           if(matched.route.action !== 'public') {
               const session = this.resolveSession(req);
               if(!session) {
                   this.sendApiFailure(res, 401, {message: 'Invalid session'});
                   return;
               }
               ctx.session = session;
               const principal = principalOf(session, IdentityStore.instance);
               if(!principal) {
                   // 사용자가 삭제되었거나 비활성화되었다 — 세션도 함께 끊는다.
                   await SessionStore.instance.removeSession(session.key);
                   this.sendApiFailure(res, 401, {message: 'Invalid session'});
                   return;
               }
               ctx.principal = principal;
           }
           if(method === 'POST' || method === 'PUT' || method === 'DELETE') {
               ctx.body = await AdminServer.readJson(req);
           }
           // 'public' 과 'session' 은 권한 판정 없이 통과한다(세션 존재만으로 충분한 엔드포인트).
           if(matched.route.action !== 'public' && matched.route.action !== 'session') {
               const action: Action = typeof matched.route.action === 'function'
                   ? matched.route.action(ctx) : matched.route.action;
               const startedAt = process.hrtime.bigint();
               const decision = authorize(ctx.principal!, action, matched.route.target?.(ctx));
               const elapsed = process.hrtime.bigint() - startedAt;
               if(!decision.allowed) {
                   this.emitAudit(auditEventOf(ctx, {
                       type: AUDIT_EVENT_TYPES.access_denied, summary: `access_denied ${action}`, detail: {action, path: pathname}
                   }, 'failure'));
                   this.sendApiFailure(res, decision.status, {
                       code: decision.code,
                       message: decision.code === 'mfa_enrollment_required' ? 'Enable two-factor authentication first.'
                           : decision.status === 403 ? 'Forbidden' : 'Not Found'
                   });
                   return;
               }
               if(this._exposeAuthzTiming) {
                   res.setHeader('X-Authz-Us', String(Number(elapsed / 1000n)));
               }
               // identity.yaml 을 읽지 못한 상태에서는 사용자·그룹을 읽지도 고치지도 못한다.
               // 핸들러마다 판정하지 않고 라우트 계층에서 한 번에 막는다.
               if((action === 'user:manage' || action === 'group:manage')
                   && IdentityStore.instance.mode === 'legacy-fallback') {
                   this.sendIdentityStoreUnavailable(res);
                   return;
               }
           }
           const auditMeta = typeof matched.route.audit === 'function' ? matched.route.audit(ctx) : undefined;
           if(auditMeta) {
               await this.audited(ctx, auditMeta, matched.route.handler, auditDetailPatch);
           } else {
               await matched.route.handler(ctx);
           }
           return;

        } catch (e: any) {
            try {
                const code = e && typeof e === 'object' ? e.code : undefined;
                let status = 500;
                let message = `Internal Server Error: ${e}`;
                if(code === 'E_BODY_TOO_LARGE') {
                    status = 413;
                    message = 'Payload Too Large';
                } else if(code === 'E_REQ_TIMEOUT') {
                    status = 408;
                    message = 'Request Timeout';
                } else if(e instanceof SyntaxError) {
                    status = 400;
                    message = 'Invalid JSON body';
                }
                logger.warn('HTTP Admin server processing error', e);
                if(!res.headersSent) {
                    this.sendApiFailure(res, status, {message, url: url,
                        partial: Boolean(e?.recoveryFailedPaths?.length),
                        failedScopes: e?.recoveryFailedPaths?.length ? [`${e.persistenceScope ?? 'configuration'}-restore`] : []});
                }
                return;
            } catch (e) {
                logger.error('HTTP Admin server processing error', e);
                return;
            }
        }
        res.writeHead(404);
        res.end(`Not Found ${url}`);
    }

    /** reserve() 를 거치지 않고 흘려보내는 이벤트(로그인·권한 거부). 응답을 감사 배압으로 막지 않는다. */
    private emitAudit(event: AuditEvent): void {
        recordAuditEvent(event).catch((e) => logger.error('audit record failed', e));
    }

    /**
     * CUD 라우트의 감사 래퍼. 기록할 자리를 먼저 선점하고 핸들러의 성공·실패를 모두 남긴다.
     * 자리를 얻지 못하면 핸들러를 실행하지 않고 503 을 낸다(드롭 금지, NFR-PERF-AUDIT-WRITE-001).
     */
    private async audited(ctx: RouteContext, meta: AuditRouteMeta, handler: (ctx: RouteContext) => Promise<void>,
                          auditDetailPatch: Record<string, unknown>): Promise<void> {
        const sink = AuditSinkRegistry.current();
        if(!sink.reserve()) {
            this.sendApiFailure(ctx.res, 503, {code: 'audit_unavailable', message: 'Audit log unavailable'});
            return;
        }
        let failure: {error: unknown} | undefined;
        try {
            await handler(ctx);
        } catch(e) {
            failure = {error: e};
        }
        // 메타가 미리 준 값 → 핸들러가 auditDetail 로 더한 값 → 예외 순으로 합친다.
        const merged: Record<string, unknown> = {
            ...(meta.detail ?? {}),
            ...auditDetailPatch,
            ...(failure ? {error: String(failure.error)} : {})
        };
        try {
            await recordAuditEvent(auditEventOf(ctx,
                {...meta, detail: Object.keys(merged).length > 0 ? merged : undefined},
                !failure && ctx.res.statusCode < 400 ? 'success' : 'failure'), sink);
        } catch(e) {
            // 자리는 reserve() 로 확보했으므로 여기서의 실패는 싱크 장애다. 응답은 이미 나갔다.
            logger.error('audit record failed', e);
        }
        if(failure) {
            // route() 의 기존 처리(413/408/400/500)가 그대로 받도록 되던진다.
            throw failure.error;
        }
    }

    private matchRoute(method: string | undefined, pathname: string): {route: Route; params: Record<string, string>} | undefined {
        for(const route of this._routes) {
            if(route.method !== method) continue;
            const matched = route.pattern.exec(pathname);
            if(!matched) continue;
            return {route, params: {...(matched.groups ?? {})}};
        }
        return undefined;
    }

    private onGetWebResource = async (req: IncomingMessage, res: ServerResponse, url: string) => {
        const webRoot = Path.resolve(Environment.path.webDir);
        const normalizedUrl = this.normalizeAssetUrl(url);
        if(normalizedUrl == undefined) {
            res.writeHead(404);
            res.end(`Not Found ${url}`);
            return;
        }
        const realPath = Path.resolve(webRoot, `.${normalizedUrl}`);
        const relativePath = Path.relative(webRoot, realPath);
        if(relativePath.startsWith("..") || Path.isAbsolute(relativePath)) {
            res.writeHead(404);
            res.end(`Not Found ${url}`);
            return;
        }
        let ext = Path.extname(realPath);
        let contentType = this.contentTypeFromExt(ext);
        // P5-T7 / REQ-18: Windows FS 는 기본 대소문자 무시 → basename 을 소문자화해서 비교.
        // realPath 가 `...\INDEX.HTML` 로 들어와도 실제 디스크의 `index.html` 에 매칭되어야 한다.
        const basenameLower = Path.basename(realPath).toLowerCase();
        if(contentType == 'application/octet-stream' && basenameLower !== "index.html") {
            res.writeHead(404);
            res.end(`Not Found ${url}`);
            return;
        }
        let file = new File(realPath);
        if(!file.isFile()) {
            res.writeHead(404);
            res.end(`Not Found ${url}`);
            return;
        }
        let body : Buffer | string | undefined;
        if(contentType.startsWith('text')) {
            body = await Files.toString(file);
        } else {
            body = await Files.read(file);
        }
        if(body == undefined) {
            res.writeHead(404);
            res.end(`Not Found ${url}`);
            return;
        }
        res.writeHead(200, {'Content-Type': contentType});
        res.end(body);


    }

    private onUpdateAdminCert = async (ctx: RouteContext) => {
        const {res} = ctx;
        let json = ctx.body;
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            let certInfo = json['certInfo'];
            let certStore = CertificationStore.instance;
            if(!ObjectUtil.equalsType(EMPTY_CERT_INFO, certInfo) || !certStore.prepareAdminServerCert(certInfo)) {
                this.sendApiFailure(res, 400, {message: 'Invalid certificate'});
                return;
            }
            const committedBefore = certStore.captureCommittedState({info: certInfo, type: 'admin'});
            if(!committedBefore) { this.sendApiFailure(res, 400, {message: 'Invalid certificate filename.'}); return; }
            const tlsBefore = this._currentTlsOptions ? {...this._currentTlsOptions} : undefined;
            const pendingRestartScopes = this._tls ? [] : ['admin-cert'];
            const success = await certStore.commitAdminServerCert(certInfo, {markLastKnownGood: this._tls, pendingRestartScopes});
            if(!success) { this.sendApiFailure(res, 400, {message: 'Invalid certificate'}); return; }
            const hotSwapped = this.applyTlsCertificateHotSwap(certInfo);
            if(this._tls && !hotSwapped) {
                const failures = await this.restoreCertificateBaseline(committedBefore);
                if(tlsBefore) {
                    try { (this._server as https.Server).setSecureContext(tlsBefore); this._currentTlsOptions = tlsBefore; }
                    catch(error) { logger.error('admin TLS restore failed', error); failures.push('admin-cert-restore'); }
                }
                this.sendApiFailure(res, 400, {message: 'Unable to apply administrator certificate', partial: failures.length > 0,
                    failedScopes: ['admin-cert', ...failures], revisionState: certStore.revisionState});
                return;
            }
            this.sendApiSuccess(res, {
                partial: !hotSwapped,
                warnings: hotSwapped
                    ? ["admin certificate hot-applied"]
                    : ["admin certificate stored; restart required to apply"],
                restartRequiredScopes: pendingRestartScopes,
                revisionState: certStore.revisionState
            });
        });
    }

    private static getSessionKey = (req: IncomingMessage) : Array<string> => {
        const cookies = AdminServer.parseCookies(req);
        const v = cookies.get('sessionKey');
        return v ? [v] : [];
    }

    /**
     * P5-T5 / REQ-16: Cookie 파싱 방어.
     * split('=') 기반 파싱은 값에 '='가 포함되면(base64url 패딩 등) 조각이 3개 이상이 되어
     * 쿠키 자체를 무시해버린다. indexOf('=') 로 첫 '=' 만 분리해 안전하게 추출한다.
     */
    private static parseCookies(req: IncomingMessage): Map<string, string> {
        const result = new Map<string, string>();
        const cookie = req.headers['cookie'];
        if(cookie == undefined) return result;
        const parts = cookie.split(';');
        for(const raw of parts) {
            const seg = raw.trim();
            if(seg.length == 0) continue;
            const eq = seg.indexOf('=');
            if(eq <= 0) continue;
            const key = seg.substring(0, eq).trim();
            const value = seg.substring(eq + 1).trim();
            if(key.length == 0) continue;
            // 동일 이름 쿠키는 최초 값을 우선(RFC6265 §5.4 권장).
            if(!result.has(key)) {
                result.set(key, value);
            }
        }
        return result;
    }

    private async restoreCertificateBaseline(committed: NonNullable<ReturnType<CertificationStore['captureCommittedState']>>,
        runtime?: ReturnType<TTTServer['captureRuntimeState']>): Promise<string[]> {
        const failures: string[] = [];
        try { if(!CertificationStore.instance.restoreCommittedState(committed)) failures.push('certificate-restore'); }
        catch(error) { logger.error('certificate baseline restore failed', error); failures.push('certificate-restore'); }
        if(runtime) failures.push(...await this._tttServer!.restoreRuntimeState(runtime));
        return failures;
    }

    private async restoreConfigurationBaseline(committed: ReturnType<ServerOptionStore['captureCommittedState']>,
        runtime?: ReturnType<TTTServer['captureRuntimeState']>): Promise<string[]> {
        const failures: string[] = [];
        try { ServerOptionStore.instance.restoreCommittedState(committed); }
        catch(error) { logger.error('configuration baseline restore failed', error); failures.push('configuration-restore'); }
        if(runtime) failures.push(...await this._tttServer!.restoreRuntimeState(runtime));
        return failures;
    }

    private async mutateConfiguration(res: ServerResponse, payload: any, operation: (store: ServerOptionStore) => Promise<void>): Promise<void> {
        if(!payload || Array.isArray(payload) || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision <= 0) {
            this.sendApiFailure(res, 400, {message: 'A positive safe-integer expectedRevision is required.'});
            return;
        }
        const expectedRevision = payload.expectedRevision;
        delete payload.expectedRevision;
        const store = ServerOptionStore.instance;
        await store.runConfigurationMutation(async () => {
            if(expectedRevision !== store.revisionState.currentRevision) {
                this.sendApiFailure(res, 409, {message: 'Configuration changed. Reload before saving.', revisionState: store.revisionState});
                return;
            }
            await operation(store);
        });
    }

    private onUpdateServerOption = async (ctx: RouteContext) => {
        const {res} = ctx;
        const requestedServerOption = ctx.body;
        await this.mutateConfiguration(res, requestedServerOption, async (serverOptionStore) => {
            let currentServerOption = serverOptionStore.serverOption;
            let prepareResult = serverOptionStore.prepareServerOption(ObjectUtil.cloneDeep(requestedServerOption));
            if(!prepareResult.success || !prepareResult.serverOption) {
                this.sendApiFailure(res, 400, {message: prepareResult.message || 'Invalid server option', updated: false});
                return;
            }
            let serverOption = prepareResult.serverOption;
            let updates = ObjectUtil.findUpdates(currentServerOption, serverOption);
            if(ObjectUtil.equalsDeep(currentServerOption, serverOption)) {
                this.sendApiSuccess(res, {
                    message: 'equals',
                    updated: false,
                    updates,
                    revisionState: serverOptionStore.revisionState
                });
                return;
            }
            let updatePorts = new Array<number>();
            if(updates['adminPort'] != undefined) {
                if(updates['adminPort'] == serverOption.port) {
                    this.sendApiFailure(res, 400, {
                        message: 'Input error: Admin server port and Tunnel server port number cannot be the same.',
                        updated: false,
                        updates
                    });
                    return;
                }
                updatePorts.push(serverOption.adminPort!);
            }
            if(updates['port'] != undefined) {
                if(updates['port'] == serverOption.adminPort || (updates['adminPort'] != undefined && updates['adminPort'] == updates['port'])) {
                    this.sendApiFailure(res, 400, {
                        message: 'Input error: Admin server port and Tunnel server port number cannot be the same.',
                        updated: false,
                        updates
                    });
                    return;
                }
                updatePorts.push(serverOption.port!);
            }
            let policyDecision = evaluateAdminSecurityPolicy(serverOption);
            if(!policyDecision.allowed) {
                this.sendApiFailure(res, 400, {
                    message: formatAdminSecurityPolicyErrors(policyDecision),
                    updated: false,
                    legacyFlagsRequired: policyDecision.missingFlags
                });
                return;
            }
            let usablePorts = await UsablePortChecker.checkPorts(updatePorts);
            if(usablePorts.length != updatePorts.length) {
                let notUsablePorts = updatePorts.filter((port) => !usablePorts.includes(port));
                this.sendApiFailure(res, 400, {
                    message: `Port number ${notUsablePorts} is already in use`,
                    updated: false,
                    updates
                });
                return;
            }
            const hotApplyRequired = currentServerOption.sessionTtlMs !== serverOption.sessionTtlMs
                || currentServerOption.port !== serverOption.port
                || (currentServerOption.tls === true) !== (serverOption.tls === true)
                || currentServerOption.key !== serverOption.key
                || (currentServerOption.keepAlive ?? TCPServer.DEFAULT_KEEP_ALIVE) !== (serverOption.keepAlive ?? TCPServer.DEFAULT_KEEP_ALIVE)
                || currentServerOption.controlProtocolMode !== serverOption.controlProtocolMode
                || (currentServerOption.allowLegacyControlAuth === true) !== (serverOption.allowLegacyControlAuth === true)
                || (currentServerOption.globalMemCacheLimit ?? 128) !== (serverOption.globalMemCacheLimit ?? 128)
                || !ObjectUtil.canonicalEquals(currentServerOption.trustedClients ?? [], serverOption.trustedClients ?? []);
            const committedBefore = serverOptionStore.captureCommittedState();
            const runtimeBefore = this._tttServer?.captureRuntimeState?.();
            const pendingScopes = (updates['adminPort'] !== undefined || updates['adminBindHost'] !== undefined || updates['adminTls'] !== undefined) ? ['admin-server'] : [];
            let commitResult = serverOptionStore.commitPreparedServerOption(serverOption, {
                markLastKnownGood: pendingScopes.length === 0,
                pendingRestartScopes: pendingScopes
            });
            if(!commitResult.success) {
                serverOptionStore.recordRollback('server option commit failed', ["server-option"]);
                this.sendApiFailure(res, 500, {
                    message: 'Unable to commit server option.',
                    updated: false,
                    failedScopes: ["server-option"],
                    revisionState: serverOptionStore.revisionState
                });
                return;
            }
            let runtimeResult;
            if(typeof (this._tttServer as any)?.applyServerOption == "function") {
                runtimeResult = await (this._tttServer as any).applyServerOption(serverOption, currentServerOption);
            } else if(!hotApplyRequired) {
                runtimeResult = {
                    success: true,
                    partial: true,
                    warnings: ["admin listener changes require process restart"],
                    failedScopes: [],
                    restartRequiredScopes: ["admin-server"]
                };
            } else {
                runtimeResult = {
                    success: false,
                    partial: false,
                    warnings: [],
                    failedScopes: ["server-runtime"],
                    restartRequiredScopes: []
                };
            }
            if(!runtimeResult.success) {
                const recoveryFailures = await this.restoreConfigurationBaseline(committedBefore, runtimeBefore);
                if(recoveryFailures.length === 0) {
                    try { serverOptionStore.recordRollback('runtime apply failed; prior baseline restored', runtimeResult.failedScopes,
                        committedBefore.revisionState.currentRevision + 1, committedBefore.revisionState.currentRevision); }
                    catch(error) { logger.error('rollback diagnostic persistence failed', error); recoveryFailures.push('configuration-rollback-metadata'); }
                }
                runtimeResult.partial = recoveryFailures.length > 0;
                runtimeResult.failedScopes.push(...recoveryFailures);
                this.sendApiFailure(res, 400, {
                    message: 'Unable to apply server option.',
                    partial: runtimeResult.partial,
                    updated: false,
                    updates,
                    warnings: runtimeResult.warnings,
                    failedScopes: runtimeResult.failedScopes,
                    restartRequiredScopes: runtimeResult.restartRequiredScopes,
                    revisionState: serverOptionStore.revisionState
                });
                return;
            }
            this.sendApiSuccess(res, {
                partial: runtimeResult.partial,
                updated: true,
                updates,
                warnings: runtimeResult.warnings,
                failedScopes: runtimeResult.failedScopes,
                restartRequiredScopes: runtimeResult.restartRequiredScopes,
                revisionState: commitResult.revisionState
            });
        });
    }


    private onUpdateTunnelingOption = async (ctx: RouteContext) => {
        const {res} = ctx;
        const payload = ctx.body;
        await this.mutateConfiguration(res, payload, async (serverOptionStore) => {
            // owner·editable 은 목록 응답이 덧붙이는 표시용 필드다. 관리자 UI 가 행을 그대로 되돌려 보내도 저장되지 않게 떼어 낸다.
            const {certInfo, expectedCertificateRevision, previousForwardPort, owner, editable, ...tunnelingOption} = payload;
            const admission = admitTunnelWrite(ctx.principal!, tunnelingOption, {certInfo, previousForwardPort});
            if(!admission.success) {
                this.sendApiFailure(res, admission.status, {code: admission.code, message: admission.message});
                return;
            }
            tunnelingOption.ownerId = admission.ownerId;
            ctx.auditDetail({ownerId: admission.ownerId});
            if(certInfo !== undefined || previousForwardPort !== undefined) {
                await this.applyCompoundTunnelingOption(res, tunnelingOption, certInfo, expectedCertificateRevision, previousForwardPort);
                return;
            }
            let previousOption = serverOptionStore.getTunnelingOption(tunnelingOption.forwardPort);
            let composeResult = serverOptionStore.composeServerOptionWithTunnelingOption(ObjectUtil.cloneDeep(tunnelingOption));
            if(!composeResult.success || !composeResult.serverOption) {
                this.sendApiFailure(res, 400, {
                    message: 'Tunneling options update failed.',
                    forwardPort: tunnelingOption.forwardPort
                });
                return;
            }
            if(!previousOption && !await UsablePortChecker.check(tunnelingOption.forwardPort)) {
                this.sendApiFailure(res, 400, {
                    message: `${tunnelingOption.forwardPort} is an unusable port number.`,
                    forwardPort: tunnelingOption.forwardPort
                });
                return;
            }
            const committedBefore = serverOptionStore.captureCommittedState();
            const runtimeBefore = this._tttServer?.captureRuntimeState?.();
            const commitResult = serverOptionStore.commitPreparedServerOption(composeResult.serverOption);
            if(!commitResult.success) {
                serverOptionStore.recordRollback('tunneling option commit failed', ["tunneling-option"]);
                this.sendApiFailure(res, 500, {
                    message: 'Unable to commit tunneling option.',
                    forwardPort: tunnelingOption.forwardPort,
                    failedScopes: ["tunneling-option"],
                    revisionState: serverOptionStore.revisionState
                });
                return;
            }
            let runtimeResult = await this._tttServer?.applyTunnelingOption(serverOptionStore.getTunnelingOption(tunnelingOption.forwardPort)!, previousOption) ?? {
                success: false,
                partial: false,
                warnings: [],
                failedScopes: [`external-listener:${tunnelingOption.forwardPort}`],
                restartRequiredScopes: []
            };
            if(!runtimeResult.success) {
                const recoveryFailures = await this.restoreConfigurationBaseline(committedBefore, runtimeBefore);
                if(recoveryFailures.length === 0) {
                    try { serverOptionStore.recordRollback('runtime apply failed; prior baseline restored', runtimeResult.failedScopes,
                        committedBefore.revisionState.currentRevision + 1, committedBefore.revisionState.currentRevision); }
                    catch(error) { logger.error('rollback diagnostic persistence failed', error); recoveryFailures.push('configuration-rollback-metadata'); }
                }
                runtimeResult.partial = recoveryFailures.length > 0;
                runtimeResult.failedScopes.push(...recoveryFailures);
                this.sendApiFailure(res, 400, {
                    message: 'Unable to restart tunneling server.',
                    partial: runtimeResult.partial,
                    forwardPort: tunnelingOption.forwardPort,
                    failedScopes: runtimeResult.failedScopes,
                    warnings: runtimeResult.warnings,
                    revisionState: serverOptionStore.revisionState
                });
                return;
            }
            this.sendApiSuccess(res, {
                forwardPort: tunnelingOption.forwardPort,
                revisionState: commitResult.revisionState
            });
        });
    }

    private admitCertificateRevision(res: ServerResponse, revision: unknown): boolean {
        if(!Number.isSafeInteger(revision) || (revision as number) <= 0) {
            this.sendApiFailure(res, 400, {message: 'A positive safe-integer expectedCertificateRevision is required.'});
            return false;
        }
        if(revision !== CertificationStore.instance.revisionState.currentRevision) {
            this.sendApiFailure(res, 409, {message: 'Certificate changed. Reload before saving.', certificateRevisionState: CertificationStore.instance.revisionState});
            return false;
        }
        return true;
    }

    private async applyCompoundTunnelingOption(res: ServerResponse, option: TunnelingOption, certInfo: CertInfo | undefined,
        expectedCertificateRevision: unknown, previousForwardPort?: number): Promise<void> {
        const store = ServerOptionStore.instance, certificates = CertificationStore.instance;
        if(previousForwardPort !== undefined && (!Number.isSafeInteger(previousForwardPort) || previousForwardPort < 1 || previousForwardPort > 65535 || !store.getTunnelingOption(previousForwardPort))) {
            this.sendApiFailure(res, 400, {message: 'The original configured row does not exist.'}); return;
        }
        const rename = previousForwardPort !== undefined && previousForwardPort !== option.forwardPort;
        const previousOption = store.getTunnelingOption(option.forwardPort);
        if(rename && previousOption) {
            this.sendApiFailure(res, 409, {message: 'The target port is already a configured row.'}); return;
        }
        const certificateChange = certInfo !== undefined || (rename && certificates.getAllExternalCert()[previousForwardPort!] !== undefined);
        if(certificateChange && !this.admitCertificateRevision(res, expectedCertificateRevision)) return;
        if(!certificates.hasValidFileNames(certInfo)) { this.sendApiFailure(res, 400, {message: 'Invalid certificate filename.'}); return; }
        if(certInfo !== undefined && (!certInfo || !certInfo.key || !certInfo.cert || !certInfo.ca ||
            !ObjectUtil.equalsType(EMPTY_CERT_INFO, certInfo) || !certificates.prepareExternalServerCert(certInfo))) {
            this.sendApiFailure(res, 400, {message: 'Invalid certificate.'}); return;
        }
        const composed = store.composeServerOptionWithTunnelingOption(ObjectUtil.cloneDeep(option));
        if(!composed.success || !composed.serverOption) {
            this.sendApiFailure(res, 400, {message: 'Tunneling options update failed.'}); return;
        }
        if(rename) composed.serverOption.tunnelingOptions = composed.serverOption.tunnelingOptions.filter(row => row.forwardPort !== previousForwardPort);
        if(!previousOption && !await UsablePortChecker.check(option.forwardPort)) {
            this.sendApiFailure(res, 400, {message: `${option.forwardPort} is an unusable port number.`}); return;
        }
        const certificateBefore = certificates.captureCommittedState(certInfo ? {info: certInfo, type: 'external'} : undefined);
        if(!certificateBefore) { this.sendApiFailure(res, 400, {message: 'Invalid certificate filename.'}); return; }
        const committedBefore = store.captureCommittedState();
        const runtimeBefore = this._tttServer?.captureRuntimeState();
        const prepared = store.prepareServerOptionCommit(composed.serverOption);
        if(!prepared.prepared) {
            this.sendApiFailure(res, 400, {message: prepared.message}); return;
        }
        const preparedCertificate = certificateChange ? certificates.prepareExternalCertificateChange(option.forwardPort, certInfo, rename ? previousForwardPort : undefined) : undefined;
        if(certificateChange && !preparedCertificate) { this.sendApiFailure(res, 400, {message: 'Invalid certificate filename.'}); return; }
        try {
            Files.writeAtomicBatchSync([...prepared.prepared.files, ...(preparedCertificate?.files ?? [])]);
        } catch(error) {
            const failedPaths = (error as {recoveryFailedPaths?: string[]}).recoveryFailedPaths ?? [];
            const failedScopes = [...new Set(failedPaths.map(file => prepared.prepared!.files.some(entry => entry.file.toString() === file) ? 'configuration-restore' : 'certificate-restore'))];
            this.sendApiFailure(res, 500, {message: `Compound publication failed: ${error}`, partial: failedScopes.length > 0, failedScopes}); return;
        }
        store.publishPreparedServerOption(prepared.prepared);
        if(preparedCertificate) certificates.publishPreparedCertificateChange(preparedCertificate);
        let runtime: Awaited<ReturnType<TTTServer['applyTunnelingOption']>> =
            {success: false, partial: false, failedScopes: ['server-runtime'], warnings: [], restartRequiredScopes: []};
        try {
            if(this._tttServer) runtime = await this._tttServer.applyTunnelingOption(store.getTunnelingOption(option.forwardPort)!, previousOption, certInfo);
            if(runtime.success && rename && !await this._tttServer!.stopExternalPortServer(previousForwardPort!, true)) {
                runtime.success = false; runtime.failedScopes.push(`external-listener:${previousForwardPort}`);
            }
        } catch(error) {
            logger.error('compound runtime apply failed', error);
            runtime = {success: false, partial: false, failedScopes: [`external-listener:${option.forwardPort}`], warnings: [], restartRequiredScopes: []};
        }
        if(!runtime.success) {
            const recoveryFailures = preparedCertificate ? await this.restoreCertificateBaseline(certificateBefore) : [];
            recoveryFailures.push(...await this.restoreConfigurationBaseline(committedBefore, runtimeBefore));
            if(recoveryFailures.length === 0) {
                try { store.recordRollback('compound apply failed; prior baseline restored', runtime.failedScopes,
                    committedBefore.revisionState.currentRevision + 1, committedBefore.revisionState.currentRevision); }
                catch(error) { logger.error('rollback diagnostic persistence failed', error); recoveryFailures.push('configuration-rollback-metadata'); }
            }
            this.sendApiFailure(res, 400, {message: 'Unable to apply compound tunneling option.', partial: recoveryFailures.length > 0,
                failedScopes: [...runtime.failedScopes, ...recoveryFailures], revisionState: store.revisionState, certificateRevisionState: certificates.revisionState}); return;
        }
        this.sendApiSuccess(res, {forwardPort: option.forwardPort, revisionState: store.revisionState, certificateRevisionState: certificates.revisionState});
    }

    /** U2-08 / #100: 슈퍼유저만 소유자를 바꾼다. 리스너 설정은 그대로이므로 런타임 재적용이 없다. */
    private onReassignTunnelOwner = async (ctx: RouteContext) => {
        const {res} = ctx;
        const port = await this.getNumberInPath(ctx, 'port');
        if(port == undefined) return;
        await this.mutateConfiguration(res, ctx.body, async (serverOptionStore) => {
            const option = serverOptionStore.getTunnelingOption(port);
            if(!option) {
                this.sendApiFailure(res, 404, {code: 'not_found', message: `External port(${port}) is not configured.`});
                return;
            }
            const resolved = resolveOwnerId(ctx.body?.ownerId);
            if(!resolved.success) {
                this.sendApiFailure(res, resolved.status, {code: resolved.code, message: resolved.message});
                return;
            }
            const from = AuthorizationContext.ownerIdOf(option);
            const composed = serverOptionStore.composeServerOptionWithTunnelingOption({...option, ownerId: resolved.ownerId});
            if(!composed.success || !composed.serverOption) {
                this.sendApiFailure(res, 400, {message: 'Tunnel owner update failed.', forwardPort: port});
                return;
            }
            const commitResult = serverOptionStore.commitPreparedServerOption(composed.serverOption);
            if(!commitResult.success) {
                serverOptionStore.recordRollback('tunnel owner commit failed', ["tunneling-option"]);
                this.sendApiFailure(res, 500, {message: 'Unable to commit tunnel owner.', forwardPort: port,
                    failedScopes: ["tunneling-option"], revisionState: serverOptionStore.revisionState});
                return;
            }
            ctx.auditDetail({from, to: resolved.ownerId});
            this.sendApiSuccess(res, {forwardPort: port, owner: ownerViewOf(port), revisionState: commitResult.revisionState});
        });
    }

    private onRemoveTunnelingOption = async (ctx: RouteContext) => {
        const {res} = ctx;
        const json = ctx.body;
        await this.mutateConfiguration(res, json, async (serverOptionStore) => {
            let forwardPort = json['forwardPort'];
            let previousOption = serverOptionStore.getTunnelingOption(forwardPort);
            if(!previousOption) {
                this.sendApiFailure(res, 404, {message: `External port(${forwardPort}) server already removed.`, forwardPort});
                return;
            }
            const committedBefore = serverOptionStore.captureCommittedState();
            const runtimeBefore = this._tttServer?.captureRuntimeState?.();
            let composeResult = serverOptionStore.composeServerOptionWithoutTunnelingOption(forwardPort);
            if(!composeResult.success || !composeResult.serverOption) {
                this.sendApiFailure(res, 400, {message: `External port(${forwardPort}) server already removed.`, forwardPort});
                return;
            }
            let commitResult = serverOptionStore.commitPreparedServerOption(composeResult.serverOption);
            if(!commitResult.success) {
                serverOptionStore.recordRollback('tunneling option remove commit failed', ["tunneling-option"]);
                this.sendApiFailure(res, 500, {
                    message: `Unable to remove external port(${forwardPort}) configuration.`,
                    forwardPort,
                    failedScopes: ["tunneling-option"],
                    revisionState: serverOptionStore.revisionState
                });
                return;
            }
            let warnings: string[] = [];
            let status = this._tttServer?.externalServerStatus(forwardPort);
            if(status?.online) {
                let stopped = await this._tttServer?.stopExternalPortServer(forwardPort, true);
                if(!stopped) {
                    const recoveryFailures = await this.restoreConfigurationBaseline(committedBefore, runtimeBefore);
                    if(recoveryFailures.length === 0) {
                        try { serverOptionStore.recordRollback('tunneling option remove failed; prior baseline restored', [`external-listener:${forwardPort}`],
                            committedBefore.revisionState.currentRevision + 1, committedBefore.revisionState.currentRevision); }
                        catch(error) { logger.error('rollback diagnostic persistence failed', error); recoveryFailures.push('configuration-rollback-metadata'); }
                    }
                    this.sendApiFailure(res, 400, {
                        message: `Unable to stop external port(${forwardPort}) listener.`,
                        forwardPort,
                        partial: recoveryFailures.length > 0,
                        failedScopes: [`external-listener:${forwardPort}`, ...recoveryFailures],
                        revisionState: serverOptionStore.revisionState
                    });
                    return;
                }
            } else {
                warnings.push(`listener ${forwardPort} was already offline`);
            }
            this.sendApiSuccess(res, {forwardPort, warnings, revisionState: commitResult.revisionState});
        });
    }


    private onGetValidateSession = async (ctx: RouteContext) => {
        const {res} = ctx;
        const session = ctx.session!;
        if(session.userId === 'legacy-admin') {
            this.sendApiSuccess(res, {
                valid: true,
                user: {id: 'legacy-admin', username: LEGACY_ADMIN_USERNAME, displayName: LEGACY_ADMIN_USERNAME, role: 'superuser'},
                mustChangePassword: false,
                mustEnrollMfa: false
            });
            return;
        }
        const user = IdentityStore.instance.user(session.userId);
        if(!user || user.status === 'disabled') {
            await SessionStore.instance.removeSession(session.key);
            this.sendApiFailure(res, 401, {valid: false, message: 'Invalid session'});
            return;
        }
        this.sendApiSuccess(res, {
            valid: true,
            user: {id: user.id, username: user.username, displayName: user.displayName, role: user.role},
            mustChangePassword: user.mustChangePassword,
            mustEnrollMfa: session.mustEnrollMfa === true
        });
    }

    private onLogout = async (ctx: RouteContext) => {
        const {res} = ctx;
        const session = ctx.session!;
        await SessionStore.instance.removeSession(session.key);
        this.expireSessionCookies(res);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true, partial: false, failedScopes: [], warnings: [], message: ''}));
    }

    /**
     * MEDIUM / REQ-12 개선: CSRF 토큰 재발급 엔드포인트.
     * 세션이 유효할 때만 새 토큰을 발급하고 csrfToken 쿠키를 갱신한다.
     * (GET 은 CSRF 게이트 바깥이므로, 탈취 쿠키로 악용되지 않도록 반드시 세션 검증을 선행한다.)
     */
    private onGetCsrfToken = async (ctx: RouteContext) => {
        const {res} = ctx;
        const csrfToken = crypto.randomBytes(32).toString('hex');
        const secure = this._tls ? ' Secure;' : '';
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': [
                `${CSRF_COOKIE_NAME}=${csrfToken}; Path=/; Max-Age=${12 * 60 * 60}; SameSite=Strict;${secure}`
            ]
        });
        res.end(JSON.stringify({success: true, partial: false, failedScopes: [], warnings: [], message: '', csrfToken}));
    }

    /**
     * U2-04 / #96: 본인 비밀번호 변경. mustChangePassword 상태에서는 발급받은 임시 비밀번호가 currentPassword 다.
     * 변경에 성공하면 요청한 세션만 남기고 같은 사용자의 다른 세션을 모두 끊는다.
     */
    private onUpdateMePassword = async (ctx: RouteContext) => {
        const {res} = ctx;
        const principal = ctx.principal!;
        if(principal.legacy) {
            this.sendIdentityStoreUnavailable(res);
            return;
        }
        const newPassword = validatePassword(ctx.body?.['newPassword']);
        if(!newPassword.success) {
            this.sendApiFailure(res, newPassword.status, {code: newPassword.code, message: newPassword.message});
            return;
        }
        const currentPassword = typeof ctx.body?.['currentPassword'] == 'string' ? ctx.body['currentPassword'] : '';
        const store = IdentityStore.instance;
        // 이미 인증된 세션 안에서의 재확인이므로 로그인 실패 백오프 대상이 아니다.
        const verified = await store.verifyPassword(principal.username, currentPassword);
        if(!verified.success) {
            this.sendApiFailure(res, 422, {code: 'current_password_mismatch', message: 'The current password does not match'});
            return;
        }
        const updated = await store.setPassword(principal.userId, newPassword.value, {clearMustChange: true});
        if(!updated.success) {
            this.sendApiFailure(res, updated.status, {code: updated.code, message: updated.message});
            return;
        }
        SessionStore.instance.removeSessionsOfUser(principal.userId, {except: ctx.session!.key});
        this.sendApiSuccess(res, {mustChangePassword: false});
    }

    /** U2-04 / #96: 레거시 admin 승격 안내 배너를 닫는다. */
    private onAcknowledgeMigration = async (ctx: RouteContext) => {
        const {res} = ctx;
        const principal = ctx.principal!;
        if(principal.legacy) {
            this.sendIdentityStoreUnavailable(res);
            return;
        }
        const updated = IdentityStore.instance.updateUser(principal.userId, {migrationAcknowledged: true});
        if(!updated.success) {
            this.sendApiFailure(res, updated.status, {code: updated.code, message: updated.message});
            return;
        }
        this.sendApiSuccess(res);
    }

    /** 로그아웃과 본인 세션 강제 종료(#113)가 함께 쓰는 만료 쿠키. writeHead 전에 불러야 한다. */
    private expireSessionCookies(res: ServerResponse): void {
        const secure = this._tls ? ' Secure;' : '';
        res.setHeader('Set-Cookie', [
            `sessionKey=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict;${secure}`,
            `${CSRF_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Strict;${secure}`
        ]);
    }

    private sendIdentityStoreUnavailable(res: ServerResponse): void {
        this.sendApiFailure(res, 503, {code: 'identity_store_unavailable', message: 'Identity store is unavailable'});
    }

    private onGetAdminCert = async (ctx: RouteContext) => {
        const {res} = ctx;
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            let certStore = CertificationStore.instance;
            let certInfo = certStore.getAdminCert();
            this.sendApiSuccess(res, {certInfo: certInfo, revisionState: certStore.revisionState});
        });
    }

    private getNumberInPath = async (ctx: RouteContext, paramName: string, errorMessage: string ='Invalid port' ) : Promise<number | undefined> => {
        let numStr = ctx.params[paramName];
        let num = numStr == undefined ? undefined : parseInt(numStr);
        if(num == undefined || isNaN(num)) {
            this.sendApiFailure(ctx.res, 400, {message:errorMessage});
            return undefined;
        }
        return num;
    }



    private onActiveTunneling = async (ctx: RouteContext) => {
        const {res} = ctx;
        let port = await this.getNumberInPath(ctx, 'port');
        if(port == undefined) return;
        let json = ctx.body;
        let timeout = json['timeout'];
        if(timeout == undefined || isNaN(timeout)) {
            timeout = 0;
        }
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            let success = false;
            if(this._tttServer) {
                success = isTunnelActivationRequested(ctx)
                    ? await this._tttServer.activeExternalPortServer(port, timeout)
                    : await this._tttServer.inactiveExternalPortServer(port);
            }
            this.sendApiEnvelope(res, success ? 200 : 400, {success: success, message: success ? '' : 'Unable to change listener active state'});
        });
    }

    private onDeleteExternalServerCert = async (ctx: RouteContext) => {
        const {res} = ctx;
        let port = await this.getNumberInPath(ctx, 'port');
        if(port == undefined) return;
        const payload = ctx.body;
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            if(!this.admitCertificateRevision(res, payload?.expectedCertificateRevision)) return;
            if(!await CertificationStore.instance.removeForExternalServer(port)) {
                this.sendApiFailure(res, 400, {message: 'Invalid certificate filename.'}); return;
            }
            this.sendApiSuccess(res, {revisionState: CertificationStore.instance.revisionState});
        });
    }

    private onUpdateExternalServerCert = async (ctx: RouteContext) => {
        const {res} = ctx;
        let port = await this.getNumberInPath(ctx, 'port');
        if(port == undefined) return;
        let json = ctx.body;
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            let certInfo = json['certInfo'];
            let certStore = CertificationStore.instance;
            let previousCert = certStore.getExternalCert(port);
            if(!ObjectUtil.equalsType(EMPTY_CERT_INFO, certInfo) || !certStore.prepareExternalServerCert(certInfo)) {
                this.sendApiFailure(res, 400, {message: 'Invalid certificate'});
                return;
            }
            const committedBefore = certStore.captureCommittedState({info: certInfo, type: 'external'});
            if(!committedBefore) { this.sendApiFailure(res, 400, {message: 'Invalid certificate filename.'}); return; }
            const runtimeBefore = this._tttServer?.captureRuntimeState?.();
            let success = await certStore.commitExternalServerCert(port, certInfo, {
                markLastKnownGood: true,
                pendingRestartScopes: []
            });
            if(!success) {
                certStore.recordRollback('external certificate commit failed', [`external-cert:${port}`]);
                this.sendApiFailure(res, 500, {
                    message: 'Unable to commit certificate',
                    failedScopes: [`external-cert:${port}`],
                    revisionState: certStore.revisionState
                });
                return;
            }
            let runtimeResult = await this._tttServer?.applyExternalServerCert(port, certInfo, previousCert) ?? {
                success: false,
                partial: false,
                warnings: [],
                failedScopes: [`external-cert:${port}`],
                restartRequiredScopes: []
            };
            if(!runtimeResult.success) {
                const recoveryFailures = await this.restoreCertificateBaseline(committedBefore, runtimeBefore);
                if(recoveryFailures.length === 0) {
                    try { certStore.recordRollback('runtime apply failed; prior baseline restored', runtimeResult.failedScopes,
                        committedBefore.revisionState.currentRevision + 1, committedBefore.revisionState.currentRevision); }
                    catch(error) { logger.error('certificate rollback diagnostic persistence failed', error); recoveryFailures.push('certificate-rollback-metadata'); }
                }
                runtimeResult.partial = recoveryFailures.length > 0;
                runtimeResult.failedScopes.push(...recoveryFailures);
                this.sendApiFailure(res, 400, {
                    message: 'Invalid certificate',
                    partial: runtimeResult.partial,
                    failedScopes: runtimeResult.failedScopes,
                    warnings: runtimeResult.warnings,
                    revisionState: certStore.revisionState
                });
                return;
            }
            this.sendApiSuccess(res, {
                partial: runtimeResult.partial,
                warnings: runtimeResult.warnings,
                restartRequiredScopes: runtimeResult.restartRequiredScopes,
                revisionState: certStore.revisionState
            });
        });
    }

    private onGetVersion = async (ctx: RouteContext) => {
        let version = Environment.version;
        this.sendApiSuccess(ctx.res, {name: version.name, build: version.build});
    }


    private onGetExternalServerCert = async (ctx: RouteContext) => {
        const {res} = ctx;
        let port = await this.getNumberInPath(ctx, 'port');
        if(port == undefined) return;
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            let certStore = CertificationStore.instance;
            let certInfo = certStore.getExternalCert(port);
            if(certInfo == undefined) {
                this.sendApiFailure(res, 400, {message: 'Invalid port'});
                return;
            }
            this.sendApiSuccess(res, {certInfo: certInfo, revisionState: certStore.revisionState});
        });
    }


    private onGetClientSysInfo = async (ctx: RouteContext) => {
        const {res} = ctx;
        let id = await this.getNumberInPath(ctx, 'id', "Invalid client ID");
        if(id == undefined) return;
        let sysInfo = this._tttServer?.getClientSysInfo(id);
        if(sysInfo == undefined) {
            this.sendApiFailure(res, 400, {message: 'Invalid client ID'});
            return;
        }
        this.sendApiSuccess(res, {sysInfo});
    }

    // noinspection JSUnusedLocalSymbols
    private getQueryParam(req: IncomingMessage) : Map<string, string> {
        let url = req.url;
        let param = new Map<string, string>();
        if(url == undefined) {
            return param;
        }
        let paramIndex = url.indexOf('?');
        if(paramIndex == -1) {
            return param;
        }
        let paramStr = url.substring(paramIndex + 1);
        let paramParts = paramStr.split('&');
        for (let i = 0; i < paramParts.length; i++) {
            let paramPart = paramParts[i];
            let paramPartParts = paramPart.split('=');
            if(paramPartParts.length == 2) {
                let key = paramPartParts[0].trim();
                let value = paramPartParts[1].trim();
                param.set(key, value);
            }
        }
        return param;
    }



    private onLogin = async (ctx: RouteContext) => {
        await this.performLogin(ctx);
        // 성공은 completeLogin 이 남긴다(새 세션 해시를 그곳에서만 알 수 있다).
        if(ctx.res.statusCode === 200) return;
        // username 이 없으면 'admin' 으로 적지 않는다(별칭은 #102 에서 지웠다). 다른 계정에 실패가 쌓이지 않게 한다.
        const username = typeof ctx.body?.['username'] == 'string' ? ctx.body['username'] : '(missing)';
        this.emitAudit({
            at: this.now(), actor: {userId: 'system'}, ip: ctx.ip,
            type: AUDIT_EVENT_TYPES.login_failure, outcome: 'failure',
            summary: `login_failure ${username}`, detail: {username}
        });
    }

    private performLogin = async (ctx: RouteContext) => {
        const {req, res} = ctx;
        const json: any = ctx.body;
        // 단일 관리자 암호이므로 제출 값과 무관하게 네트워크 버킷으로 집계한다.
        // 본문 검증보다 먼저 판정한다 — 차단된 IP가 형식 오류로 401을 받아 백오프를
        // 우회하거나, 차단 상태를 401/429로 구분당하지 않게 한다.
        if(this.isLoginBlocked(req)) {
            this.sendApiFailure(res, 429, {message: 'Too many login attempts'});
            return;
        }

        // #102 (U2-10): 로그인 본문은 {username, password} 하나다. 옛 {key} 별칭과 username 기본값('admin')은 지웠다.
        const password = (typeof json?.['password'] == 'string' ? json['password'] : '').trim();
        const bootstrapToken = typeof json?.['bootstrapToken'] == 'string' ? json['bootstrapToken'] : undefined;

        // username 이 없거나 형식이 틀리면 부트스트랩 중에는 403 invalidUsername, 그 밖에는 401 이다.
        let username = '';
        let invalidUsername = false;
        const usernameResult = validateUsername(json?.['username']);
        if(usernameResult.success) {
            username = usernameResult.value;
        } else {
            invalidUsername = true;
        }

        if(invalidUsername) {
            // 형식 실패도 실패 횟수에 넣는다(비밀번호 오류와 같은 비용을 치르게 해 username 열거·탐색을 막는다).
            this.recordLoginFailure(req);
            await this.delayFailedLogin(req);
            if(IdentityMigration.bootstrapRequired()) {
                this.sendApiFailure(res, 403, {
                    bootstrapRequired: true, invalidBootstrapToken: false, weakPassword: false, invalidUsername: true
                });
                return;
            }
            this.sendApiFailure(res, 401);
            return;
        }

        if(IdentityMigration.bootstrapRequired()) {
            const result = await IdentityMigration.completeBootstrap({username, password, bootstrapToken});
            if(!result.success) {
                this.recordLoginFailure(req);
                await this.delayFailedLogin(req);
                if(!result.bootstrapRequired) {
                    // completeBootstrap이 부트스트랩 플래그가 이미 꺼진 상태에서 호출된 경우(레이스).
                    this.sendApiFailure(res, 401);
                    return;
                }
                this.sendApiFailure(res, result.weakPassword ? 400 : 403, {
                    bootstrapRequired: true,
                    invalidBootstrapToken: result.invalidBootstrapToken,
                    weakPassword: result.weakPassword,
                    invalidUsername: result.invalidUsername
                });
                return;
            }
            await this.completeLogin(req, res, result.user.id, {
                id: result.user.id, username: result.user.username, displayName: result.user.displayName, role: result.user.role
            }, result.user.mustChangePassword);
            return;
        }

        if(IdentityStore.instance.mode === 'legacy-fallback') {
            const legacyOk = await IdentityMigration.verifyLegacyKey(password);
            if(!legacyOk) {
                this.recordLoginFailure(req);
                await this.delayFailedLogin(req);
                this.sendApiFailure(res, 401);
                return;
            }
            await this.completeLogin(req, res, 'legacy-admin', {
                id: 'legacy-admin', username: LEGACY_ADMIN_USERNAME, displayName: LEGACY_ADMIN_USERNAME, role: 'superuser'
            }, false);
            return;
        }

        const verifyResult = await IdentityStore.instance.verifyPassword(username, password);
        if(!verifyResult.success) {
            // not-found/disabled/mismatch를 구분하지 않는다(사용자 열거 방지).
            this.recordLoginFailure(req);
            await this.delayFailedLogin(req);
            this.sendApiFailure(res, 401);
            return;
        }
        const user = verifyResult.user;
        if(user.mfa?.enabled === true) {
            // #127 (U4-08): 2단계가 끝나야 성공이다. 실패 카운터 초기화·login_success·쿠키는 /api/login/mfa 가 한다.
            const mfaTicket = this._mfa.tickets.issue(user.id, this.getClientAddress(req));
            this.sendApiSuccess(res, {mfaRequired: true, mfaTicket});
            return;
        }
        await this.completeLogin(req, res, user.id, {
            id: user.id, username: user.username, displayName: user.displayName, role: user.role
        }, user.mustChangePassword);
    }

    /**
     * 로그인 성공 공통 경로: 실패 카운터 초기화 → 세션 발급 → 세션/CSRF 쿠키 발급.
     */
    private async completeLogin(req: IncomingMessage, res: ServerResponse, userId: string,
                                 user: {id: string; username: string; displayName: string; role: string},
                                 mustChangePassword: boolean): Promise<void> {
        this.resetLoginAttempts(req);
        const userAgent = req.headers['user-agent'];
        // #127 (U4-08): 슈퍼유저 MFA 강제는 로그인 시점에만 계산한다(이미 열린 세션은 소급하지 않는다).
        const mustEnrollMfa = ServerOptionStore.instance.serverOption.mfaRequiredForSuperusers === true && user.role === 'superuser'
            && userId !== 'legacy-admin' && IdentityStore.instance.user(userId)?.mfa?.enabled !== true;
        const sessionKey = await SessionStore.instance.newSession(userId, {
            ip: this.getClientAddress(req),
            userAgent: typeof userAgent == 'string' ? userAgent : undefined,
            mustEnrollMfa
        });
        // P5-T4 / REQ-12: 로그인 성공 시 CSRF 쿠키도 함께 발급 (double-submit).
        const csrfToken = crypto.randomBytes(32).toString('hex');
        const secure = this._tls ? ' Secure;' : '';
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': [
                `sessionKey=${sessionKey}; Path=/; Max-Age=${12 * 60 * 60}; HttpOnly; SameSite=Strict;${secure}`,
                // CSRF 토큰은 JS에서 읽어 헤더에 실어야 하므로 HttpOnly 금지.
                `${CSRF_COOKIE_NAME}=${csrfToken}; Path=/; Max-Age=${12 * 60 * 60}; SameSite=Strict;${secure}`
            ]
        });
        res.end(JSON.stringify({success: true, partial: false, failedScopes: [], warnings: [], message: '', csrfToken, user, mustChangePassword, mustEnrollMfa}));
        // PRD K2 는 role=superuser 로 집계하므로 actor.role 을 반드시 채운다.
        this.emitAudit({
            at: this.now(), actor: {userId: user.id, username: user.username, role: user.role as Role},
            sessionIdHash: SessionStore.sessionIdOf(sessionKey), ip: this.getClientAddress(req),
            type: AUDIT_EVENT_TYPES.login_success, target: {kind: 'user', id: user.id},
            outcome: 'success', summary: `login_success ${user.id}`
        });
    }


    /**
     * P5-T3 / REQ-11: JSON 본문 상한 1MiB. 초과 시 413 응답 후 소켓 파괴.
     * 이 정적 헬퍼는 상한 초과를 예외로 전파하므로, 호출부는 상위 try/catch에서 처리하거나
     * 본 클래스의 readJsonOrFail 편의 메서드를 사용해야 한다.
     */
    private static async readJson(req: IncomingMessage, maxBytes: number = ADMIN_JSON_BODY_LIMIT_BYTES) : Promise<any> {
        return new Promise<any>((resolve, reject) => {
            let received = 0;
            let chunks: Buffer[] = [];
            let aborted = false;
            const finish = (fn: () => void) => {
                if(aborted) return;
                aborted = true;
                fn();
            };
            req.on('data', (chunk: Buffer | string) => {
                if(aborted) return;
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                // MEDIUM / REQ-11 개선: push 전에 상한 초과를 선판정해 메모리 피크를 억제한다.
                if(received + buf.length > maxBytes) {
                    finish(() => {
                        const err: any = new Error(`request body exceeds ${maxBytes} bytes`);
                        err.code = 'E_BODY_TOO_LARGE';
                        try { req.destroy(err); } catch {}
                        reject(err);
                    });
                    return;
                }
                received += buf.length;
                chunks.push(buf);
            });
            req.on('end', () => {
                finish(() => {
                    try {
                        const data = Buffer.concat(chunks).toString('utf8');
                        const json = data.length == 0 ? {} : JSON.parse(data);
                        resolve(json);
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', (err) => {
                finish(() => reject(err));
            });
            req.on('timeout', () => {
                finish(() => {
                    const err: any = new Error('request idle timeout');
                    err.code = 'E_REQ_TIMEOUT';
                    try { req.destroy(err); } catch {}
                    reject(err);
                });
            });
        });
    }

    private resolveSession = (req: IncomingMessage) : Session | undefined => {
        const sessionKey = AdminServer.getSessionKey(req);
        if(sessionKey.length === 0) {
            return undefined;
        }
        return SessionStore.instance.resolveSession(sessionKey);
    }


    private onGetServerOption = async (ctx: RouteContext) => {
        const {req, res} = ctx;
        // P5-T1 / REQ-03: Vary + CORS whitelist. 자기 호스트 아닐 시 CORS 헤더 생략.
        this.applySelfOriginCorsHeaders(req, res);
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            let store = ServerOptionStore.instance;
            // P5-T1 / REQ-03: store.serverOption 은 cloneDeep 복사본을 반환하지만,
            // delete 연산 의존성을 제거하기 위해 구조 분해로 tunnelingOptions 를 제외한 신규 객체 구성.
            const cloned = ObjectUtil.cloneDeep(store.serverOption) as any;
            const { tunnelingOptions: _omit, ...pureServerOption } = cloned;
            void _omit;
            this.sendApiSuccess(res, {serverOption: pureServerOption, revisionState: store.revisionState});
        });
    }


    private onGetSysInfo = async (ctx: RouteContext) => {
        const {res} = ctx;
        let status = await SysMonitor.instance.sysInfo();
        this.sendApiSuccess(res, {sysInfo: status});
    }

    private onGetSysUsage = async (ctx: RouteContext) => {
        const {res} = ctx;
        let status = await SysMonitor.instance.usage();
        this.sendApiSuccess(res, {sysUsage: status});
    }

    private onGetClientStatus = async (ctx: RouteContext) => {
        const {res} = ctx;
        let status = this._tttServer?.clientStatus();
        this.sendApiSuccess(res, {statuses: status ?? []});
    }


    private onGetTunnelingOption = async (ctx: RouteContext) => {
        const {res} = ctx;
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            let store = ServerOptionStore.instance;
            let tunnelingOptions = store.serverOption.tunnelingOptions;
            for(let tunnelingOption of tunnelingOptions) {
                tunnelingOption.keepAlive = tunnelingOption.keepAlive ?? TCPServer.DEFAULT_KEEP_ALIVE;
            }
            const principal = ctx.principal!;
            const visible = tunnelingOptions
                .filter((tunnelingOption) => isTunnelVisibleTo(principal, tunnelingOption.forwardPort))
                .map((tunnelingOption) => ({
                    ...tunnelingOption,
                    owner: ownerViewOf(tunnelingOption.forwardPort),
                    editable: isTunnelEditable(principal, tunnelingOption.forwardPort)
                }));
            this.sendApiSuccess(res, {tunnelingOptions: visible, revisionState: store.revisionState});
        });
    }

    private onGetExternalServerStatuses = async (ctx: RouteContext) => {
        const {res} = ctx;
        let statuses = this._tttServer?.externalServerStatuses() ?? [];
        // 목록과 같은 가시성 판정을 쓴다. 상태로 남의 터널 존재가 새지 않게 한다.
        statuses = statuses.filter((status) => isTunnelVisibleTo(ctx.principal!, status.port));
        this.sendApiSuccess(res, {serverTime: Date.now(), statuses});
    }

    // U5-02 / #117 — 차단 목록 조회·해제 API. 권한은 라우트 표의 security:manage 가 본다.
    // #120 (U5-05) — 국가 DB 가 이미 로드되어 있으면 항목마다 국가를 싣는다. 조회 때문에 로드하지는 않는다.
    private onGetSecurityBans = async (ctx: RouteContext) => {
        const {res} = ctx;
        const now = Date.now();
        const geo = AdmissionController.instance.geo;
        const bans = AdmissionController.instance.rateLimiter.bans(now).map((ban) => {
            const country = geo.lookupCountry(ban.ip);
            return country === undefined ? ban : {...ban, country};
        });
        this.sendApiSuccess(res, {serverTime: now, bans});
    }

    private onDeleteSecurityBan = async (ctx: RouteContext) => {
        const {res} = ctx;
        const port = Number(ctx.params.port);
        if(!Number.isInteger(port) || port < 1 || port > 65535) {
            this.sendApiFailure(res, 400, {message: 'invalid port'});
            return;
        }
        const ip = decodedPathSegment(ctx.params.ip);
        if(ip === undefined || ip.length === 0) {
            this.sendApiFailure(res, 400, {message: 'invalid ip'});
            return;
        }
        // unban 은 입력 IP 를 정규화하지 않는다. 리미터가 저장한 문자열과 같아야 지워진다.
        const removed = AdmissionController.instance.rateLimiter.unban(port, ip);
        ctx.auditDetail({port, ip, removed});
        this.sendApiSuccess(res, {removed});
    }

    // U5-04 / #119 — 포트별 거절 수·차단 IP 수 조회. #120 (U5-05) 이 현재 GeoConfig 를 함께 싣는다.
    private onGetSecurityStats = async (ctx: RouteContext) => {
        const {res} = ctx;
        // 설정을 읽지 못한 상태면 런타임 필터도 기본값으로 떠 있으므로 기본값을 싣는다. 집계는 설정과 무관하게 보여 준다.
        const geo = this.storedGeoConfig() ?? {...DEFAULT_GEO_CONFIG, countries: []};
        this.sendApiSuccess(res, {serverTime: Date.now(), stats: {geo, ...AdmissionController.instance.snapshot()}});
    }

    // U5-05 / #120 — 국가 필터 조회·저장과 국가 목록.
    // PUT 의 "부분 허용" 은 빠진 필드를 기본값으로 채운다는 뜻이다(normalizeConnectionSecurity). 현재값과 병합하지 않는다.
    // 저장된 GeoConfig. 저장값이 없으면 기본값이고, 설정을 아직 읽지 못했으면 undefined 다.
    private storedGeoConfig(): GeoConfig | undefined {
        const read = ServerOptionStore.instance.readServerOption();
        if(!read.success) return undefined;
        return read.serverOption.connectionSecurity?.geo ?? {...DEFAULT_GEO_CONFIG, countries: []};
    }

    private onGetSecurityGeo = async (ctx: RouteContext) => {
        const geo = this.storedGeoConfig();
        if(geo === undefined) {
            this.sendApiFailure(ctx.res, 503, {message: 'server configuration is not ready'});
            return;
        }
        this.sendApiSuccess(ctx.res, {geo});
    }

    private onUpdateSecurityGeo = async (ctx: RouteContext) => {
        const {res} = ctx;
        const normalized = normalizeConnectionSecurity({geo: ctx.body});
        if(!normalized.success) {
            this.sendApiFailure(res, 422, {message: normalized.message});
            return;
        }
        const value = normalized.value;
        let committed = false;
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            const store = ServerOptionStore.instance;
            const read = store.readServerOption();
            if(!read.success) return;
            const serverOption = read.serverOption;
            serverOption.connectionSecurity = value;
            committed = store.commitPreparedServerOption(serverOption).success;
        });
        if(!committed) {
            this.sendApiFailure(res, 500, {message: 'Unable to commit server option.'});
            return;
        }
        // 런타임 반영은 applyServerOption 이 아니라 이 전용 진입점으로만 한다(#118 U5-03).
        this._tttServer?.applyConnectionSecurity(value);
        // 감사 메타는 요청 전에 계산되므로 정규화된 값은 여기서 더한다.
        ctx.auditDetail({...value.geo});
        this.sendApiSuccess(res, {geo: value.geo, warnings: normalized.warnings});
    }

    private onGetSecurityCountries = async (ctx: RouteContext) => {
        this.sendApiSuccess(ctx.res, {countries: listCountries()});
    }


    private onGetServerOptionHash = async (ctx: RouteContext) => {
        const {req, res} = ctx;
        // P5-T1 / REQ-03: 자기 호스트 CORS 화이트리스트 + Vary: Origin 항상.
        const corsHeaders = this.buildSelfOriginCorsHeaders(req);
        // P5-T1 / REQ-03: cloneDeep 후 구조 분해로 tunnelingOptions 제외 — 런타임 상태 파괴 방지.
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            const storeOption = ServerOptionStore.instance.serverOption;
            const cloned = ObjectUtil.cloneDeep(storeOption) as any;
            const { tunnelingOptions: _omit, ...pureServerOption } = cloned;
            void _omit;
            const adminCert = CertificationStore.instance.getAdminCert();
            const hash = createHash('sha512').update(JSON.stringify(pureServerOption) + JSON.stringify(adminCert)).digest('hex');
            res.writeHead(200, {'Content-Type': 'application/json', 'Vary': 'Origin', ...corsHeaders});
            res.end(JSON.stringify({success: true, partial: false, failedScopes: [], warnings: [], message: '', hash: hash}));
        });
    }


    public async listen(port : number, host?: string)  : Promise<number> {
        clearInterval(this._mfaSweepTimer);
        this._mfaSweepTimer = setInterval(() => { this._mfa.pending.sweep(); this._mfa.tickets.sweep(); }, 60_000).unref();
        // P5-T6 / REQ-19: listen 전용 핸들러를 named function 으로 등록해 listen 종료 후 removeListener(named).
        // removeAllListeners 를 호출하면 생성자에서 등록한 영구 핸들러(_permanentErrorHandler)까지 제거되므로 절대 사용 금지.
        return new Promise((resolve, reject) => {
            const onListening = () => {
                const address = this._server.address();
                const actualPort = typeof address == 'object' && address ? address.port : port;
                const actualHost = typeof address == 'object' && address ? address.address : (host ?? "");
                logger.info(`Admin server listening on ${actualHost}:${actualPort}`);
                this._server.removeListener('listening', onListening);
                this._server.removeListener('error', onListenError);
                this._port = actualPort;
                this._bindHost = (host && host.length > 0) ? host : (typeof actualHost == 'string' ? actualHost : '');
                resolve(actualPort);
            };
            const onListenError = (err: Error) => {
                logger.error(`Admin server error on port ${port}`, err);
                this._server.removeListener('listening', onListening);
                this._server.removeListener('error', onListenError);
                try { this._server.close(); } catch {}
                this._port = -1;
                reject(err);
            };
            this._server.on('listening', onListening);
            this._server.on('error', onListenError);
            if(host && host.length > 0) {
                this._server.listen(port, host);
            } else {
                this._server.listen(port);
            }
        });
    }

    public async close() : Promise<boolean> {
        logger.info(`AdminServer.close()`);
        clearInterval(this._mfaSweepTimer);
        this._mfaSweepTimer = undefined;
        if(this._port < 0) {
            logger.info(`Admin server is already closed on port ${this._port}`);
            return false;
        }
        // P5-T6 / REQ-19: 영구 error 핸들러는 유지 (재시작 시에도 동일 인스턴스 재사용 가능해야 함).
        // removeAllListeners 사용 금지. listening/request 리스너만 선택적으로 제거.
        return new Promise((resolve) => {
            this._server.removeAllListeners('listening');
            try { (this._server as any).closeAllConnections?.(); } catch {}
            this._server.close((err) => {
                logger.info(`Admin server closed on port ${this._port}`);
                this._port = -1;
                setImmediate(() => {
                    resolve(err == undefined);
                });

            });
        });
    }

    private contentTypeFromExt = (ext: string) : string => {
        ext = ext.toLowerCase();
        let contentType = 'application/octet-stream';
        if(ext == '.html')
            contentType = 'text/html; charset=utf-8';
        else if(ext == '.js')
            contentType = 'text/javascript; charset=utf-8';
        else if(ext == '.css')
            contentType = 'text/css; charset=utf-8';
        else if(ext == '.png')
            contentType = 'image/png';
        else if(ext == '.jpg' || ext == '.jpeg')
            contentType = 'image/jpeg';
        else if(ext == '.gif')
            contentType = 'image/gif';
        else if(ext == '.svg')
            contentType = 'image/svg+xml; charset=utf-8';
        else if(ext == '.ico')
            contentType = 'image/x-icon';
        else if(ext == '.json')
            contentType = 'application/json; charset=utf-8';
        else if(ext == '.ttf')
            contentType = 'font/ttf';
        return contentType;
    }

    private sendApiEnvelope(res: ServerResponse, statusCode: number, payload: {[key: string]: any}): void {
        const body = {
            success: payload.success === true,
            partial: payload.partial === true,
            failedScopes: Array.isArray(payload.failedScopes) ? payload.failedScopes : [],
            warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
            message: typeof payload.message == "string" ? payload.message : "",
            ...payload
        };
        res.writeHead(statusCode, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(body));
    }

    private sendApiSuccess(res: ServerResponse, payload: {[key: string]: any} = {}, statusCode: number = 200): void {
        this.sendApiEnvelope(res, statusCode, {success: true, ...payload});
    }

    private sendApiFailure(res: ServerResponse, statusCode: number, payload: {[key: string]: any} = {}): void {
        this.sendApiEnvelope(res, statusCode, {success: false, ...payload});
    }

    private pathname(url: string = ''): string {
        return url.split('?')[0];
    }

    private normalizeAssetUrl(url: string): string | undefined {
        const pathOnly = this.pathname(url);
        const defaultPath = pathOnly.length == 0 || pathOnly == "/" ? "/index.html" : pathOnly;
        try {
            return decodeURIComponent(defaultPath);
        } catch {
            return undefined;
        }
    }

    private now(): number {
        return ClockRngProvider.current().now();
    }

    /**
     * P5-T2 / REQ-07: 신뢰할 수 있는 클라이언트 원격 IP를 반환.
     * trustXForwardedFor 가 true 일 때만 XFF 헤더 최좌측 IP 신뢰. 기본값(false)에서는 항상 socket.remoteAddress 사용.
     */
    private getClientAddress(req: IncomingMessage): string {
        const allowances = AdminSecurityPolicyRegistry.current();
        if(allowances.trustXForwardedFor) {
            const xff = req.headers['x-forwarded-for'];
            const xffRaw = Array.isArray(xff) ? xff[0] : xff;
            if(typeof xffRaw == 'string' && xffRaw.length > 0) {
                const first = xffRaw.split(',')[0]?.trim();
                if(first && first.length > 0) return first;
            }
        }
        return req.socket.remoteAddress ?? "unknown";
    }

    /**
     * P5-T2 / REQ-07: 네트워크 버킷 (IPv4 /24, IPv6 /64) 계산.
     * 단일 관리자 암호 인증의 실패 횟수를 네트워크별로 집계한다.
     */
    private getNetworkBucket(address: string): string {
        if(!address || address == 'unknown') return 'unknown';
        // IPv6 mapped (::ffff:1.2.3.4) 정규화
        const v6MapMatch = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
        const normalized = v6MapMatch ? v6MapMatch[1] : address;
        if(/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) {
            const parts = normalized.split('.');
            return `v4:${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
        }
        // IPv6: 앞 4그룹(64bit) 만 남김.
        if(normalized.indexOf(':') >= 0) {
            // zone suffix 제거
            const noZone = normalized.split('%')[0];
            // 축약 형태 확장
            const segs = noZone.split(':');
            const head = segs.slice(0, 4).join(':');
            return `v6:${head}::/64`;
        }
        return `raw:${normalized}`;
    }

    private buildLoginAttemptKey(req: IncomingMessage): string {
        return this.getNetworkBucket(this.getClientAddress(req));
    }

    private isLoginBlocked(req: IncomingMessage): boolean {
        const state = this._loginAttempts.get(this.buildLoginAttemptKey(req));
        return state != undefined && state.blockedUntil > this.now();
    }

    private recordLoginFailure(req: IncomingMessage): void {
        const now = this.now();
        const mapKey = this.buildLoginAttemptKey(req);
        let state = this._loginAttempts.get(mapKey);
        if(!state || state.windowStartedAt + LOGIN_WINDOW_MS <= now) {
            state = {failedCount: 0, windowStartedAt: now, blockedUntil: 0, lastSeenAt: now};
        }
        state.failedCount += 1;
        state.lastSeenAt = now;
        if(state.failedCount >= LOGIN_MAX_FAILURES) {
            state.blockedUntil = now + LOGIN_BLOCK_MS;
        }
        // P5-T2 / REQ-07: LRU 상한 10k — Map insertion-order 기반으로 가장 오래된 엔트리 축출.
        if(!this._loginAttempts.has(mapKey) && this._loginAttempts.size >= LOGIN_ATTEMPT_MAP_LIMIT) {
            const oldestKey = this._loginAttempts.keys().next().value as string | undefined;
            if(oldestKey !== undefined) {
                this._loginAttempts.delete(oldestKey);
            }
        }
        // Map 의 LRU 흉내: 기존 키 삭제 후 재삽입하면 insertion-order 재조정.
        this._loginAttempts.delete(mapKey);
        this._loginAttempts.set(mapKey, state);
    }

    private resetLoginAttempts(req: IncomingMessage): void {
        this._loginAttempts.delete(this.buildLoginAttemptKey(req));
    }

    private async delayFailedLogin(req: IncomingMessage): Promise<void> {
        // P5-T2 / REQ-07: 실패 카운트 기반 지수 지연.
        const state = this._loginAttempts.get(this.buildLoginAttemptKey(req));
        const count = state ? state.failedCount : 1;
        const delay = computeBackoffMs(count);
        await new Promise((resolve) => setTimeout(resolve, delay));
    }

    /**
     * P5-T1/P5-T4: 자기 호스트(listen URL)와 Origin 이 일치할 때만 CORS/상태변경 요청 허용.
     * 화이트리스트: listen host + 127.0.0.1 / ::1 / localhost (개발 편의).
     */
    private isOriginAllowed(origin: string | undefined): boolean {
        if(!origin) return false; // Origin 없는 상태변경 요청은 거부 (다만 CSRF 헤더 존재 여부로 별도 판정).
        try {
            const u = new URL(origin);
            const host = u.hostname.toLowerCase();
            // MEDIUM / REQ-12 개선: 포트까지 포함해 비교한다.
            // u.port 는 동일 scheme 기본 포트(80/443)일 때 '' 가 되므로, scheme 기반 기본 포트로 보정.
            const defaultPort = u.protocol === 'https:' ? 443 : (u.protocol === 'http:' ? 80 : 0);
            const originPort = u.port.length > 0 ? parseInt(u.port, 10) : defaultPort;
            const allowedHosts = new Set<string>(['127.0.0.1', '::1', 'localhost']);
            if(this._bindHost && this._bindHost.length > 0 && this._bindHost !== '0.0.0.0' && this._bindHost !== '::') {
                allowedHosts.add(this._bindHost.toLowerCase());
            }
            if(!allowedHosts.has(host)) return false;
            // listen 포트를 알고 있을 때만 포트 일치 강제. listen 전이면(_port < 0) hostname 일치로 폴백.
            if(this._port > 0) {
                return originPort === this._port;
            }
            return true;
        } catch {
            return false;
        }
    }

    private buildSelfOriginCorsHeaders(req: IncomingMessage): Record<string, string> {
        const origin = req.headers['origin'];
        const originStr = Array.isArray(origin) ? origin[0] : origin;
        const headers: Record<string, string> = { 'Vary': 'Origin' };
        if(originStr && this.isOriginAllowed(originStr)) {
            headers['Access-Control-Allow-Origin'] = originStr;
            headers['Access-Control-Allow-Credentials'] = 'true';
        }
        return headers;
    }

    private applySelfOriginCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
        const headers = this.buildSelfOriginCorsHeaders(req);
        for(const [k, v] of Object.entries(headers)) {
            res.setHeader(k, v);
        }
    }

    /**
     * P5-T4 / REQ-12: 상태 변경 요청 가드.
     *  - Origin 헤더가 존재하면 화이트리스트 검증. 화이트리스트 밖이면 403.
     *  - requireCsrfHeader (기본 true): X-CSRF-Token 헤더와 csrfToken 쿠키 double-submit 비교.
     *    둘 다 없으면 동일 오리진으로 간주되더라도 403.
     *  - /api/login 만 CSRF 토큰 헤더 예외 허용 (토큰 발급 전이므로).
     */
    private verifyCsrfGuard(req: IncomingMessage, res: ServerResponse, skipCsrfHeader: boolean): boolean {
        const origin = req.headers['origin'];
        const originStr = Array.isArray(origin) ? origin[0] : origin;
        if(originStr !== undefined && !this.isOriginAllowed(originStr)) {
            this.sendApiFailure(res, 403, {message: 'Forbidden origin'});
            return false;
        }
        const allowances = AdminSecurityPolicyRegistry.current();
        const headerRaw = req.headers[CSRF_HEADER_NAME];
        const headerToken = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
        const cookies = AdminServer.parseCookies(req);
        const cookieToken = cookies.get(CSRF_COOKIE_NAME);
        const sessionCookie = cookies.get('sessionKey');
        const hasSession = sessionCookie !== undefined && sessionCookie.length > 0;

        if(skipCsrfHeader) {
            // /api/login 경로: 토큰 발급 전이므로 CSRF 헤더 검사 스킵.
            return true;
        }

        // HIGH-2 / REQ-12: 세션이 있는 상태변경 요청은 반드시 CSRF double-submit 성립 필요.
        // 쿠키 탈취만으로 CSRF 헤더 없이 상태변경을 호출할 수 없도록 강제.
        if(hasSession) {
            if(!cookieToken || !headerToken) {
                this.sendApiFailure(res, 403, {message: 'Missing CSRF token'});
                return false;
            }
            if(!timingSafeStringEqual(headerToken, cookieToken, 'utf8')) {
                this.sendApiFailure(res, 403, {message: 'CSRF token mismatch'});
                return false;
            }
            return true;
        }

        // 세션 없음 = 로그인 전 또는 non-browser 경로.
        // requireCsrfHeader 가 꺼져 있으면 통과 (기본값은 true).
        if(!allowances.requireCsrfHeader) {
            return true;
        }

        // allowLegacyAdminHttp + requireCsrfHeader 조합 시 non-browser 경로에서도 토큰 헤더를 요구한다.
        if(allowances.allowLegacyAdminHttp) {
            if(!headerToken) {
                this.sendApiFailure(res, 403, {message: 'Missing CSRF token'});
                return false;
            }
            // cookieToken 이 있으면 일치 검증, 없으면 레거시 클라이언트의 헤더-only 경로 허용.
            if(cookieToken && !timingSafeStringEqual(headerToken, cookieToken, 'utf8')) {
                this.sendApiFailure(res, 403, {message: 'CSRF token mismatch'});
                return false;
            }
            return true;
        }

        // 브라우저가 아닌 CLI/서버 간 호출: Origin 없음 + 쿠키에 CSRF 토큰 없음이면 통과.
        if(!cookieToken && !headerToken && originStr === undefined) {
            return true;
        }
        if(!headerToken || !cookieToken) {
            this.sendApiFailure(res, 403, {message: 'Missing CSRF token'});
            return false;
        }
        if(!timingSafeStringEqual(headerToken, cookieToken, 'utf8')) {
            this.sendApiFailure(res, 403, {message: 'CSRF token mismatch'});
            return false;
        }
        return true;
    }



}

export default AdminServer;
