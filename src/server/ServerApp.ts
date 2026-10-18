import TTTServer from "./TTTServer";
import ServerOptionStore from "./ServerOptionStore";
import AdminServer from "./admin/AdminServer";
import {CertificationStore, CertInfo} from "./CertificationStore";
import {DEFAULT_AUDIT_QUEUE_SIZE, DEFAULT_AUDIT_RETENTION_DAYS, DEFAULT_GEO_CONFIG, ServerOption} from "../types/TunnelingOption";
import {AdmissionController} from "./security/AdmissionController";
import CLI from "../util/CLI";
import Files from "../util/Files";
import File from "../util/File";
import Environment from "../Environment";
import LoggerFactory  from "../util/logger/LoggerFactory";
import AppCompositionRoot from "../bootstrap/AppCompositionRoot";
import {shouldResetServerState} from "./ServerCliOptions";
import {redactSecrets} from "../util/SecretRedactor";
import {IdentityMigration} from "./rbac/IdentityMigration";
import {AuditSinkRegistry} from "./audit/AuditSink";
import {auditDirPath, FileAuditSink} from "./audit/FileAuditSink";
import {
    AdminSecurityPolicyRegistry,
    buildAdminSecurityAllowancesFromCliOptions,
    evaluateAdminSecurityPolicy,
    formatAdminSecurityPolicyErrors,
    trustedProxyHopsCliWarning
} from "./AdminSecurityPolicy";

const logger = LoggerFactory.getLogger('server', 'ServerApp');

let adminServer : AdminServer;
let tttServer : TTTServer;

const startService = async (serverOption: ServerOption, adminCertInfo: CertInfo) => {
    const identity = await IdentityMigration.runAtStartup();
    if(identity.kind === 'legacy-fallback') {
        logger.error(`identity store unavailable (${identity.reason}); continuing with legacy admin key only`);
    }
    AppCompositionRoot.applyGlobalMemLimitMiB(serverOption.globalMemCacheLimit ?? 128);
    logger.info("Start service with option: " + JSON.stringify(redactSecrets(serverOption), null, 2));
    AdmissionController.instance.configureGeo(serverOption.connectionSecurity?.geo ?? DEFAULT_GEO_CONFIG);
    tttServer = TTTServer.create(serverOption);
    // 감사 싱크는 AdminServer 보다 먼저 등록해 첫 요청의 감사 이벤트도 파일에 남게 한다.
    const auditSink = new FileAuditSink({
        dir: auditDirPath(),
        queueSize: serverOption.auditQueueSize ?? DEFAULT_AUDIT_QUEUE_SIZE,
        retentionDays: serverOption.auditRetentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS
    });
    auditSink.startRetentionTimer();
    AuditSinkRegistry.set(auditSink);
    adminServer = new AdminServer(tttServer, serverOption.adminTls === true, adminCertInfo);
    await adminServer.listen(serverOption.adminPort!, serverOption.adminBindHost);
    await tttServer.start();
    ServerOptionStore.instance.markLastKnownGood();
    CertificationStore.instance.markLastKnownGood();
}

const applyStartupOptions = (cliOptions: {[key: string]: string}, serverOptionStore: ServerOptionStore): void => {
    if(cliOptions["adminPort"]) {
        let port = parseInt(cliOptions["adminPort"]);
        if(isNaN(port) || port <= 0 || port > 65535) {
            console.error('Invalid admin port number (1 ~ 65535)');
            process.exit(1);
        }
        let serverOption = serverOptionStore.serverOption;
        serverOption.adminPort = port;
        serverOptionStore.updateServerOption(serverOption);
    }
    if(cliOptions["keepAlive"]) {
        let keepAlive = parseInt(cliOptions["keepAlive"]);
        if(isNaN(keepAlive) || keepAlive < 0) {
            console.error('Invalid keep alive time');
            process.exit(1);
        }
        let serverOption = serverOptionStore.serverOption;
        serverOption.keepAlive = keepAlive;
        serverOptionStore.updateServerOption(serverOption);
    }
    if(cliOptions["allowLegacyControlAuth"] != undefined) {
        let serverOption = serverOptionStore.serverOption;
        serverOption.allowLegacyControlAuth = cliOptions["allowLegacyControlAuth"] == "" || cliOptions["allowLegacyControlAuth"].toLowerCase() != "false";
        serverOptionStore.updateServerOption(serverOption);
    }
}

let ServerApp : {start(options?: {[key: string]: string}) : Promise<void>} = {
    start : async (options?: {[key: string]: string}): Promise<void> => {
        let cliOptions = options ?? CLI.parseCommandLine().options;
        AdminSecurityPolicyRegistry.configure(buildAdminSecurityAllowancesFromCliOptions(cliOptions));
        let {serverOptionStore, certStore} = AppCompositionRoot.serverStores();
        if(shouldResetServerState(cliOptions)) {
            Files.deleteAll(new File(Environment.path.configDir));
            serverOptionStore.reset();
            await certStore.reset();
        }
        const loaded = serverOptionStore.readServerOption();
        if(!loaded.success) {
            logger.error(loaded.message);
            console.error(loaded.message);
            process.exitCode = 1;
            return;
        }
        await certStore.load();
        applyStartupOptions(cliOptions, serverOptionStore);
        const policyDecision = evaluateAdminSecurityPolicy(serverOptionStore.serverOption);
        if(!policyDecision.allowed) {
            const message = formatAdminSecurityPolicyErrors(policyDecision);
            logger.error(message);
            console.error(message);
            process.exit(1);
        }
        const hopsWarning = trustedProxyHopsCliWarning(cliOptions);
        [...policyDecision.warnings, ...(hopsWarning ? [hopsWarning] : [])].forEach((warning) => {
            logger.warn(warning);
            console.warn(warning);
        });
        try {
            await startService(serverOptionStore.serverOption, certStore.getAdminCert());
        } catch (e) {
            console.log(e);
            process.exit(1);
        }
    }
}

export default ServerApp;
