import * as fs from "fs";
import * as Path from "path";
import YAML from "yaml";
import {
    ClientOption,
    DEFAULT_CLIENT_KEEP_ALIVE,
    DEFAULT_CLIENT_MEM_LIMIT_MIB,
    DEFAULT_CLIENT_PORT,
    DEFAULT_KEY,
    MAX_CLIENT_MEM_LIMIT_MIB,
    MIN_CLIENT_MEM_LIMIT_MIB,
    isValidClientMemLimit,
    normalizationClientOption
} from "../types/TunnelingOption";
import {parseServerAddress} from "../util/AddressParser";
import {normalizeBooleanOption} from "../server/ServerCliOptions";

/**
 * 클라이언트 옵션 해석(#201·#202·#205·#206·#209·#210·#211).
 *
 * 기본값 → client.yaml → 환경 변수 → 명령줄 순서로 합치고 검증한다. 파일을 읽기만 하고 쓰거나
 * 프로세스를 끝내지 않는다. 그래서 데몬 부모가 자식을 띄우기 전에 그대로 검증에 쓸 수 있다(#207).
 *
 * 실패 종료 코드(에픽 #216 공통 표): 2 = 명령줄 형식·범위·충돌, 78 = 설정 파일·참조 파일 오류.
 */
const CLIENT_OPTION_FILE_NAME = "client.yaml";
const CLIENT_SECRET_ENV = "TTTGATE_CLIENT_SECRET";
const INSECURE_FIELD_NAMES: ReadonlyArray<keyof ClientOption> = ["allowInsecureTls", "allowLegacyFallback"];
const TLS_OPTION_NAMES = ["ca", "serverName", "cert", "privateKey"] as const;
const PEM_FIELDS = ["ca", "cert", "privateKey"] as const;

type PemField = typeof PEM_FIELDS[number];
type ValueSource = "default" | "client.yaml" | "environment" | "file" | "command line" | "inferred";
type ResolveNotice = {level: "info" | "warn", message: string};
type ResolveClientOptionInput = {
    cli: {[key: string]: string};
    env: {[key: string]: string | undefined};
    configDir: string;
    cwd: string;
    /** 이름이 없을 때 쓸 기본 이름. 없으면 빈 문자열로 둔다. */
    defaultName?: () => string;
};
type ResolveClientOptionResult =
    | {ok: true, option: ClientOption, saveOption: {[key: string]: unknown}, notices: ResolveNotice[], sources: {[key: string]: ValueSource}}
    | {ok: false, exitCode: 2 | 78, message: string};

/** client.yaml 의 insecure 값이 게이트를 트리거하는지(true/1/"yes"/"on" 등, 그 밖의 타입은 보수적으로 참). */
const isTruthyInsecureValue = (v: unknown): boolean => {
    if(v === true) return true;
    if(v === false || v === null || v === undefined) return false;
    if(typeof v === "number") return v !== 0;
    if(typeof v === "string") {
        const s = v.trim().toLowerCase();
        return s === "true" || s === "1" || s === "yes" || s === "on";
    }
    return true;
};

const PEM_BLOCK: {[field in PemField]: RegExp} = {
    ca: /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/,
    cert: /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/,
    privateKey: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/
};
const PEM_KIND: {[field in PemField]: string} = {ca: "certificate", cert: "certificate", privateKey: "private key"};

const readYaml = (configDir: string): {ok: true, value?: {[key: string]: unknown}} | {ok: false, message: string} => {
    const file = Path.join(configDir, CLIENT_OPTION_FILE_NAME);
    if(!fs.existsSync(file)) return {ok: true};
    let text: string;
    try {
        text = fs.readFileSync(file, "utf-8");
    } catch (e) {
        return {ok: false, message: `cannot read ${file}: ${(e as Error).message}`};
    }
    if(text.trim().length === 0) return {ok: true};
    try {
        const value = YAML.parse(text);
        if(value == null) return {ok: true};
        if(typeof value !== "object" || Array.isArray(value)) return {ok: false, message: `${file} must be a YAML mapping`};
        return {ok: true, value};
    } catch (e) {
        return {ok: false, message: `cannot parse ${file}: ${(e as Error).message}`};
    }
};

