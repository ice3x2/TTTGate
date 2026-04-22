import {ClientOption, DEFAULT_KEY, normalizationClientOption as normalizeClientOptionShared} from "../types/TunnelingOption";
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
const logger = LoggerFactory.getLogger('client', 'ClientApp');

const CLIENT_OPTION_FILE_NAME = "client.yaml";



let _printClientOptions = (clientOption: ClientOption) : void => {
    let options = '';
    let obj = redactSecrets(clientOption) as any;
    for(let key in obj) {
        options += `\t\t\t  -${key}: ${obj[key]} \n`;
    }
    logger.info(`Client options: \n${options}`);
}


/**
 * P3-T3 / REQ-02 — YAML 설정의 insecure/legacy 플래그를 안전하게 로드한다.
 *
 * 정책:
 *  - `allowInsecureTls`, `allowLegacyFallback` 가 YAML에 기록되어 있으면 WARN 로그.
 *  - `--yes-insecure` CLI 플래그가 없으면 치명 오류로 프로세스를 종료한다 (exit code 78).
 *  - 해당 플래그 자체를 YAML에 저장하는 것은 `_saveClientOption`에서 차단한다(아래 함수).
 *
 * 근거: insecure/legacy 옵션은 1회성 운영 오버라이드이며 영구 저장 시
 *       설정 자체가 하향 평준화된다. 명시적 재확인(`--yes-insecure`)을 강제한다.
 */
const INSECURE_FIELD_NAMES: ReadonlyArray<keyof ClientOption> = ["allowInsecureTls", "allowLegacyFallback"];
const INSECURE_YAML_EXIT_CODE = 78;

/**
 * YAML 값이 "insecure 활성화"에 해당하는지 판정.
 *  - false / null / undefined / 0 / "false" / "0" / "no" / "off" 등은 게이트를 트리거하지 않는다.
 *  - true / 1 / "true" / "1" / "yes" / "on" (대소문자 무시) 만 트리거한다.
 *  - 숫자/문자열 이외의 값(객체/배열)은 보수적으로 truthy 취급.
 */
const _isTruthyInsecureValue = (v: unknown): boolean => {
    if(v === true) return true;
    if(v === false || v === null || v === undefined) return false;
    if(typeof v === "number") return v !== 0;
    if(typeof v === "string") {
        const s = v.trim().toLowerCase();
        return s === "true" || s === "1" || s === "yes" || s === "on";
    }
    // 예기치 못한 타입(객체/배열 등)은 보수적으로 게이트 트리거.
    return true;
};

let _loadClientOptionFromFile = (cliOptions?: {[key: string]: string}) : ClientOption | undefined => {

    let file = new File(Environment.path.configDir, CLIENT_OPTION_FILE_NAME);
    if(file.canRead()) {
        let yamlString = Files.toStringSync(file);
        if(yamlString == undefined || yamlString.length == 0) return undefined;
        let clientOption = YAML.parse(yamlString) as any;
        // P3-T3: insecure 필드가 YAML에 존재하면 WARN + gate.
        const found: string[] = [];
        if(clientOption && typeof clientOption === "object") {
            for(const name of INSECURE_FIELD_NAMES) {
                if(Object.prototype.hasOwnProperty.call(clientOption, name)
                    && _isTruthyInsecureValue((clientOption as any)[name])) {
                    found.push(String(name));
                }
            }
        }
        if(found.length > 0) {
            const argv = cliOptions ?? CLI.parseCommandLine().options;
            const hasYesInsecure = argv["yes-insecure"] !== undefined || argv["yesInsecure"] !== undefined;
            const msg = `REFUSE-INSECURE-YAML: client.yaml contains insecure field(s) [${found.join(",")}]. ` +
                        `Persisted insecure flags are forbidden. ` +
                        (hasYesInsecure
                            ? `Override accepted via --yes-insecure.`
                            : `Re-run with --yes-insecure to override for this session, ` +
                              `or remove the field(s) from client.yaml.`);
            logger.warn(msg);
            if(!hasYesInsecure) {
                // stderr에도 기록하여 CI 로그에서 사유를 즉시 인식할 수 있도록 한다.
                try { process.stderr.write(msg + "\n"); } catch { /* noop */ }
                process.exit(INSECURE_YAML_EXIT_CODE);
            }
        }
        return clientOption as ClientOption;
    }
    return undefined;
}



// P6-T3 / REQ-15: 옵션 정규화는 src/types/TunnelingOption.ts의 공통 normalizationClientOption으로 일원화.
// 이 래퍼는 name 기본값(무작위 TunnelName) 주입과 logger 주입만 담당한다.
let normalizationClientOption = (clientOption: ClientOption) : ClientOption => {
    const normalized = normalizeClientOptionShared(clientOption, (msg: string) => logger.warn(msg));
    if(!normalized.name || normalized.name.length === 0) {
        normalized.name = TunnelNames[Math.floor(ClockRngProvider.current().random() * TunnelNames.length)];
    }
    return normalized;
}

