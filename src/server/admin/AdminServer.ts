import http, {IncomingMessage, ServerResponse} from "http";
import https from "https";
import ServerOptionStore from "../ServerOptionStore";
import SessionStore from "./SessionStore";
import CryptoJS from "crypto-js";

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
import {evaluateAdminSecurityPolicy, formatAdminSecurityPolicyErrors} from "../AdminSecurityPolicy";

const logger = LoggerFactory.getLogger('server', 'AdminServer');

type LoginAttemptState = {
    failedCount: number;
    windowStartedAt: number;
    blockedUntil: number;
}

const LOGIN_FAILURE_DELAY_MS = 100;
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_BLOCK_MS = 60_000;
const LOGIN_MAX_FAILURES = 5;

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
    private _tttServer : TTTServer | undefined;
    private _loginAttempts: Map<string, LoginAttemptState> = new Map<string, LoginAttemptState>();

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
            this._server = https.createServer(options, async (req, res) => {
                await this.route(req, res);
            });
        } else {
            this._server = http.createServer(async (req, res) => {
                await this.route(req, res);
            });
        }

        this._server.on('error', (err) => {
            logger.error('HTTP Admin server error', err);
        });
    }

    private async route(req: IncomingMessage, res: ServerResponse)  {
        let url = req.url;
        url = url == undefined ? "" : url;
        let method = req.method;
        try {
           if(this._tls) {
               res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
           }
           if (method == 'GET') {
                await this.routeGet(req, res, url);
                return;
           }
           else if(method == 'POST') {
                await this.routePost(req, res, url);
                return;
           }
           else if(method == 'DELETE') {
               await this.routeDelete(req, res, url);
               return;
           }

        } catch (e) {
            try {
                logger.warn('HTTP Admin server processing error', e);
                this.sendApiFailure(res, 500, {message: `Internal Server Error: ${e}`, url: url});
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
        if(contentType == 'application/octet-stream' && !realPath.endsWith("index.html")) {
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
        let certInfo = json['certInfo'];
        let certStore = CertificationStore.instance;
        if(!ObjectUtil.equalsType(EMPTY_CERT_INFO, certInfo) || !certStore.prepareAdminServerCert(certInfo)) {
            this.sendApiFailure(res, 400, {message: 'Invalid certificate'});
            return;
        }
        let success = await certStore.commitAdminServerCert(certInfo, {
            markLastKnownGood: false,
            pendingRestartScopes: ["admin-cert"]
        });
        if(!success) {
            this.sendApiFailure(res, 400, {message: 'Invalid certificate'});
            return;
        }
        this.sendApiSuccess(res, {
            partial: true,
            warnings: ["admin certificate stored; restart required to apply"],
            restartRequiredScopes: ["admin-cert"],
            revisionState: certStore.revisionState
        });
    }

    private static getSessionKey = (req: IncomingMessage) : Array<string> => {
        let result = new Array<string>();
        let cookie = req.headers['cookie'];
        if(cookie == undefined) {
            return result;
        }
        let cookieParts = cookie.split(';');
        for (let i = 0; i < cookieParts.length; i++) {
            let cookiePart = cookieParts[i];
            let cookiePartParts = cookiePart.split('=');
            if(cookiePartParts.length == 2) {
                let key = cookiePartParts[0].trim();
                let value = cookiePartParts[1].trim();
                if(key == 'sessionKey') {
                    result.push(value);
                }
            }
        }
        return result;
    }

    private onUpdateServerOption = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let serverOptionStore = ServerOptionStore.instance;
        let currentServerOption = serverOptionStore.serverOption;
        let requestedServerOption = await AdminServer.readJson(req);
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
            || JSON.stringify(currentServerOption.trustedClients ?? []) !== JSON.stringify(serverOption.trustedClients ?? []);
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
            serverOptionStore.recordRollback('server option runtime apply failed', runtimeResult.failedScopes);
            this.sendApiFailure(res, 400, {
                message: 'Unable to apply server option.',
                updated: false,
                updates,
                warnings: runtimeResult.warnings,
                failedScopes: runtimeResult.failedScopes,
                restartRequiredScopes: runtimeResult.restartRequiredScopes,
                revisionState: serverOptionStore.revisionState
            });
            return;
        }
        let commitResult = serverOptionStore.commitPreparedServerOption(serverOption, {
            markLastKnownGood: runtimeResult.restartRequiredScopes.length == 0,
            pendingRestartScopes: runtimeResult.restartRequiredScopes
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
        this.sendApiSuccess(res, {
            partial: runtimeResult.partial,
            updated: true,
            updates,
            warnings: runtimeResult.warnings,
            failedScopes: runtimeResult.failedScopes,
            restartRequiredScopes: runtimeResult.restartRequiredScopes,
            revisionState: commitResult.revisionState
        });
    }


    private onUpdateTunnelingOption = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let tunnelingOption = await AdminServer.readJson(req);
        let serverOptionStore = ServerOptionStore.instance;
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
        let runtimeResult = await this._tttServer?.applyTunnelingOption(tunnelingOption, previousOption) ?? {
            success: false,
            partial: false,
            warnings: [],
            failedScopes: [`external-listener:${tunnelingOption.forwardPort}`],
            restartRequiredScopes: []
        };
        if(!runtimeResult.success) {
            serverOptionStore.recordRollback('tunneling option runtime apply failed', runtimeResult.failedScopes);
            this.sendApiFailure(res, 400, {
                message: 'Unable to restart tunneling server.',
                forwardPort: tunnelingOption.forwardPort,
                failedScopes: runtimeResult.failedScopes,
                warnings: runtimeResult.warnings,
                revisionState: serverOptionStore.revisionState
            });
            return;
        }
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
        this.sendApiSuccess(res, {
            forwardPort: tunnelingOption.forwardPort,
            revisionState: commitResult.revisionState
        });
    }

    private onRemoveTunnelingOption = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let json = await AdminServer.readJson(req);
        let forwardPort = json['forwardPort'];
        let serverOptionStore = ServerOptionStore.instance;
        let previousOption = serverOptionStore.getTunnelingOption(forwardPort);
        if(!previousOption) {
            this.sendApiFailure(res, 404, {message: `External port(${forwardPort}) server already removed.`, forwardPort});
            return;
        }
        let warnings: string[] = [];
        let status = this._tttServer?.externalServerStatus(forwardPort);
        if(status?.online) {
            let stopped = await this._tttServer?.stopExternalPortServer(forwardPort);
            if(!stopped) {
                serverOptionStore.recordRollback('tunneling option remove failed', [`external-listener:${forwardPort}`]);
                this.sendApiFailure(res, 400, {
                    message: `Unable to stop external port(${forwardPort}) listener.`,
                    forwardPort,
                    failedScopes: [`external-listener:${forwardPort}`],
                    revisionState: serverOptionStore.revisionState
                });
                return;
            }
        } else {
            warnings.push(`listener ${forwardPort} was already offline`);
        }
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
        this.sendApiSuccess(res, {forwardPort, warnings, revisionState: commitResult.revisionState});
    }


    private onGetValidateSession = async (req: IncomingMessage, res: ServerResponse) => {
        let valid = await this.validateSession(req);
        if(!valid) {
            this.sendApiFailure(res, 401, {valid: false, message: 'Invalid session'});
            return;
        }
        this.sendApiSuccess(res, {valid: valid});
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
        let certStore = CertificationStore.instance;
        let certInfo = certStore.getAdminCert();
        this.sendApiSuccess(res, {certInfo: certInfo, revisionState: certStore.revisionState});
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
        // noinspection JSUnusedAssignment
        let success = false;
        if(!this._tttServer) {
            success = false;
        }
        else if(active == true) {
            success = await this._tttServer.activeExternalPortServer(port, timeout);
        } else {
            success = await this._tttServer.inactiveExternalPortServer(port);
        }
        this.sendApiEnvelope(res, success ? 200 : 400, {success: success, message: success ? '' : 'Unable to change listener active state'});
    }

    private onDeleteExternalServerCert = async (req: IncomingMessage, res: ServerResponse) => {
        let port = await this.getNumberInPath(req, res,'/api/externalCert/');
        if(port == undefined) return;
        await CertificationStore.instance.removeForExternalServer(port);
        this.sendApiSuccess(res, {revisionState: CertificationStore.instance.revisionState});
    }

    private onUpdateExternalServerCert = async (req: IncomingMessage, res: ServerResponse) => {
        let port = await this.getNumberInPath(req, res,'/api/externalCert/');
        if(port == undefined) return;
        let json = await AdminServer.readJson(req);
        let certInfo = json['certInfo'];
        let certStore = CertificationStore.instance;
        let previousCert = certStore.getExternalCert(port);
        if(!ObjectUtil.equalsType(EMPTY_CERT_INFO, certInfo) || !certStore.prepareExternalServerCert(certInfo)) {
            this.sendApiFailure(res, 400, {message: 'Invalid certificate'});
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
            certStore.recordRollback('external certificate runtime apply failed', runtimeResult.failedScopes);
            this.sendApiFailure(res, 400, {
                message: 'Invalid certificate',
                failedScopes: runtimeResult.failedScopes,
                warnings: runtimeResult.warnings,
                revisionState: certStore.revisionState
            });
            return;
        }
        let success = await certStore.commitExternalServerCert(port, certInfo, {
            markLastKnownGood: runtimeResult.restartRequiredScopes.length == 0,
            pendingRestartScopes: runtimeResult.restartRequiredScopes
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
        this.sendApiSuccess(res, {
            partial: runtimeResult.partial,
            warnings: runtimeResult.warnings,
            restartRequiredScopes: runtimeResult.restartRequiredScopes,
            revisionState: certStore.revisionState
        });
    }

    private onGetVersion = async (req: IncomingMessage, res: ServerResponse) => {
        let version = Environment.version;
        this.sendApiSuccess(res, {name: version.name, build: version.build});
    }


    private onGetExternalServerCert = async (req: IncomingMessage, res: ServerResponse) => {
        let port = await this.getNumberInPath(req, res,'/api/externalCert/');
        if(port == undefined) return;
        let certStore = CertificationStore.instance;
        let certInfo = certStore.getExternalCert(port);
        if(certInfo == undefined) {
            this.sendApiFailure(res, 400, {message: 'Invalid port'});
            return;
        }
        this.sendApiSuccess(res, {certInfo: certInfo, revisionState: certStore.revisionState});
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



    private onGetEmptyKey = async (req: IncomingMessage, res: ServerResponse) => {
        this.sendApiFailure(res, 404, {message: 'Not Found'});
    }

    private onLogin = async (req: IncomingMessage, res: ServerResponse) => {
        if(this.isLoginBlocked(req)) {
            this.sendApiFailure(res, 429, {message: 'Too many login attempts'});
            return;
        }
        let json = await AdminServer.readJson(req);
        let key = typeof json['key'] == 'string' ? json['key'] : '';
        let bootstrapToken = typeof json['bootstrapToken'] == 'string' ? json['bootstrapToken'] : undefined;
        let sessionStore =  SessionStore.instance;
        let result = await sessionStore.loginWithDetails(key, bootstrapToken);
        if(result.success) {
            this.resetLoginAttempts(req);
            let sessionKey = await sessionStore.newSession();
            res.writeHead(200, {'Content-Type': 'application/json',
                'Set-Cookie': `sessionKey=${sessionKey}; Path=/api/; Max-Age=${12 * 60 * 60}; HttpOnly; SameSite=Strict;${this._tls ? ' Secure;' : ''}`});
            res.end(JSON.stringify({success: true, partial: false, failedScopes: [], warnings: [], message: ''}));
        } else {
            this.recordLoginFailure(req);
            await this.delayFailedLogin();
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


    private static async readJson(req: IncomingMessage) : Promise<any> {
        return new Promise<any>((resolve, reject) => {
            let data = '';
            req.on('data', (chunk) => {
                data += chunk;
            });
            req.on('end', () => {
                try {
                    let json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    reject(e);
                }
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
        let store = ServerOptionStore.instance;
        let pureServerOption : any = store.serverOption;
        delete pureServerOption['tunnelingOptions'];
        this.sendApiSuccess(res, {serverOption:  pureServerOption, revisionState: store.revisionState});
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
        let store = ServerOptionStore.instance;
        let tunnelingOptions = store.serverOption.tunnelingOptions;
        for(let tunnelingOption of tunnelingOptions) {
            tunnelingOption.keepAlive = tunnelingOption.keepAlive ?? TCPServer.DEFAULT_KEEP_ALIVE;
        }
        this.sendApiSuccess(res, {tunnelingOptions: tunnelingOptions, revisionState: store.revisionState});
    }

    private onGetExternalServerStatuses = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let statuses = this._tttServer?.externalServerStatuses();
        this.sendApiSuccess(res, {serverTime: Date.now(), statuses: statuses ?? []});
    }


    private onGetServerOptionHash = async (req: IncomingMessage, res: ServerResponse) => {
        let origin = req.headers['origin'];
        let serverOption = ServerOptionStore.instance.serverOption;
        let adminCert = CertificationStore.instance.getAdminCert();
        let pureServerOption : any = serverOption;
        delete pureServerOption['tunnelingOptions'];
        let hash = CryptoJS.SHA512(JSON.stringify(pureServerOption) + JSON.stringify(adminCert)).toString();
        res.writeHead(200, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin == undefined ? '*' : origin});
        res.end(JSON.stringify({success: true, partial: false, failedScopes: [], warnings: [], message: '', hash: hash}));
    }


    public async listen(port : number, host?: string)  : Promise<number> {
        return new Promise((resolve, reject) => {
            this._server.on('listening', () => {
                let address = this._server.address();
                let actualPort = typeof address == 'object' && address ? address.port : port;
                let actualHost = typeof address == 'object' && address ? address.address : (host ?? "");
                logger.info(`Admin server listening on ${actualHost}:${actualPort}`);
                this._server.removeAllListeners('listening');
                this._port = actualPort;
                resolve(actualPort);
            });
            this._server.on('error', (err) => {
                logger.error(`Admin server error on port ${port}`, err);
                this._server.close();
                this._server.removeAllListeners('error');
                this._port = -1;
                reject(err);
            });
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
        return new Promise((resolve) => {
            this._server.removeAllListeners();
            this._server.closeAllConnections();
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

    private getClientAddress(req: IncomingMessage): string {
        return req.socket.remoteAddress ?? "unknown";
    }

    private isLoginBlocked(req: IncomingMessage): boolean {
        const state = this._loginAttempts.get(this.getClientAddress(req));
        return state != undefined && state.blockedUntil > this.now();
    }

    private recordLoginFailure(req: IncomingMessage): void {
        const now = this.now();
        const clientAddress = this.getClientAddress(req);
        let state = this._loginAttempts.get(clientAddress);
        if(!state || state.windowStartedAt + LOGIN_WINDOW_MS <= now) {
            state = {failedCount: 0, windowStartedAt: now, blockedUntil: 0};
        }
        state.failedCount += 1;
        if(state.failedCount >= LOGIN_MAX_FAILURES) {
            state.blockedUntil = now + LOGIN_BLOCK_MS;
        }
        this._loginAttempts.set(clientAddress, state);
    }

    private resetLoginAttempts(req: IncomingMessage): void {
        this._loginAttempts.delete(this.getClientAddress(req));
    }

    private async delayFailedLogin(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, LOGIN_FAILURE_DELAY_MS));
    }



}

export default AdminServer;
