import http, {IncomingMessage, ServerResponse} from "http";
import https from "https";
import ServerOptionStore from "../ServerOptionStore";
import SessionStore from "./SessionStore";
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
import {TunnelingOption} from "../../types/TunnelingOption";

const logger = LoggerFactory.getLogger('server', 'AdminServer');

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

    constructor(tttServer: TTTServer, tls : boolean, certInfo? : CertInfo) {
        this._tttServer = tttServer;
        this._tls = tls;
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

        // P5-T3 / REQ-11: HTTP 서버 수준 타임아웃.
        try {
            (this._server as any).headersTimeout = ADMIN_HEADERS_TIMEOUT_MS;
            (this._server as any).requestTimeout = ADMIN_REQUEST_TIMEOUT_MS;
        } catch { /* no-op: runtime 차이 보호 */ }
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
               const skipCsrfHeader = (url == '/api/login');
               if(!this.verifyCsrfGuard(req, res, skipCsrfHeader)) {
                   return;
               }
           }
           if (method == 'GET') {
                await this.routeGet(req, res, url);
                return;
           }
           else if(method == 'POST') {
                await this.routePost(req, res, url);
                return;
           }
           else if(method == 'PUT') {
                await this.routePost(req, res, url);
                return;
           }
           else if(method == 'DELETE') {
               await this.routeDelete(req, res, url);
               return;
           }

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

    private routeDelete = async (req: IncomingMessage, res: ServerResponse, url: string) => {
        if (url == "/api/tunnelingOption") {
            await this.onRemoveTunnelingOption(req, res);
            return;
        } else if (url.startsWith("/api/externalCert/")) {
            await this.onDeleteExternalServerCert(req, res);
            return;
        }
    }



    private routePost = async (req: IncomingMessage, res: ServerResponse, url: string) => {
        if (url == "/api/login") {
            await this.onLogin(req, res);
            return;
        } else if (url == "/api/adminCert") {
            await this.onUpdateAdminCert(req, res);
        } else if (url == "/api/serverOption") {
            await this.onUpdateServerOption(req, res);
        } else if (url == "/api/tunnelingOption") {
            await this.onUpdateTunnelingOption(req, res);
        } else if (url.startsWith("/api/externalCert/")) {
            await this.onUpdateExternalServerCert(req, res);
            return;
        } else if (url.startsWith("/api/tunneling/active/")) {
            await this.onActiveTunneling(req, res);
            return;
        }
    }

    private routeGet = async (req: IncomingMessage, res: ServerResponse, url: string) => {
        // 캐시 하지 않기.
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

        if (url == "/api/serverOption") {
            await this.onGetServerOption(req, res);
            return;
        } else if(url == '/api/sysInfo') {
            await this.onGetSysInfo(req, res);
        } else if(url == '/api/sysInfo') {
            await this.onGetSysInfo(req, res);
        } else if(url == '/api/sysUsage') {
            await this.onGetSysUsage(req, res);
        } else if(url == '/api/clientStatus') {
            await this.onGetClientStatus(req, res);
        }
        else if (url == "/api/tunnelingOption") {
            await this.onGetTunnelingOption(req, res);
            return;
        } else if (url == "/api/externalServerStatuses") {
            await this.onGetExternalServerStatuses(req, res);
            return;
        } else if(url == "/api/serverOptionHash") {
            await this.onGetServerOptionHash(req, res);
            return;
        } else if (url == "/api/validateSession") {
            await this.onGetValidateSession(req, res);
            return;
        } else if (url == "/api/csrfToken") {
            await this.onGetCsrfToken(req, res);
            return;
        } else if (url == "/api/adminCert") {
            await this.onGetAdminCert(req, res);
            return;
        } else if (url.startsWith("/api/externalCert/")) {
            await this.onGetExternalServerCert(req, res);
            return;
        } else if (url.startsWith("/api/clientSysInfo/")) {
            await this.onGetClientSysInfo(req, res);
            return;
        } else if(url == '/api/version') {
            await this.onGetVersion(req, res);
        }
        else {
            if(url.startsWith("/api/")) {
                this.sendApiFailure(res, 404, {message: `Not Found ${url}`});
                return;
            }
            await this.onGetWebResource(req, res, url);
            return;
        }

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

    private onUpdateAdminCert = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let json = await AdminServer.readJson(req);
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

    private onUpdateServerOption = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        const requestedServerOption = await AdminServer.readJson(req);
        await this.mutateConfiguration(res, requestedServerOption, async (serverOptionStore) => {
            let currentServerOption = serverOptionStore.serverOption;
            let prepareResult = serverOptionStore.prepareServerOption(ObjectUtil.cloneDeep(requestedServerOption));
            if(!prepareResult.success || !prepareResult.serverOption) {
                this.sendApiFailure(res, 400, {message: 'Invalid server option', updated: false});
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
            const hotApplyRequired = currentServerOption.port !== serverOption.port
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


    private onUpdateTunnelingOption = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        const payload = await AdminServer.readJson(req);
        await this.mutateConfiguration(res, payload, async (serverOptionStore) => {
            const {certInfo, expectedCertificateRevision, previousForwardPort, ...tunnelingOption} = payload;
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
            let runtimeResult = await this._tttServer?.applyTunnelingOption(tunnelingOption, previousOption) ?? {
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
            if(this._tttServer) runtime = await this._tttServer.applyTunnelingOption(option, previousOption, certInfo);
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

    private onRemoveTunnelingOption = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        const json = await AdminServer.readJson(req);
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


    private onGetValidateSession = async (req: IncomingMessage, res: ServerResponse) => {
        let valid = await this.validateSession(req);
        if(!valid) {
            this.sendApiFailure(res, 401, {valid: false, message: 'Invalid session'});
            return;
        }
        this.sendApiSuccess(res, {valid: valid});
    }

    /**
     * MEDIUM / REQ-12 개선: CSRF 토큰 재발급 엔드포인트.
     * 세션이 유효할 때만 새 토큰을 발급하고 csrfToken 쿠키를 갱신한다.
     * (GET 은 CSRF 게이트 바깥이므로, 탈취 쿠키로 악용되지 않도록 반드시 세션 검증을 선행한다.)
     */
    private onGetCsrfToken = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
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

    private checkSession = async (req: IncomingMessage, res: ServerResponse) : Promise<boolean> => {
        let validSession = await this.validateSession(req);
        if(!validSession) {
            this.sendApiFailure(res, 401, {message: 'Invalid session'});
            return false;
        }
        return true;
    }

    private onGetAdminCert = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            let certStore = CertificationStore.instance;
            let certInfo = certStore.getAdminCert();
            this.sendApiSuccess(res, {certInfo: certInfo, revisionState: certStore.revisionState});
        });
    }

    private getNumberInPath = async (req: IncomingMessage, res: ServerResponse, pathStart: string, errorMessage: string ='Invalid port' ) : Promise<number | undefined> => {
        if(!await this.checkSession(req, res)) {
            return undefined;
        }
        let numStr = req.url?.substring(pathStart.length);
        let num = numStr == undefined ? undefined : parseInt(numStr);
        if(num == undefined || isNaN(num)) {
            this.sendApiFailure(res, 400, {message:errorMessage});
            return undefined;
        }
        return num;
    }



    private onActiveTunneling = async (req: IncomingMessage, res: ServerResponse) => {
        let port = await this.getNumberInPath(req, res,'/api/tunneling/active/');
        if(port == undefined) return;
        let json = await AdminServer.readJson(req);
        let timeout = json['timeout'];
        let active = json['active'];
        if(timeout == undefined || isNaN(timeout)) {
            timeout = 0;
        }
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            let success = false;
            if(this._tttServer) {
                success = active == true
                    ? await this._tttServer.activeExternalPortServer(port, timeout)
                    : await this._tttServer.inactiveExternalPortServer(port);
            }
            this.sendApiEnvelope(res, success ? 200 : 400, {success: success, message: success ? '' : 'Unable to change listener active state'});
        });
    }

    private onDeleteExternalServerCert = async (req: IncomingMessage, res: ServerResponse) => {
        let port = await this.getNumberInPath(req, res,'/api/externalCert/');
        if(port == undefined) return;
        const payload = await AdminServer.readJson(req);
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            if(!this.admitCertificateRevision(res, payload?.expectedCertificateRevision)) return;
            if(!await CertificationStore.instance.removeForExternalServer(port)) {
                this.sendApiFailure(res, 400, {message: 'Invalid certificate filename.'}); return;
            }
            this.sendApiSuccess(res, {revisionState: CertificationStore.instance.revisionState});
        });
    }

    private onUpdateExternalServerCert = async (req: IncomingMessage, res: ServerResponse) => {
        let port = await this.getNumberInPath(req, res,'/api/externalCert/');
        if(port == undefined) return;
        let json = await AdminServer.readJson(req);
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

    private onGetVersion = async (req: IncomingMessage, res: ServerResponse) => {
        let version = Environment.version;
        this.sendApiSuccess(res, {name: version.name, build: version.build});
    }


    private onGetExternalServerCert = async (req: IncomingMessage, res: ServerResponse) => {
        let port = await this.getNumberInPath(req, res,'/api/externalCert/');
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


    private onGetClientSysInfo = async (req: IncomingMessage, res: ServerResponse) => {
        let id = await this.getNumberInPath(req, res,'/api/clientSysInfo/', "Invalid client ID");
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



    private onLogin = async (req: IncomingMessage, res: ServerResponse) => {
        let json: any;
        try {
            json = await AdminServer.readJson(req);
        } catch (e: any) {
            // body 크기 초과/타임아웃은 상위 route()에서 처리하지만,
            // 방어적으로 여기서도 fail-fast.
            if(!res.headersSent) this.sendApiFailure(res, 400, {message: 'Invalid login body'});
            return;
        }
        const key = typeof json?.['key'] == 'string' ? json['key'] : '';
        const bootstrapToken = typeof json?.['bootstrapToken'] == 'string' ? json['bootstrapToken'] : undefined;
        // 단일 관리자 암호이므로 제출 값과 무관하게 네트워크 버킷으로 집계한다.
        if(this.isLoginBlocked(req)) {
            this.sendApiFailure(res, 429, {message: 'Too many login attempts'});
            return;
        }
        const sessionStore = SessionStore.instance;
        const result = await sessionStore.loginWithDetails(key, bootstrapToken);
        if(result.success) {
            this.resetLoginAttempts(req);
            const sessionKey = await sessionStore.newSession();
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
            res.end(JSON.stringify({success: true, partial: false, failedScopes: [], warnings: [], message: '', csrfToken}));
        } else {
            this.recordLoginFailure(req);
            // P5-T2 / REQ-07: 실패 응답 지연은 computeBackoffMs(실패횟수) 기반.
            await this.delayFailedLogin(req);
            if(result.bootstrapRequired) {
                this.sendApiFailure(res, result.weakPassword ? 400 : 403, {
                    bootstrapRequired: true,
                    invalidBootstrapToken: result.invalidBootstrapToken,
                    weakPassword: result.weakPassword
                });
                return;
            }
            this.sendApiFailure(res, 401);
        }
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

    private validateSession = async (req: IncomingMessage) : Promise<boolean> => {
        let sessionKey = AdminServer.getSessionKey(req);
        if(sessionKey) {
            let sessionStore = SessionStore.instance;
            return await sessionStore.isSessionValid(sessionKey);
        }
        return false;
    }


    private onGetServerOption = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
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


    private onGetSysInfo = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let status = await SysMonitor.instance.sysInfo();
        this.sendApiSuccess(res, {sysInfo: status});
    }

    private onGetSysUsage = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let status = await SysMonitor.instance.usage();
        this.sendApiSuccess(res, {sysUsage: status});
    }

    private onGetClientStatus = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let status = this._tttServer?.clientStatus();
        this.sendApiSuccess(res, {statuses: status ?? []});
    }


    private onGetTunnelingOption = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            let store = ServerOptionStore.instance;
            let tunnelingOptions = store.serverOption.tunnelingOptions;
            for(let tunnelingOption of tunnelingOptions) {
                tunnelingOption.keepAlive = tunnelingOption.keepAlive ?? TCPServer.DEFAULT_KEEP_ALIVE;
            }
            this.sendApiSuccess(res, {tunnelingOptions: tunnelingOptions, revisionState: store.revisionState});
        });
    }

    private onGetExternalServerStatuses = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let statuses = this._tttServer?.externalServerStatuses();
        this.sendApiSuccess(res, {serverTime: Date.now(), statuses: statuses ?? []});
    }


    private onGetServerOptionHash = async (req: IncomingMessage, res: ServerResponse) => {
        // P5-T1 / REQ-03: 세션 인증 필수.
        if(!await this.checkSession(req, res)) {
            return;
        }
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

    private normalizeAssetUrl(url: string): string | undefined {
        const pathOnly = url.split("?")[0];
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