let _loadClientOption = (cliOptions?: {[key: string]: string}) : ClientOption => {

    let clientOption : ClientOption = {
        key: DEFAULT_KEY,
        host: "localhost",
        port: 9126,
        tls: false,
        name: TunnelNames[Math.floor(ClockRngProvider.current().random() * TunnelNames.length)],
        allowLegacyFallback: false,
        allowInsecureTls: false,
        globalMemCacheLimit: 128,
        keepAlive: 0
    }
    let argv = cliOptions ?? CLI.parseCommandLine().options;
    let savedOption = _loadClientOptionFromFile(argv);
    if(savedOption) {
        clientOption = normalizationClientOption(savedOption);
    }
    if(argv["key"]) {
        clientOption.key = argv["key"];
    }
    if(argv["addr"]) {
        let addr = argv["addr"];
        let addrSplit = addr.split(":");
        if(addrSplit.length == 2) {
            clientOption.host = addrSplit[0];
            // P6-T3 / REQ-15: 인라인 범위 검증 제거. normalizationClientOption이 공통 정규화.
            const parsed = parseInt(addrSplit[1], 10);
            clientOption.port = isNaN(parsed) ? 0 : parsed;
        } else {
            clientOption.host = addr;
        }
    }
    if(argv["keepAlive"]) {
        clientOption.keepAlive = Math.floor(parseInt(argv["keepAlive"]));
        if(isNaN(clientOption.keepAlive)){
            console.warn(`keepAlive '${argv["keepAlive"]}' is not number.`);
            clientOption.keepAlive = -1;
        }
        else if(clientOption.keepAlive < 0) {
            console.warn(`keepAlive is disabled. (keepAlive: ${clientOption.keepAlive})`);
            clientOption.keepAlive = -1;
        }
    }
    if(argv["tls"] != undefined && (argv["tls"] == "" || argv["tls"].toLowerCase() != "false")) {
        clientOption.tls = true;
    }
    if(argv["name"]) {
        clientOption.name = argv["name"];
    }
    if(argv["clientId"]) {
        clientOption.clientId = argv["clientId"];
    }
    if(argv["clientSecret"]) {
        clientOption.clientSecret = argv["clientSecret"];
    }
    if(argv["displayName"]) {
        clientOption.displayName = argv["displayName"];
    }
    if(argv["serverName"]) {
        clientOption.serverName = argv["serverName"];
    }
    if(argv["ca"]) {
        clientOption.ca = argv["ca"];
    }
    if(argv["cert"]) {
        clientOption.cert = argv["cert"];
    }
    if(argv["privateKey"]) {
        clientOption.privateKey = argv["privateKey"];
    }
    if(argv["allowLegacyFallback"] != undefined && (argv["allowLegacyFallback"] == "" || argv["allowLegacyFallback"].toLowerCase() != "false")) {
        clientOption.allowLegacyFallback = true;
    }
    if(argv["allowInsecureTls"] != undefined && (argv["allowInsecureTls"] == "" || argv["allowInsecureTls"].toLowerCase() != "false")) {
        clientOption.allowInsecureTls = true;
    }
    if(argv["bufferLimit"]) {
        clientOption.globalMemCacheLimit = Math.floor(parseInt(argv["bufferLimit"]));
        if(isNaN(clientOption.globalMemCacheLimit)){
            console.warn(`bufferLimit '${argv["bufferLimit"]}' is not number.`);
            clientOption.globalMemCacheLimit = 238;
        }
        else if(clientOption.globalMemCacheLimit < -1) {
            console.warn(`bufferLimit '${argv["bufferLimit"]}' is less than -1.`);
            clientOption.globalMemCacheLimit = -1;
        } else if(clientOption.globalMemCacheLimit > 1048576) {
            clientOption.globalMemCacheLimit = 1048576
        }
    }
    // P6-T3 / REQ-15: CLI 병합 후 최종 정규화(범위 검증). 음수/범위 외 값은 이 시점에 기본값 폴백 + WARN.
    clientOption = normalizationClientOption(clientOption);

    if(argv["save"] != undefined && (argv["save"] == "" || argv["save"].toLowerCase() != "false")) {
        // P3-T3 / REQ-02: insecure/legacy 필드는 절대 YAML에 저장하지 않는다.
        // 런타임 CLI 오버라이드만 허용하여 영구 하향평준화를 차단.
        const sanitized: any = { ...clientOption };
        for(const name of INSECURE_FIELD_NAMES) {
            if(Object.prototype.hasOwnProperty.call(sanitized, name)) {
                delete sanitized[name];
            }
        }
        let file = new File(Environment.path.configDir, CLIENT_OPTION_FILE_NAME);
        let yamlString = YAML.stringify(sanitized);
        Files.writeSync(file, yamlString);
    }
    _printClientOptions(clientOption);
    AppCompositionRoot.applyGlobalMemLimitMiB(clientOption.globalMemCacheLimit);
    return clientOption;
}


let ClientApp : { start(options?: {[key: string]: string}) : void} = {

    start(options?: {[key: string]: string}) {
        AppCompositionRoot.applyGlobalMemLimitMiB(128);
        let tttClient = TTTClient.create(_loadClientOption(options));

        tttClient.start();


    }
}


export default ClientApp;
// P3-T3 / REQ-02: 테스트 전용 익스포트. 런타임 경로에서는 사용하지 않는다.
// (production 임포터는 default export만 참조)
export const __testInternals = {
    loadClientOptionFromFile: _loadClientOptionFromFile,
    loadClientOption: _loadClientOption,
    INSECURE_FIELD_NAMES,
    INSECURE_YAML_EXIT_CODE,
    CLIENT_OPTION_FILE_NAME
};
