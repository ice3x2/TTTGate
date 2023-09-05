import TTTServer from "./TTTServer";
import ServerOptionStore from "./ServerOptionStore";
import AdminServer from "./admin/AdminServer";
import {CertificationStore, CertInfo} from "./CertificationStore";
import {ServerOption} from "../option/Options";
import ObjectUtil from "../util/ObjectUtil";
import {logger} from "../commons/Logger";


let adminServer : AdminServer;
let oldOption : ServerOption;
let oldAdminCertInfo : CertInfo;
let tttServer : TTTServer;


let onServerOptionUpdate = async (newOption: ServerOption) => {

    await adminServer.close();
    await tttServer.close();
    try {
        await start(newOption, CertificationStore.instance.getAdminCert());
        oldOption = ObjectUtil.cloneDeep(newOption);
    } catch (err) {
        logger.error('app::onServerOptionUpdate failed to start server. Reverting to old option');
        logger.error(err);
        console.error(err);
        if(newOption != oldOption) {
            let serverOptionStore = ServerOptionStore.instance;
            serverOptionStore.onServerOptionUpdateCallback = undefined;
            serverOptionStore.updateServerOption(ObjectUtil.cloneDeep(oldOption));
            serverOptionStore.onServerOptionUpdateCallback = onServerOptionUpdate;
            await CertificationStore.instance.updateAdminServerCert(ObjectUtil.cloneDeep(oldAdminCertInfo));
            await start(oldOption, oldAdminCertInfo);
        }
    }
}

let start = async (serverOption: ServerOption, adminCertInfo: CertInfo) => {
    tttServer = TTTServer.create(serverOption);
    adminServer = new AdminServer(tttServer, serverOption.adminTls === true, adminCertInfo);
    await adminServer.listen(serverOption.adminPort!);
    await tttServer.start();
}


let app = async () => {
    let serverOptionStore = ServerOptionStore.instance;
    let certStore = CertificationStore.instance;

    await certStore.load();
    serverOptionStore.onServerOptionUpdateCallback = onServerOptionUpdate;
    oldOption = ObjectUtil.cloneDeep(serverOptionStore.serverOption);
    oldAdminCertInfo = ObjectUtil.cloneDeep(certStore.getAdminCert());
    await start(serverOptionStore.serverOption, certStore.getAdminCert());
}


app().then(() => {
    logger.info('Server started');
}).catch((err) => {
    logger.error('Error');
    logger.error(err);
});











