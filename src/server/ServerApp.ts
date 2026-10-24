import TTTServer from "./TTTServer";
import ServerOptionStore from "./ServerOptionStore";
import AdminServer from "./admin/AdminServer";
import {CertificationStore, CertInfo} from "./CertificationStore";
import {DEFAULT_AUDIT_QUEUE_SIZE, DEFAULT_AUDIT_RETENTION_DAYS, DEFAULT_GEO_CONFIG, DEFAULT_LOG_LEVEL, ServerOption} from "../types/TunnelingOption";
import {AdmissionController} from "./security/AdmissionController";
import CLI from "../util/CLI";
import Files from "../util/Files";
import File from "../util/File";
import Environment from "../Environment";
import LoggerFactory  from "../util/logger/LoggerFactory";
import AppCompositionRoot from "../bootstrap/AppCompositionRoot";
import {legacyControlAuthFromCli, shouldResetServerState} from "./ServerCliOptions";
import {redactSecrets} from "../util/SecretRedactor";
import {exitWithConfigError} from "../util/ConfigExit";
import * as fs from "fs";
import * as Path from "path";
import YAML from "yaml";
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
    // #267: server.yaml 의 logLevel 을 시작할 때 모든 로그 출력에 적용한다. 실행 중에는 applyServerOption 이 바꾼다.
    LoggerFactory.setLevel(serverOption.logLevel ?? DEFAULT_LOG_LEVEL);
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

/**
 * 부작용 없이 서버 명령줄 값과 server.yaml 구문을 검사한다(#207). 데몬 부모가 자식을 띄우기 전에 부른다.
 * 서버의 값 오류는 호환을 위해 종료 코드 1 을 유지한다(에픽 #216 공통 표).
 */
const validateServerCliOptions = (cliOptions: {[key: string]: string}): {ok: true} | {ok: false, exitCode: 1, message: string} => {
    if(cliOptions["adminPort"]) {
        const port = parseInt(cliOptions["adminPort"]);
        if(isNaN(port) || port <= 0 || port > 65535) return {ok: false, exitCode: 1, message: 'Invalid admin port number (1 ~ 65535)'};
    }
    if(cliOptions["keepAlive"]) {
        const keepAlive = parseInt(cliOptions["keepAlive"]);
        if(isNaN(keepAlive) || keepAlive < 0) return {ok: false, exitCode: 1, message: 'Invalid keep alive time'};
    }
    const yamlFile = Path.join(Environment.path.configDir, 'server.yaml');
    if(fs.existsSync(yamlFile)) {
        let parsed: any;
        try {
            parsed = YAML.parse(fs.readFileSync(yamlFile, 'utf-8'));
        } catch (e) {
            return {ok: false, exitCode: 1, message: `cannot parse ${yamlFile}: ${(e as Error).message}`};
        }
        // 가장 흔한 기동 실패인 관리자 보안 정책도 부모에서 본다. 명령줄 허용 플래그를 그대로 반영한다.
        if(parsed && typeof parsed === 'object') {
            const decision = evaluateAdminSecurityPolicy({...parsed, adminTls: parsed.adminTls === true},
                buildAdminSecurityAllowancesFromCliOptions(cliOptions));
            if(!decision.allowed) return {ok: false, exitCode: 1, message: formatAdminSecurityPolicyErrors(decision)};
        }
    }
    return {ok: true};
};

const applyStartupOptions = async (cliOptions: {[key: string]: string}, serverOptionStore: ServerOptionStore): Promise<boolean> => {
    const valid = validateServerCliOptions(cliOptions);
    if(!valid.ok) {
        await exitWithConfigError(valid.exitCode, valid.message, logger);
        return false;
    }
    if(cliOptions["adminPort"]) {
        let port = parseInt(cliOptions["adminPort"]);
        let serverOption = serverOptionStore.serverOption;
        serverOption.adminPort = port;
        serverOptionStore.updateServerOption(serverOption);
    }
    if(cliOptions["keepAlive"]) {
        let keepAlive = parseInt(cliOptions["keepAlive"]);
        let serverOption = serverOptionStore.serverOption;
        serverOption.keepAlive = keepAlive;
        serverOptionStore.updateServerOption(serverOption);
    }
    const legacyControlAuth = legacyControlAuthFromCli(cliOptions);
    if(legacyControlAuth !== undefined) {
        let serverOption = serverOptionStore.serverOption;
        serverOption.allowLegacyControlAuth = legacyControlAuth;
        serverOptionStore.updateServerOption(serverOption);
    }
    return true;
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
            await exitWithConfigError(1, loaded.message, logger);
            return;
        }
        await certStore.load();
        if(!await applyStartupOptions(cliOptions, serverOptionStore)) return;
        const policyDecision = evaluateAdminSecurityPolicy(serverOptionStore.serverOption);
        if(!policyDecision.allowed) {
            await exitWithConfigError(1, formatAdminSecurityPolicyErrors(policyDecision), logger);
            return;
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
export {validateServerCliOptions};