const resolveClientOption = (input: ResolveClientOptionInput): ResolveClientOptionResult => {
    const {cli, env, configDir, cwd} = input;
    const notices: ResolveNotice[] = [];
    const warn = (message: string) => notices.push({level: "warn", message});
    const info = (message: string) => notices.push({level: "info", message});
    const sources: {[key: string]: ValueSource} = {};
    const has = (name: string) => cli[name] !== undefined;
    const cliFail = (message: string): ResolveClientOptionResult => ({ok: false, exitCode: 2, message});
    const fileFail = (message: string): ResolveClientOptionResult => ({ok: false, exitCode: 78, message});

    // 1. 기본값
    let option: ClientOption = {
        key: DEFAULT_KEY,
        host: "localhost",
        port: DEFAULT_CLIENT_PORT,
        tls: false,
        name: input.defaultName ? input.defaultName() : "",
        allowLegacyFallback: false,
        allowInsecureTls: false,
        globalMemCacheLimit: DEFAULT_CLIENT_MEM_LIMIT_MIB,
        keepAlive: DEFAULT_CLIENT_KEEP_ALIVE
    };
    for(const key of Object.keys(option)) sources[key] = "default";
    /** PEM 값의 원래 표기(경로 또는 본문)와 그 값을 푸는 기준 디렉터리. -save 는 원래 표기를 저장한다(#201 REQ-5). */
    const pemInputs: {[field in PemField]?: {value: string, baseDir: string}} = {};

    // 2. client.yaml
    const yaml = readYaml(configDir);
    if(!yaml.ok) return fileFail(yaml.message);
    const raw = yaml.value;
    if(raw) {
        const insecure = INSECURE_FIELD_NAMES.filter(name =>
            Object.prototype.hasOwnProperty.call(raw, name) && isTruthyInsecureValue(raw[name]));
        if(insecure.length > 0) {
            const accepted = has("yes-insecure") || has("yesInsecure");
            const message = `REFUSE-INSECURE-YAML: client.yaml contains insecure field(s) [${insecure.join(",")}]. ` +
                `Persisted insecure flags are forbidden. ` +
                (accepted ? `Override accepted via --yes-insecure.`
                    : `Re-run with --yes-insecure to override for this session, or remove the field(s) from client.yaml.`);
            if(!accepted) return fileFail(message);
            warn(message);
        }
        const fromYaml = {...raw} as {[key: string]: unknown};
        // #210 REQ-3: displayName 만 있으면 name 으로 읽는다. 둘 다 있고 다르면 name 을 쓴다.
        if(typeof fromYaml.displayName === "string" && fromYaml.displayName.length > 0) {
            if(typeof fromYaml.name !== "string" || fromYaml.name.length === 0) {
                fromYaml.name = fromYaml.displayName;
            } else if(fromYaml.name !== fromYaml.displayName) {
                warn(`client.yaml has both name '${fromYaml.name}' and displayName '${fromYaml.displayName}'. ` +
                    `Using name; displayName is a deprecated alias. A v2 server shows its registered name either way.`);
            }
        }
        delete fromYaml.displayName;
        option = normalizationClientOption({...option, ...fromYaml} as ClientOption, warn);
        for(const key of Object.keys(fromYaml)) sources[key] = "client.yaml";
        for(const field of PEM_FIELDS) {
            const value = fromYaml[field];
            if(typeof value === "string" && value.trim().length > 0) pemInputs[field] = {value, baseDir: configDir};
        }
    }
    const yamlTlsOptions = raw ? TLS_OPTION_NAMES.filter(name => typeof raw[name] === "string" && (raw[name] as string).length > 0) : [];

    // 3. 비밀값(#209): 명령줄 > 파일 > 환경 변수 > client.yaml
    if(has("clientSecret") && has("clientSecretFile")) {
        return cliFail("use either -clientSecret or -clientSecretFile, not both");
    }
    const envSecret = env[CLIENT_SECRET_ENV];
    if(envSecret !== undefined && envSecret.length > 0) {
        option.clientSecret = envSecret;
        sources.clientSecret = "environment";
    }
    if(has("clientSecretFile")) {
        const file = Path.resolve(cwd, cli.clientSecretFile);
        let text: string;
        try {
            text = fs.readFileSync(file, "utf-8");
        } catch (e) {
            return fileFail(`cannot read -clientSecretFile ${file}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
        }
        const secret = text.trim();
        if(secret.length === 0) return fileFail(`-clientSecretFile ${file} is empty`);
        option.clientSecret = secret;
        sources.clientSecret = "file";
    }
    const visibleSecrets = ["clientSecret", "key"].filter(name => has(name));
    if(visibleSecrets.length > 0) {
        warn(`${visibleSecrets.map(name => `-${name}`).join(" and ")} on the command line is visible to other users in the process list. ` +
            `Use the ${CLIENT_SECRET_ENV} environment variable or -clientSecretFile instead.`);
    }

    // 4. 명령줄
    if(has("key")) { option.key = cli.key; sources.key = "command line"; }
    if(has("clientSecret")) { option.clientSecret = cli.clientSecret; sources.clientSecret = "command line"; }
    if(has("clientId")) { option.clientId = cli.clientId; sources.clientId = "command line"; }

    let cliTls: boolean | undefined = has("tls") ? normalizeBooleanOption(cli.tls) : undefined;
    let schemeTls: boolean | undefined;
    if(has("addr")) {
        const parsed = parseServerAddress(cli.addr);
        if(!parsed.ok) return cliFail(`-addr: ${parsed.message}`);
        option.host = parsed.host;
        sources.host = "command line";
        if(parsed.port !== undefined) { option.port = parsed.port; sources.port = "command line"; }
        if(parsed.scheme) schemeTls = parsed.scheme === "tls";
    }
    if(schemeTls !== undefined && cliTls !== undefined && schemeTls !== cliTls) {
        return cliFail(`-addr ${cli.addr} disagrees with -tls${cliTls ? "" : " false"}`);
    }
    const commandTls = schemeTls ?? cliTls;

    // #210: -displayName 은 -name 의 폐기 예정 별칭
    if(has("displayName")) {
        if(has("name") && cli.name !== cli.displayName) {
            return cliFail(`-name '${cli.name}' and -displayName '${cli.displayName}' differ. -displayName is a deprecated alias of -name; use -name only`);
        }
        warn("-displayName is a deprecated alias of -name. A v2 server shows its registered name; -name is used for legacy connections and local logs.");
    }
    const name = cli.name ?? cli.displayName;
    if(name !== undefined && name.length > 0) { option.name = name; sources.name = "command line"; }

    if(has("serverName")) { option.serverName = cli.serverName; sources.serverName = "command line"; }
    for(const field of PEM_FIELDS) {
        if(has(field)) {
            pemInputs[field] = {value: cli[field], baseDir: cwd};
            sources[field] = "command line";
        }
    }
    if(has("keepAlive")) {
        // 잘못된 값은 기본값 폴백 + 경고(정규화)로 둔다. 기존 계약(test/component/client/keepalive-options.test.ts)이다.
        option.keepAlive = Math.floor(parseInt(cli.keepAlive));
        sources.keepAlive = "command line";
    }
    if(has("bufferLimit")) {
        const text = cli.bufferLimit.trim();
        const value = /^-?\d+$/.test(text) ? Number(text) : NaN;
        if(!isValidClientMemLimit(value)) {
            return cliFail(`-bufferLimit '${cli.bufferLimit}' must be -1 (no limit) or an integer within ${MIN_CLIENT_MEM_LIMIT_MIB}..${MAX_CLIENT_MEM_LIMIT_MIB}`);
        }
        option.globalMemCacheLimit = value;
        sources.globalMemCacheLimit = "command line";
    }
    if(has("allowLegacyFallback")) option.allowLegacyFallback = normalizeBooleanOption(cli.allowLegacyFallback) === true;
    if(has("allowInsecureTls")) option.allowInsecureTls = normalizeBooleanOption(cli.allowInsecureTls) === true;

    // 5. TLS(#205·#211): 명령줄의 TLS 옵션은 TLS 를 켠다. 명령줄에서 일부러 끈 것과 함께 오면 오류다.
    const cliTlsOptions = TLS_OPTION_NAMES.filter(name => has(name));
    if(commandTls !== undefined) {
        option.tls = commandTls;
        sources.tls = "command line";
    }
    if(cliTlsOptions.length > 0) {
        if(commandTls === false) {
            return cliFail(`${cliTlsOptions.map(n => `-${n}`).join(", ")} need TLS, but TLS is turned off by ` +
                (schemeTls === false ? `-addr ${cli.addr}` : "-tls false"));
        }
        if(!option.tls) {
            option.tls = true;
            sources.tls = "inferred";
            info(`TLS is on because ${cliTlsOptions.map(n => `-${n}`).join(", ")} ${cliTlsOptions.length > 1 ? "were" : "was"} given.`);
        }
    } else if(!option.tls && yamlTlsOptions.length > 0) {
        warn(`client.yaml sets ${yamlTlsOptions.join(", ")} but tls is false, so ${yamlTlsOptions.length > 1 ? "they are" : "it is"} not used. ` +
            "Set tls: true to use TLS.");
    }

    // 6. PEM 값(#201): 본문이면 그대로, 아니면 파일 경로로 읽는다.
    for(const field of PEM_FIELDS) {
        const pemInput = pemInputs[field];
        if(!pemInput) continue;
        // TLS 를 쓰지 않으면 client.yaml 의 PEM 은 쓰이지 않는다. 위에서 경고했으니 파일을 읽지 않는다.
        if(!option.tls) continue;
        const trimmed = pemInput.value.trim();
        if(trimmed.startsWith("-----BEGIN")) {
            if(!PEM_BLOCK[field].test(trimmed)) return fileFail(`${field}: the PEM text has no ${PEM_KIND[field]} block`);
            option[field] = trimmed;
            continue;
        }
        if(field === "privateKey" && /\r|\n/.test(trimmed)) {
            return fileFail("privateKey: the value is neither a PEM private key nor a file path");
        }
        const file = Path.resolve(pemInput.baseDir, trimmed);
        // privateKey 는 잘못 넣은 키 본문일 수도 있으므로 경로를 메시지에 남기지 않는다(#201 REQ-6).
        const shown = field === "privateKey" ? "the privateKey file" : file;
        let text: string;
        try {
            text = fs.readFileSync(file, "utf-8");
        } catch (e) {
            return fileFail(`${field}: cannot read ${shown}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
        }
        if(!PEM_BLOCK[field].test(text)) return fileFail(`${field}: ${shown} has no PEM ${PEM_KIND[field]} block`);
        option[field] = text;
    }

    option = normalizationClientOption(option, warn);
    delete option.displayName;

    // 7. -save 로 저장할 값: 사용자가 준 표기 그대로, insecure 필드·displayName 제외(#201·#209·#210, REQ-02)
    const saveOption: {[key: string]: unknown} = {...option};
    for(const field of PEM_FIELDS) {
        const pemInput = pemInputs[field];
        if(!pemInput) continue;
        // 명령줄의 상대 경로는 작업 디렉터리 기준이고 client.yaml 은 config/ 기준이다. 다음 실행에서도 같은 파일을 찾게
        // 명령줄에서 온 경로는 절대 경로로 저장한다. PEM 본문과 client.yaml 에서 온 값은 그대로 둔다.
        const trimmed = pemInput.value.trim();
        saveOption[field] = pemInput.baseDir === cwd && !trimmed.startsWith("-----BEGIN") ? Path.resolve(cwd, trimmed) : pemInput.value;
    }
    for(const name of INSECURE_FIELD_NAMES) delete saveOption[name];
    return {ok: true, option, saveOption, notices, sources};
};

export {
    resolveClientOption,
    ResolveClientOptionInput,
    ResolveClientOptionResult,
    ResolveNotice,
    ValueSource,
    CLIENT_OPTION_FILE_NAME,
    CLIENT_SECRET_ENV,
    INSECURE_FIELD_NAMES,
    isTruthyInsecureValue
};
