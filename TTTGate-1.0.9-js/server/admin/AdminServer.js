"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const ServerOptionStore_1 = __importDefault(require("../ServerOptionStore"));
const SessionStore_1 = __importDefault(require("./SessionStore"));
const crypto_js_1 = __importDefault(require("crypto-js"));
const CertificationStore_1 = require("../CertificationStore");
const ObjectUtil_1 = __importDefault(require("../../util/ObjectUtil"));
const UsablePortChecker_1 = __importDefault(require("../../util/UsablePortChecker"));
const Environment_1 = __importDefault(require("../../Environment"));
const path_1 = __importDefault(require("path"));
const File_1 = __importDefault(require("../../util/File"));
const Files_1 = __importDefault(require("../../util/Files"));
const SysMonitor_1 = require("../../commons/SysMonitor");
const LoggerFactory_1 = __importDefault(require("../../util/logger/LoggerFactory"));
const TCPServer_1 = require("../../util/TCPServer");
const logger = LoggerFactory_1.default.getLogger('server', 'AdminServer');
const EMPTY_PEM_DATA = {
    name: '',
    value: ''
};
const EMPTY_CERT_INFO = {
    cert: EMPTY_PEM_DATA,
    key: EMPTY_PEM_DATA,
    ca: EMPTY_PEM_DATA
};
class AdminServer {
    _server;
    _port = -1;
    _tttServer;
    constructor(tttServer, tls, certInfo) {
        this._tttServer = tttServer;
        if (tls) {
            if (!certInfo)
                throw new Error('AdminServer certInfo is undefined');
            let options = {
                key: certInfo.key.value,
                cert: certInfo.cert.value
            };
            if (certInfo.ca.value.length > 0) {
                options.ca = certInfo.ca.value;
            }
            this._server = https_1.default.createServer(options, async (req, res) => {
                await this.route(req, res);
            });
        }
        else {
            this._server = http_1.default.createServer(async (req, res) => {
                await this.route(req, res);
            });
        }
        this._server.on('error', (err) => {
            logger.error('HTTP Admin server error', err);
        });
    }
    async route(req, res) {
        let url = req.url;
        url = url == undefined ? "" : url;
        let method = req.method;
        try {
            if (method == 'GET') {
                await this.routeGet(req, res, url);
                return;
            }
            else if (method == 'POST') {
                await this.routePost(req, res, url);
                return;
            }
            else if (method == 'DELETE') {
                await this.routeDelete(req, res, url);
                return;
            }
        }
        catch (e) {
            try {
                logger.warn('HTTP Admin server processing error', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end({ success: false, message: `Internal Server Error: ${e}`, url: url });
                return;
            }
            catch (e) {
                logger.error('HTTP Admin server processing error', e);
                return;
            }
        }
        res.writeHead(404);
        res.end(`Not Found ${url}`);
    }
    routeDelete = async (req, res, url) => {
        if (url == "/api/tunnelingOption") {
            await this.onRemoveTunnelingOption(req, res);
            return;
        }
        else if (url.startsWith("/api/externalCert/")) {
            await this.onDeleteExternalServerCert(req, res);
            return;
        }
    };
    routePost = async (req, res, url) => {
        if (url == "/api/login") {
            await this.onLogin(req, res);
            return;
        }
        else if (url == "/api/adminCert") {
            await this.onUpdateAdminCert(req, res);
        }
        else if (url == "/api/serverOption") {
            await this.onUpdateServerOption(req, res);
        }
        else if (url == "/api/tunnelingOption") {
            await this.onUpdateTunnelingOption(req, res);
        }
        else if (url.startsWith("/api/externalCert/")) {
            await this.onUpdateExternalServerCert(req, res);
            return;
        }
        else if (url.startsWith("/api/tunneling/active/")) {
            await this.onActiveTunneling(req, res);
            return;
        }
    };
    routeGet = async (req, res, url) => {
        // 캐시 하지 않기.
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        if (url == "/api/serverOption") {
            await this.onGetServerOption(req, res);
            return;
        }
        else if (url == '/api/sysInfo') {
            await this.onGetSysInfo(req, res);
        }
        else if (url == '/api/sysInfo') {
            await this.onGetSysInfo(req, res);
        }
        else if (url == '/api/sysUsage') {
            await this.onGetSysUsage(req, res);
        }
        else if (url == '/api/clientStatus') {
            await this.onGetClientStatus(req, res);
        }
        else if (url == "/api/tunnelingOption") {
            await this.onGetTunnelingOption(req, res);
            return;
        }
        else if (url == "/api/externalServerStatuses") {
            await this.onGetExternalServerStatuses(req, res);
            return;
        }
        else if (url == "/api/serverOptionHash") {
            await this.onGetServerOptionHash(req, res);
            return;
        }
        else if (url == "/api/emptyKey") {
            await this.onGetEmptyKey(req, res);
            return;
        }
        else if (url == "/api/validateSession") {
            await this.onGetValidateSession(req, res);
            return;
        }
        else if (url == "/api/adminCert") {
            await this.onGetAdminCert(req, res);
            return;
        }
        else if (url.startsWith("/api/externalCert/")) {
            await this.onGetExternalServerCert(req, res);
            return;
        }
        else if (url.startsWith("/api/clientSysInfo/")) {
            await this.onGetClientSysInfo(req, res);
            return;
        }
        else if (url == '/api/version') {
            await this.onGetVersion(req, res);
        }
        else {
            await this.onGetWebResource(req, res, url);
            return;
        }
    };
    onGetWebResource = async (req, res, url) => {
        let realPath = Environment_1.default.path.webDir;
        url.split('/').forEach((path) => {
            if (path.length > 0) {
                realPath = path_1.default.join(realPath, path);
            }
        });
        if (url.length == 0 || url == '/') {
            realPath = path_1.default.join(realPath, 'index.html');
        }
        let ext = path_1.default.extname(realPath);
        let contentType = this.contentTypeFromExt(ext);
        let file = new File_1.default(realPath);
        if (!file.isFile()) {
            res.writeHead(404);
            res.end(`Not Found ${url}`);
            return;
        }
        let body;
        if (contentType.startsWith('text')) {
            body = await Files_1.default.toString(file);
        }
        else {
            body = await Files_1.default.read(file);
        }
        if (body == undefined) {
            res.writeHead(404);
            res.end(`Not Found ${url}`);
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(body);
    };
    onUpdateAdminCert = async (req, res) => {
        if (!await this.checkSession(req, res)) {
            return;
        }
        let json = await AdminServer.readJson(req);
        let certInfo = json['certInfo'];
        if (!ObjectUtil_1.default.equalsType(EMPTY_CERT_INFO, certInfo)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Invalid certificate' }));
            return;
        }
        let certStore = CertificationStore_1.CertificationStore.instance;
        let success = await certStore.updateAdminServerCert(certInfo);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: success, message: success ? '' : 'Invalid certificate' }));
    };
    static getSessionKey = (req) => {
        let result = new Array();
        let cookie = req.headers['cookie'];
        if (cookie == undefined) {
            return result;
        }
        let cookieParts = cookie.split(';');
        for (let i = 0; i < cookieParts.length; i++) {
            let cookiePart = cookieParts[i];
            let cookiePartParts = cookiePart.split('=');
            if (cookiePartParts.length == 2) {
                let key = cookiePartParts[0].trim();
                let value = cookiePartParts[1].trim();
                if (key == 'sessionKey') {
                    result.push(value);
                }
            }
        }
        return result;
    };
    onUpdateServerOption = async (req, res) => {
        if (!await this.checkSession(req, res)) {
            return;
        }
        let serverOption = await AdminServer.readJson(req);
        let serverOptionStore = ServerOptionStore_1.default.instance;
        let updates = ObjectUtil_1.default.findUpdates(serverOptionStore.serverOption, serverOption);
        let savedServerOption = serverOptionStore.serverOption;
        if (ObjectUtil_1.default.equalsDeep(savedServerOption, serverOption)) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({ success: true, message: 'equals', updated: false, updates: updates }));
            return;
        }
        let updatePorts = new Array();
        if (updates['adminPort'] != undefined) {
            if (updates['adminPort'] == serverOption.port) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                    .end(JSON.stringify({ success: false, message: 'Input error: Admin server port and Tunnel server port number cannot be the same.', updated: false, updates: updates }));
                return;
            }
            updatePorts.push(serverOption.adminPort);
        }
        if (updates['port'] != undefined) {
            if (updates['port'] == serverOption.adminPort || (updates['adminPort'] != undefined && updates['adminPort'] == updates['port'])) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                    .end(JSON.stringify({ success: false, message: 'Input error: Admin server port and Tunnel server port number cannot be the same.', updated: false, updates: updates }));
                return;
            }
            updatePorts.push(serverOption.port);
        }
        if (updates['keepAlive']) {
            let keepAlive = updates['keepAlive'];
            keepAlive = Math.max(0, keepAlive);
            if (isNaN(keepAlive)) {
                keepAlive = 0;
            }
            serverOption.keepAlive = keepAlive;
        }
        let usablePorts = await UsablePortChecker_1.default.checkPorts(updatePorts);
        if (usablePorts.length != updatePorts.length) {
            let notUsablePorts = updatePorts.filter((port) => !usablePorts.includes(port));
            res.writeHead(400, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({ success: false, message: `Port number ${notUsablePorts} is already in use`, updated: false, updates: updates }));
            return;
        }
        if (!serverOptionStore.updateServerOption(serverOption)) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({ success: false, message: 'Invalid server option', updated: false, updates: updates }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ success: true, message: '', updated: true }));
    };
    onUpdateTunnelingOption = async (req, res) => {
        if (!await this.checkSession(req, res)) {
            return;
        }
        let tunnelingOption = await AdminServer.readJson(req);
        let serverOptionStore = ServerOptionStore_1.default.instance;
        let isSuccess = serverOptionStore.updateTunnelingOption(tunnelingOption);
        if (!isSuccess) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({ success: false, message: 'Tunneling options update failed.', forwardPort: tunnelingOption.forwardPort }));
            return;
        }
        await this._tttServer?.stopExternalPortServer(tunnelingOption.forwardPort);
        if (!await UsablePortChecker_1.default.check(tunnelingOption.forwardPort)) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({ success: false, message: `${tunnelingOption.forwardPort} is an unusable port number.`, forwardPort: tunnelingOption.forwardPort }));
            return;
        }
        try {
            isSuccess = await this._tttServer?.updateAndRestartExternalPortServer(tunnelingOption.forwardPort);
        }
        catch (e) {
            isSuccess = false;
        }
        if (!isSuccess) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({ success: false, message: 'Unable to restart tunneling server.', forwardPort: tunnelingOption.forwardPort }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ success: true, message: '', forwardPort: tunnelingOption.forwardPort }));
    };
    onRemoveTunnelingOption = async (req, res) => {
        if (!await this.checkSession(req, res)) {
            return;
        }
        let json = await AdminServer.readJson(req);
        let forwardPort = json['forwardPort'];
        let serverOptionStore = ServerOptionStore_1.default.instance;
        let isSuccess = serverOptionStore.removeTunnelingOption(forwardPort);
        await this._tttServer?.stopExternalPortServer(forwardPort);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: isSuccess, message: isSuccess ? '' : `External port(${forwardPort}) server already removed.`, forwardPort: forwardPort }));
    };
    onGetValidateSession = async (req, res) => {
        let valid = await this.validateSession(req);
        if (!valid) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ valid: false }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ valid: valid }));
    };
    checkSession = async (req, res) => {
        let validSession = await this.validateSession(req);
        if (!validSession) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Invalid session' }));
            return false;
        }
        return true;
    };
    onGetAdminCert = async (req, res) => {
        if (!await this.checkSession(req, res)) {
            return;
        }
        let certStore = CertificationStore_1.CertificationStore.instance;
        let certInfo = certStore.getAdminCert();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, certInfo: certInfo, message: '' }));
    };
    getNumberInPath = async (req, res, pathStart, errorMessage = 'Invalid port') => {
        if (!await this.checkSession(req, res)) {
            return undefined;
        }
        let numStr = req.url?.substring(pathStart.length);
        let num = numStr == undefined ? undefined : parseInt(numStr);
        if (num == undefined || isNaN(num)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: errorMessage }));
            return undefined;
        }
        return num;
    };
    onActiveTunneling = async (req, res) => {
        let port = await this.getNumberInPath(req, res, '/api/tunneling/active/');
        if (port == undefined)
            return;
        let json = await AdminServer.readJson(req);
        let timeout = json['timeout'];
        let active = json['active'];
        if (timeout == undefined || isNaN(timeout)) {
            timeout = 0;
        }
        // noinspection JSUnusedAssignment
        let success = false;
        if (!this._tttServer) {
            success = false;
        }
        else if (active == true) {
            success = await this._tttServer.activeExternalPortServer(port, timeout);
        }
        else {
            success = await this._tttServer.inactiveExternalPortServer(port);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: success, message: '' }));
    };
    onDeleteExternalServerCert = async (req, res) => {
        let port = await this.getNumberInPath(req, res, '/api/externalCert/');
        if (port == undefined)
            return;
        await CertificationStore_1.CertificationStore.instance.removeForExternalServer(port);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '' }));
    };
    onUpdateExternalServerCert = async (req, res) => {
        let port = await this.getNumberInPath(req, res, '/api/externalCert/');
        if (port == undefined)
            return;
        let json = await AdminServer.readJson(req);
        let certInfo = json['certInfo'];
        let success = await CertificationStore_1.CertificationStore.instance.updateExternalServerCert(port, certInfo);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: success, message: success ? '' : 'Invalid certificate' }));
    };
    onGetVersion = async (req, res) => {
        let version = Environment_1.default.version;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, name: version.name, build: version.build }));
    };
    onGetExternalServerCert = async (req, res) => {
        let port = await this.getNumberInPath(req, res, '/api/externalCert/');
        if (port == undefined)
            return;
        let certStore = CertificationStore_1.CertificationStore.instance;
        let certInfo = certStore.getExternalCert(port);
        if (certInfo == undefined) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Invalid port' }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, certInfo: certInfo, message: '' }));
    };
    onGetClientSysInfo = async (req, res) => {
        let id = await this.getNumberInPath(req, res, '/api/clientSysInfo/', "Invalid client ID");
        if (id == undefined)
            return;
        let sysInfo = this._tttServer?.getClientSysInfo(id);
        if (sysInfo == undefined) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Invalid client ID' }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...sysInfo, ...{ success: true, message: '' } }));
    };
    // noinspection JSUnusedLocalSymbols
    getQueryParam(req) {
        let url = req.url;
        let param = new Map();
        if (url == undefined) {
            return param;
        }
        let paramIndex = url.indexOf('?');
        if (paramIndex == -1) {
            return param;
        }
        let paramStr = url.substring(paramIndex + 1);
        let paramParts = paramStr.split('&');
        for (let i = 0; i < paramParts.length; i++) {
            let paramPart = paramParts[i];
            let paramPartParts = paramPart.split('=');
            if (paramPartParts.length == 2) {
                let key = paramPartParts[0].trim();
                let value = paramPartParts[1].trim();
                param.set(key, value);
            }
        }
        return param;
    }
    onGetEmptyKey = async (req, res) => {
        let isEmpty = await SessionStore_1.default.instance.isEmptyKey().then();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ emptyKey: isEmpty }));
    };
    onLogin = async (req, res) => {
        let json = await AdminServer.readJson(req);
        let key = json['key'];
        let sessionStore = SessionStore_1.default.instance;
        let success = await sessionStore.login(key);
        if (success) {
            let sessionKey = await sessionStore.newSession();
            res.writeHead(200, { 'Content-Type': 'application/json',
                'Set-Cookie': `sessionKey=${sessionKey};path=/api/; HttpOnly; SameSite=Strict;${ServerOptionStore_1.default.instance.serverOption.adminTls === true ? ' secure;' : ''}` });
            res.end(JSON.stringify({ success: true }));
        }
        else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false }));
        }
    };
    static async readJson(req) {
        return new Promise((resolve, reject) => {
            let data = '';
            req.on('data', (chunk) => {
                data += chunk;
            });
            req.on('end', () => {
                try {
                    let json = JSON.parse(data);
                    resolve(json);
                }
                catch (e) {
                    reject(e);
                }
            });
        });
    }
    validateSession = async (req) => {
        let sessionKey = AdminServer.getSessionKey(req);
        if (sessionKey) {
            let sessionStore = SessionStore_1.default.instance;
            return await sessionStore.isSessionValid(sessionKey);
        }
        return false;
    };
    onGetServerOption = async (req, res) => {
        if (!await this.checkSession(req, res)) {
            return;
        }
        let store = ServerOptionStore_1.default.instance;
        let pureServerOption = store.serverOption;
        delete pureServerOption['tunnelingOptions'];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, serverOption: pureServerOption, message: '' }));
    };
    onGetSysInfo = async (req, res) => {
        if (!await this.checkSession(req, res)) {
            return;
        }
        let status = await SysMonitor_1.SysMonitor.instance.sysInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        let value = { success: true, message: '' } && status;
        res.end(JSON.stringify(value));
    };
    onGetSysUsage = async (req, res) => {
        if (!await this.checkSession(req, res)) {
            return;
        }
        let status = await SysMonitor_1.SysMonitor.instance.usage();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        let value = { success: true, message: '' } && status;
        res.end(JSON.stringify(value));
    };
    onGetClientStatus = async (req, res) => {
        if (!await this.checkSession(req, res)) {
            return;
        }
        let status = this._tttServer?.clientStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        let value = { success: true, message: '' } && status;
        res.end(JSON.stringify(value));
    };
    onGetTunnelingOption = async (req, res) => {
        if (!await this.checkSession(req, res)) {
            return;
        }
        let store = ServerOptionStore_1.default.instance;
        let tunnelingOptions = store.serverOption.tunnelingOptions;
        for (let tunnelingOption of tunnelingOptions) {
            tunnelingOption.keepAlive = tunnelingOption.keepAlive ?? TCPServer_1.TCPServer.DEFAULT_KEEP_ALIVE;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, tunnelingOptions: tunnelingOptions, message: '' }));
    };
    onGetExternalServerStatuses = async (req, res) => {
        if (!await this.checkSession(req, res)) {
            return;
        }
        let statuses = this._tttServer?.externalServerStatuses();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, serverTime: Date.now(), statuses: statuses, message: '' }));
    };
    onGetServerOptionHash = async (req, res) => {
        let origin = req.headers['origin'];
        let serverOption = ServerOptionStore_1.default.instance.serverOption;
        let adminCert = CertificationStore_1.CertificationStore.instance.getAdminCert();
        let pureServerOption = serverOption;
        delete pureServerOption['tunnelingOptions'];
        let hash = crypto_js_1.default.SHA512(JSON.stringify(pureServerOption) + JSON.stringify(adminCert)).toString();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin == undefined ? '*' : origin });
        res.end(JSON.stringify({ success: true, hash: hash, message: '' }));
    };
    async listen(port) {
        return new Promise((resolve, reject) => {
            this._server.on('listening', () => {
                logger.info(`Admin server listening on port ${port}`);
                this._server.removeAllListeners('listening');
                this._port = port;
                resolve(port);
            });
            this._server.on('error', (err) => {
                logger.error(`Admin server error on port ${port}`, err);
                this._server.close();
                this._server.removeAllListeners('error');
                this._port = -1;
                reject(err);
            });
            this._server.listen(port);
        });
    }
    async close() {
        logger.info(`AdminServer.close()`);
        if (this._port < -1) {
            logger.info(`Admin server is already closed on port ${this._port}`);
            return false;
        }
        return new Promise((resolve) => {
            this._server.removeAllListeners();
            this._server.closeAllConnections();
            this._server.close((err) => {
                logger.info(`Admin server closed on port ${this._port}`);
                setImmediate(() => {
                    resolve(err == undefined);
                });
            });
        });
    }
    contentTypeFromExt = (ext) => {
        ext = ext.toLowerCase();
        let contentType = 'application/octet-stream';
        if (ext == '.html')
            contentType = 'text/html; charset=utf-8';
        else if (ext == '.js')
            contentType = 'text/javascript; charset=utf-8';
        else if (ext == '.css')
            contentType = 'text/css; charset=utf-8';
        else if (ext == '.png')
            contentType = 'image/png';
        else if (ext == '.jpg' || ext == '.jpeg')
            contentType = 'image/jpeg';
        else if (ext == '.gif')
            contentType = 'image/gif';
        else if (ext == '.svg')
            contentType = 'image/svg+xml; charset=utf-8';
        else if (ext == '.ico')
            contentType = 'image/x-icon';
        else if (ext == '.json')
            contentType = 'application/json; charset=utf-8';
        else if (ext == '.ttf')
            contentType = 'font/ttf';
        return contentType;
    };
}
exports.default = AdminServer;
