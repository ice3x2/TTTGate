import {resolveClientCliOptions, saveClientOptionFile} from "./ClientApp";
import {INSECURE_FIELD_NAMES, ResolveClientOptionResult} from "./ClientOptionResolver";

/**
 * TTTGate client config show / config save (#215). 연결하지 않고, Sentinel 을 시작하지 않으며, PID·로그 파일을 쓰지 않는다.
 */
type ConfigIo = {out: (line: string) => void, err: (line: string) => void};

const SECRET_FIELDS = new Set(["clientSecret", "key", "privateKey"]);

const printNotices = (result: ResolveClientOptionResult, io: ConfigIo): void => {
    if(!result.ok) return;
    for(const notice of result.notices) io.err(`${notice.level === "warn" ? "warning" : "note"}: ${notice.message}`);
};

const showClientConfig = (cli: {[key: string]: string}, io: ConfigIo): number => {
    let result = resolveClientCliOptions(cli);
    if(!result.ok && result.message.startsWith("REFUSE-INSECURE-YAML")) {
        // REQ-6: 진단 명령이므로 insecure 필드가 있어도 끝내지 않고 경고와 함께 보여 준다.
        io.err(`warning: ${result.message}`);
        result = resolveClientCliOptions({...cli, "yes-insecure": ""});
    }
    if(!result.ok) {
        io.err(result.message);
        return result.exitCode;
    }
    printNotices(result, io);
    const shown: {[key: string]: unknown} = {...result.saveOption};
    for(const name of INSECURE_FIELD_NAMES) shown[name] = result.option[name];
    const width = Math.max(...Object.keys(shown).map((key) => key.length + 2 + String(shown[key]).length), 20);
    for(const [key, value] of Object.entries(shown)) {
        if(value === undefined) continue;
        const text = SECRET_FIELDS.has(key) && value ? "(hidden)"
            : typeof value === "string" && value.includes("\n") ? "(PEM text)" : String(value);
        io.out(`${`${key}: ${text}`.padEnd(width)}  (${result.sources[key] ?? "default"})`);
    }
    return 0;
};

const saveClientConfig = (cli: {[key: string]: string}, io: ConfigIo): number => {
    const result = resolveClientCliOptions(cli);
    if(!result.ok) {
        io.err(result.message);
        return result.exitCode;
    }
    printNotices(result, io);
    const file = saveClientOptionFile(result.saveOption);
    io.out(`Saved ${file}`);
    return 0;
};

export {showClientConfig, saveClientConfig};
