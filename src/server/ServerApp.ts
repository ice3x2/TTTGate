import TTTServer from "./TTTServer";
import ServerOptionStore from "./ServerOptionStore";
import AdminServer from "./admin/AdminServer";
import {CertificationStore, CertInfo} from "./CertificationStore";
import {ServerOption} from "../types/TunnelingOption";
import ObjectUtil from "../util/ObjectUtil";
import CLI from "../util/CLI";
import Files from "../util/Files";
import File from "../util/File";
import Environment from "../Environment";
import { SocketHandler } from  "../util/SocketHandler";
import Errors from "../util/Errors";
import LoggerFactory  from "../util/logger/LoggerFactory";
const logger = LoggerFactory.getLogger('server', 'ServerApp');

let adminServer : AdminServer;
let oldOption : ServerOption;
let oldAdminCertInfo : CertInfo;
let tttServer : TTTServer;



let onServerOptionUpdate = async (newOption: ServerOption) => {

    await adminServer.close();
    await tttServer.close();
    try {
        await startService(newOption, CertificationStore.instance.getAdminCert());
        oldOption = ObjectUtil.cloneDeep(newOption);
    } catch (err) {
        logger.error('serverApp::onServerOptionUpdate failed to start server. Reverting to old option',err);
        console.error(Errors.toString(err));
        if(newOption != oldOption) {
            let serverOptionStore = ServerOptionStore.instance;
            serverOptionStore.onServerOptionUpdateCallback = undefined;
            serverOptionStore.updateServerOption(ObjectUtil.cloneDeep(oldOption));
            serverOptionStore.onServerOptionUpdateCallback = onServerOptionUpdate;
            await CertificationStore.instance.updateAdminServerCert(ObjectUtil.cloneDeep(oldAdminCertInfo));
            await startService(oldOption, oldAdminCertInfo);
        }
    }
}

let startService = async (serverOption: ServerOption, adminCertInfo: CertInfo) => {
    SocketHandler.GlobalMemCacheLimit = (serverOption.globalMemCacheLimit ?? 512) * 1024 * 1024;
    tttServer = TTTServer.create(serverOption);
    adminServer = new AdminServer(tttServer, serverOption.adminTls === true, adminCertInfo);
    await adminServer.listen(serverOption.adminPort!);
    await tttServer.start();
}


let ServerApp : {start() : Promise<void>} = {
    start : async (): Promise<void> => {

        let options = CLI.readSimpleOptions();
        let serverOptionStore = ServerOptionStore.instance;
        let certStore = CertificationStore.instance;
        if(options['reset'] != undefined && (options['reset'] == '' || options['reset'].toLowerCase() == 'false')) {
            Files.deleteAll(new File(Environment.path.configDir));
            serverOptionStore.reset();
            await certStore.reset();
        }
        await certStore.load();
        if(options['adminPort']) {
            let port = parseInt(options['adminPort']);
            if(isNaN(port) || port <= 0 || port > 65535) {
                console.error('Invalid admin port number (1 ~ 65535)');
                process.exit(1);
            }
            let serverOption = serverOptionStore.serverOption;
            serverOption.adminPort = port;
            serverOptionStore.updateServerOption(serverOption);
        }

        process.nextTick(() => {
            serverOptionStore.onServerOptionUpdateCallback = onServerOptionUpdate;
        });
        oldOption = ObjectUtil.cloneDeep(serverOptionStore.serverOption);
        oldAdminCertInfo = ObjectUtil.cloneDeep(certStore.getAdminCert());
        try {
            await startService(serverOptionStore.serverOption, certStore.getAdminCert());
        } catch (e) {
            console.log(e);
            process.exit(1);
        }
    }

}

export default ServerApp;










