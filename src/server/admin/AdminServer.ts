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
import {CaptchaInfo, CaptchaStore} from "./CaptchaStore";

const logger = LoggerFactory.getLogger('server', 'AdminServer');



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
    private _port : number = -1;
    private _tttServer : TTTServer | undefined;

    constructor(tttServer: TTTServer, tls : boolean, certInfo? : CertInfo) {
        this._tttServer = tttServer;
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
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end({success: false, message: `Internal Server Error: ${e}`, url: url});
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
        }
        else if (url == "/api/login/captchaaaainfo") {
            await this.onLoadCaptchaInfo(req, res);
            return;
        }
        else if(url == '/api/sysInfo') {
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
        } else if (url == "/api/emptyKey") {
            await this.onGetEmptyKey(req, res);
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
            await this.onGetWebResource(req, res, url);
            return;
        }

    }

    private onGetWebResource = async (req: IncomingMessage, res: ServerResponse, url: string) => {
        let realPath = Environment.path.webDir;
        url.split('/').forEach((path) => {
            if(path.length > 0) {
                realPath = Path.join(realPath, path);
            }
        });
        if(url.length == 0 || url == '/'){
            realPath = Path.join(realPath, 'index.html');
        }
        let ext = Path.extname(realPath);
        let contentType = this.contentTypeFromExt(ext);
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
        if(!ObjectUtil.equalsType(EMPTY_CERT_INFO, certInfo)) {
            res.writeHead(400, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: false, message: 'Invalid certificate'}));
            return;
        }
        let certStore = CertificationStore.instance;
        let success = await certStore.updateAdminServerCert(certInfo);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: success, message: success ? '' : 'Invalid certificate'}));

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
        let serverOption = await AdminServer.readJson(req);
        let serverOptionStore = ServerOptionStore.instance;
        let updates = ObjectUtil.findUpdates(serverOptionStore.serverOption, serverOption);
        let savedServerOption = serverOptionStore.serverOption;
        if(ObjectUtil.equalsDeep(savedServerOption, serverOption)) {
            res.writeHead(200, {'Content-Type': 'application/json'})
                .end(JSON.stringify({success: true, message: 'equals', updated: false, updates: updates}));
            return;
        }
        let updatePorts = new Array<number>();
        if(updates['adminPort'] != undefined) {
            if(updates['adminPort'] == serverOption.port) {
                res.writeHead(400, {'Content-Type': 'application/json'})
                    .end(JSON.stringify({success: false, message: 'Input error: Admin server port and Tunnel server port number cannot be the same.', updated: false, updates: updates}));
                return;
            }
            updatePorts.push(serverOption.adminPort!);
        }
        if(updates['port'] != undefined) {
            if(updates['port'] == serverOption.adminPort || (updates['adminPort'] != undefined && updates['adminPort'] == updates['port'])) {
                res.writeHead(400, {'Content-Type': 'application/json'})
                    .end(JSON.stringify({success: false, message: 'Input error: Admin server port and Tunnel server port number cannot be the same.', updated: false, updates: updates}));
                return;
            }
            updatePorts.push(serverOption.port!);
        }
        let usablePorts = await UsablePortChecker.checkPorts(updatePorts);
        if(usablePorts.length != updatePorts.length) {
            let notUsablePorts = updatePorts.filter((port) => !usablePorts.includes(port));
            res.writeHead(400, {'Content-Type': 'application/json'})
                .end(JSON.stringify({success: false, message: `Port number ${notUsablePorts} is already in use`, updated: false, updates: updates}));
            return;
        }
        if(!serverOptionStore.updateServerOption(serverOption)) {
            res.writeHead(400, {'Content-Type': 'application/json'})
                .end(JSON.stringify({success: false, message: 'Invalid server option', updated: false, updates: updates}));
            return;
        }

        res.writeHead(200, {'Content-Type': 'application/json'})
            .end(JSON.stringify({success: true, message: '', updated: true}));

    }


    private onUpdateTunnelingOption = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let tunnelingOption = await AdminServer.readJson(req);
        let serverOptionStore = ServerOptionStore.instance;
        let isSuccess = serverOptionStore.updateTunnelingOption(tunnelingOption);
        if(!isSuccess) {
            res.writeHead(400, {'Content-Type': 'application/json'})
                .end(JSON.stringify({success: false, message: 'Tunneling options update failed.', forwardPort: tunnelingOption.forwardPort}));
            return;
        }

        await this._tttServer?.stopExternalPortServer(tunnelingOption.forwardPort);

        if(!await UsablePortChecker.check(tunnelingOption.forwardPort)) {
            res.writeHead(400, {'Content-Type': 'application/json'})
                .end(JSON.stringify({success: false, message: `${tunnelingOption.forwardPort} is an unusable port number.`, forwardPort: tunnelingOption.forwardPort}));
            return;
        }


        try {
            isSuccess = await this._tttServer?.updateAndRestartExternalPortServer(tunnelingOption.forwardPort)!;
        } catch (e) {
            isSuccess = false;
        }

        if(!isSuccess) {
            res.writeHead(400, {'Content-Type': 'application/json'})
                .end(JSON.stringify({success: false, message: 'Unable to restart tunneling server.', forwardPort: tunnelingOption.forwardPort}));
            return;
        }

        res.writeHead(200, {'Content-Type': 'application/json'})
            .end(JSON.stringify({success: true, message: '', forwardPort: tunnelingOption.forwardPort}));

    }

    private onRemoveTunnelingOption = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let json = await AdminServer.readJson(req);
        let forwardPort = json['forwardPort'];
        let serverOptionStore = ServerOptionStore.instance;
        let isSuccess = serverOptionStore.removeTunnelingOption(forwardPort);
        await this._tttServer?.stopExternalPortServer(forwardPort);

        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: isSuccess, message: isSuccess ? '' : `External port(${forwardPort}) server already removed.`, forwardPort: forwardPort}));


    }


    private onGetValidateSession = async (req: IncomingMessage, res: ServerResponse) => {
        let valid = await this.validateSession(req);
        if(!valid) {
            res.writeHead(401, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({valid: false}));
            return;
        }
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({valid: valid}));
    }

    private checkSession = async (req: IncomingMessage, res: ServerResponse) : Promise<boolean> => {
        let validSession = await this.validateSession(req);
        if(!validSession) {
            res.writeHead(401,{'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: false, message: 'Invalid session'}));
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
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true, certInfo: certInfo, message: ''}));
    }

    private getNumberInPath = async (req: IncomingMessage, res: ServerResponse, pathStart: string, errorMessage: string ='Invalid port' ) : Promise<number | undefined> => {
        if(!await this.checkSession(req, res)) {
            return undefined;
        }
        let numStr = req.url?.substring(pathStart.length);
        let num = numStr == undefined ? undefined : parseInt(numStr);
        if(num == undefined || isNaN(num)) {
            res.writeHead(400, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: false, message:errorMessage}));
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
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: success, message: ''}));
    }

    private onDeleteExternalServerCert = async (req: IncomingMessage, res: ServerResponse) => {
        let port = await this.getNumberInPath(req, res,'/api/externalCert/');
        if(port == undefined) return;
        await CertificationStore.instance.removeForExternalServer(port);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true, message: ''}));
    }

    private onUpdateExternalServerCert = async (req: IncomingMessage, res: ServerResponse) => {
        let port = await this.getNumberInPath(req, res,'/api/externalCert/');
        if(port == undefined) return;
        let json = await AdminServer.readJson(req);
        let certInfo = json['certInfo'];
        let success = await CertificationStore.instance.updateExternalServerCert(port, certInfo);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: success, message: success ? '' : 'Invalid certificate'}));
    }

    private onGetVersion = async (req: IncomingMessage, res: ServerResponse) => {
        let version = Environment.version;
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true, name: version.name, build: version.build}));
    }


    private onGetExternalServerCert = async (req: IncomingMessage, res: ServerResponse) => {
        let port = await this.getNumberInPath(req, res,'/api/externalCert/');
        if(port == undefined) return;
        let certStore = CertificationStore.instance;
        let certInfo = certStore.getExternalCert(port);
        if(certInfo == undefined) {
            res.writeHead(400, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: false, message: 'Invalid port'}));
            return;
        }
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true, certInfo: certInfo, message: ''}));
    }


    private onGetClientSysInfo = async (req: IncomingMessage, res: ServerResponse) => {
        let id = await this.getNumberInPath(req, res,'/api/clientSysInfo/', "Invalid client ID");
        if(id == undefined) return;
        let sysInfo = this._tttServer?.getClientSysInfo(id);
        if(sysInfo == undefined) {
            res.writeHead(400, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: false, message: 'Invalid client ID'}));
            return;
        }
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({...sysInfo,  ...{success: true, message: ''}} ));
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
        let isEmpty = await SessionStore.instance.isEmptyKey().then();
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({emptyKey: isEmpty}));
    }

    private onLoadCaptchaInfo = async (req: IncomingMessage, res: ServerResponse) => {
        setTimeout(async () => {
            let info = await CaptchaStore.instance.createCaptcha();
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: true, message: '', data: {
                    token: info.token,
                    expire: info.expire,
                    expireTime: info.expireTime,
                    image: info.image,
                    width: info.width,
                    height: info.height
                }}));
            CaptchaStore.instance.releaseImage(info.token!);
        }, 2000);


    }

    private onLogin = async (req: IncomingMessage, res: ServerResponse) => {
        setTimeout(async () => {
            let json = await AdminServer.readJson(req);
            let key = json['key'];
            let captcha = json['captcha'];
            let captchaToken = json['captchaToken'];
            if(!captcha) captcha = '';
            if(!captchaToken) captchaToken = '';
            let sessionStore =  SessionStore.instance;
            let success = await sessionStore.login(key);
            let validCaptcha = CaptchaStore.instance.verify(captchaToken, captcha);
            if(success && validCaptcha) {
                let sessionKey = await sessionStore.newSession();
                res.writeHead(200, {'Content-Type': 'application/json',
                    'Set-Cookie': `sessionKey=${sessionKey};path=/api/; HttpOnly; SameSite=Strict;${ServerOptionStore.instance.serverOption.adminTls === true ? ' secure;' : '' }`});
                res.end(JSON.stringify({success: true}));
            } else {
                res.writeHead(401, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({success: false}));
            }
        }, 3000);
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
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true, serverOption:  pureServerOption, message: ''}));
    }


    private onGetSysInfo = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let status = await SysMonitor.instance.sysInfo();
        res.writeHead(200, {'Content-Type': 'application/json'});
        let value = {success: true, message: ''} && status;
        res.end(JSON.stringify(value));
    }

    private onGetSysUsage = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let status = await SysMonitor.instance.usage();
        res.writeHead(200, {'Content-Type': 'application/json'});
        let value = {success: true, message: ''} && status;
        res.end(JSON.stringify(value));
    }

    private onGetClientStatus = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let status = this._tttServer?.clientStatus();
        res.writeHead(200, {'Content-Type': 'application/json'});
        let value = {success: true, message: ''} && status;
        res.end(JSON.stringify(value));
    }


    private onGetTunnelingOption = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let store = ServerOptionStore.instance;
        let tunnelingOptions = store.serverOption.tunnelingOptions;
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true, tunnelingOptions: tunnelingOptions, message: ''}));
    }

    private onGetExternalServerStatuses = async (req: IncomingMessage, res: ServerResponse) => {
        if(!await this.checkSession(req, res)) {
            return;
        }
        let statuses = this._tttServer?.externalServerStatuses();
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true,serverTime: Date.now(), statuses: statuses, message: ''}));
    }


    private onGetServerOptionHash = async (req: IncomingMessage, res: ServerResponse) => {
        let origin = req.headers['origin'];
        let serverOption = ServerOptionStore.instance.serverOption;
        let adminCert = CertificationStore.instance.getAdminCert();
        let pureServerOption : any = serverOption;
        delete pureServerOption['tunnelingOptions'];
        let hash = CryptoJS.SHA512(JSON.stringify(pureServerOption) + JSON.stringify(adminCert)).toString();
        res.writeHead(200, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin == undefined ? '*' : origin});
        res.end(JSON.stringify({success: true, hash: hash, message: ''}));
    }


    public async listen(port : number)  : Promise<number> {
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

    public async close() : Promise<boolean> {
        logger.info(`AdminServer.close()`);
        if(this._port < -1) {
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



}

export default AdminServer;
