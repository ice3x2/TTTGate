import {ClientOption} from "../types/TunnelingOption";
import TunnelNames from "./TunnelNames";
import TTTClient from "./TTTClient";
import File from "../util/File";
import Environment from "../Environment";
import YAML from "yaml";
import Files from "../util/Files";
import CLI from "../util/CLI";
import LoggerFactory  from "../util/logger/LoggerFactory";
import AppCompositionRoot from "../bootstrap/AppCompositionRoot";
import {ClockRngProvider} from "../util/ClockRng";
import {redactSecrets} from "../util/SecretRedactor";
import {exitWithConfigError} from "../util/ConfigExit";
import {
    CLIENT_OPTION_FILE_NAME,
    INSECURE_FIELD_NAMES,
    resolveClientOption,
    ResolveClientOptionResult
} from "./ClientOptionResolver";
import * as fs from "fs";
import {isFlagOn} from "../server/ServerCliOptions";
const logger = LoggerFactory.getLogger('client', 'ClientApp');

/** client.yaml 의 insecure 필드를 --yes-insecure 없이 읽으면 이 코드로 끝난다(P3-T3 / REQ-02). */
const INSECURE_YAML_EXIT_CODE = 78;

let _printClientOptions = (clientOption: ClientOption) : void => {
    let options = '';
    let obj = redactSecrets(clientOption) as any;
    for(let key in obj) {
        options += `\t\t\t  -${key}: ${obj[key]} \n`;
    }
    logger.info(`Client options: \n${options}`);
}

const randomTunnelName = (): string => TunnelNames[Math.floor(ClockRngProvider.current().random() * TunnelNames.length)];

/**
 * 부작용 없이 옵션을 해석하고 검증한다(#207). 데몬 부모가 자식을 띄우기 전에 부른다.
 * 파일을 쓰거나 프로세스를 끝내지 않는다.
 */
const resolveClientCliOptions = (cliOptions: {[key: string]: string}): ResolveClientOptionResult =>
    resolveClientOption({
        cli: cliOptions,
        env: process.env,
        configDir: Environment.path.configDir,
        cwd: process.cwd(),
        defaultName: randomTunnelName
    });

/** -save: 사용자가 준 표기 그대로 저장하고, 비밀값이 들어 있으므로 POSIX 에서는 0600 으로 둔다(#209 REQ-6). */
const _saveClientOption = (saveOption: {[key: string]: unknown}): string => {
    const sanitized = {...saveOption};
    for(const name of INSECURE_FIELD_NAMES) delete sanitized[name];
    const file = new File(Environment.path.configDir, CLIENT_OPTION_FILE_NAME);
    fs.mkdirSync(Environment.path.configDir, {recursive: true});
    // 처음부터 0600 으로 만든다(쓴 뒤 chmod 하면 그 사이 비밀값이 0644 로 보인다). 기존 파일은 아래 chmod 가 맞춘다.
    fs.writeFileSync(file.toString(), YAML.stringify(sanitized), {encoding: "utf-8", mode: 0o600});
    if(process.platform !== "win32") {
        try {
            fs.chmodSync(file.toString(), 0o600);
        } catch (e) {
            logger.warn(`cannot restrict permissions of ${file.toString()} to 0600`, e);
        }
    }
    return file.toString();
};

/**
 * 옵션을 해석하고, 알림을 남기고, -save 를 처리한다. 설정 오류면 공통 종료 함수로 끝내고 undefined 를 돌려준다.
 */
let _loadClientOption = (cliOptions?: {[key: string]: string}) : ClientOption | undefined => {
    const argv = cliOptions ?? CLI.parseCommandLine().options;
    const result = resolveClientCliOptions(argv);
    if(!result.ok) {
        void exitWithConfigError(result.exitCode, result.message, logger);
        return undefined;
    }
    for(const notice of result.notices) {
        if(notice.level === "warn") logger.warn(notice.message);
        else logger.info(notice.message);
    }
    const clientOption = result.option;
    if(isFlagOn(argv, "save")) {
        _saveClientOption(result.saveOption);
    }
    _printClientOptions(clientOption);
    if(clientOption.allowLegacyFallback === true) {
        // 허위 서버가 v1 로 내려 응답하면 공유 키를 그대로 보낸다(#174). 승인된 롤백 기간에만 켠다.
        logger.warn('allowLegacyFallback is on: a server that answers with the legacy protocol receives the shared key. Use it only during an approved rollback window.');
    }
    AppCompositionRoot.applyGlobalMemLimitMiB(clientOption.globalMemCacheLimit);
    return clientOption;
}


let ClientApp : { start(options?: {[key: string]: string}) : void} = {

    start(options?: {[key: string]: string}) {
        AppCompositionRoot.applyGlobalMemLimitMiB(128);
        const clientOption = _loadClientOption(options);
        if(!clientOption) return;
        let tttClient = TTTClient.create(clientOption);

        tttClient.start();


    }
}


export default ClientApp;
export {resolveClientCliOptions, _saveClientOption as saveClientOptionFile};
// P3-T3 / REQ-02: 테스트 전용 익스포트. 런타임 경로에서는 사용하지 않는다.
// (production 임포터는 default export만 참조)
export const __testInternals = {
    loadClientOption: _loadClientOption,
    INSECURE_FIELD_NAMES,
    INSECURE_YAML_EXIT_CODE,
    CLIENT_OPTION_FILE_NAME
};
