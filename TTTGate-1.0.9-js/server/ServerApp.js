"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const TTTServer_1 = __importDefault(require("./TTTServer"));
const ServerOptionStore_1 = __importDefault(require("./ServerOptionStore"));
const AdminServer_1 = __importDefault(require("./admin/AdminServer"));
const CertificationStore_1 = require("./CertificationStore");
const ObjectUtil_1 = __importDefault(require("../util/ObjectUtil"));
const CLI_1 = __importDefault(require("../util/CLI"));
const Files_1 = __importDefault(require("../util/Files"));
const File_1 = __importDefault(require("../util/File"));
const Environment_1 = __importDefault(require("../Environment"));
const SocketHandler_1 = require("../util/SocketHandler");
const Errors_1 = __importDefault(require("../util/Errors"));
const LoggerFactory_1 = __importDefault(require("../util/logger/LoggerFactory"));
const logger = LoggerFactory_1.default.getLogger('server', 'ServerApp');
let adminServer;
let oldOption;
let oldAdminCertInfo;
let tttServer;
let onServerOptionUpdate = async (newOption) => {
    await adminServer.close();
    await tttServer.close();
    try {
        await startService(newOption, CertificationStore_1.CertificationStore.instance.getAdminCert());
        oldOption = ObjectUtil_1.default.cloneDeep(newOption);
    }
    catch (err) {
        logger.error('onServerOptionUpdate failed to start server. Reverting to old option', err);
        console.error(Errors_1.default.toString(err));
        if (newOption != oldOption) {
            let serverOptionStore = ServerOptionStore_1.default.instance;
            serverOptionStore.onServerOptionUpdateCallback = undefined;
            serverOptionStore.updateServerOption(ObjectUtil_1.default.cloneDeep(oldOption));
            serverOptionStore.onServerOptionUpdateCallback = onServerOptionUpdate;
            await CertificationStore_1.CertificationStore.instance.updateAdminServerCert(ObjectUtil_1.default.cloneDeep(oldAdminCertInfo));
            await startService(oldOption, oldAdminCertInfo);
        }
    }
};
let startService = async (serverOption, adminCertInfo) => {
    SocketHandler_1.SocketHandler.GlobalMemCacheLimit = (serverOption.globalMemCacheLimit ?? 128) * 1024 * 1024;
    logger.info("Start service with option: " + JSON.stringify(serverOption, null, 2));
    tttServer = TTTServer_1.default.create(serverOption);
    adminServer = new AdminServer_1.default(tttServer, serverOption.adminTls === true, adminCertInfo);
    await adminServer.listen(serverOption.adminPort);
    await tttServer.start();
};
let ServerApp = {
    start: async () => {
        let options = CLI_1.default.readSimpleOptions();
        let serverOptionStore = ServerOptionStore_1.default.instance;
        let certStore = CertificationStore_1.CertificationStore.instance;
        if (options['reset'] != undefined && (options['reset'] == '' || options['reset'].toLowerCase() == 'false')) {
            Files_1.default.deleteAll(new File_1.default(Environment_1.default.path.configDir));
            serverOptionStore.reset();
            await certStore.reset();
        }
        await certStore.load();
        if (options['adminPort']) {
            let port = parseInt(options['adminPort']);
            if (isNaN(port) || port <= 0 || port > 65535) {
                console.error('Invalid admin port number (1 ~ 65535)');
                process.exit(1);
            }
            let serverOption = serverOptionStore.serverOption;
            serverOption.adminPort = port;
            serverOptionStore.updateServerOption(serverOption);
        }
        if (options['keepAlive']) {
            let keepAlive = parseInt(options['keepAlive']);
            if (isNaN(keepAlive) || keepAlive < 0) {
                console.error('Invalid keep alive time');
                process.exit(1);
            }
            let serverOption = serverOptionStore.serverOption;
            serverOption.keepAlive = keepAlive;
            serverOptionStore.updateServerOption(serverOption);
        }
        process.nextTick(() => {
            serverOptionStore.onServerOptionUpdateCallback = onServerOptionUpdate;
        });
        oldOption = ObjectUtil_1.default.cloneDeep(serverOptionStore.serverOption);
        oldAdminCertInfo = ObjectUtil_1.default.cloneDeep(certStore.getAdminCert());
        try {
            await startService(serverOptionStore.serverOption, certStore.getAdminCert());
        }
        catch (e) {
            console.log(e);
            process.exit(1);
        }
    }
};
exports.default = ServerApp;
