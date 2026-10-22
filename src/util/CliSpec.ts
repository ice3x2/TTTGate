/**
 * 명령줄 옵션 정의 표(#204). 파서·도움말·검증이 모두 이 표 하나를 본다.
 *
 * - kind: flag 는 값이 없거나 바로 뒤의 진릿값 하나를 받는다. string·number 는 다음 토큰을 값으로 받는다.
 * - modes: 이 옵션을 받는 모드. 목록에 없는 모드에서 쓰면 오류다.
 * - exactToken: `-name` 그대로만 받는다. `--name`·`-name=값`·뒤의 값은 받지 않는다.
 *   (`-daemon`·`-dev` 는 Sentinel·Environment 가 process.argv 를 그대로 비교해서 판정하기 때문이다)
 * - aliasOf: 대표 옵션의 별칭. 도움말에서는 대표 옵션 옆에만 적는다.
 * - risk: 위험·레거시 옵션. 일반 도움말에서 빼고 --help-advanced 에만 위험 설명과 함께 보인다.
 */
type CliMode = "server" | "client" | "stop" | "none";
type CliValueKind = "flag" | "string" | "number";
type CliGroup = "connection" | "identity" | "tls" | "run" | "tuning" | "admin" | "proxy" | "help";

type CliOptionDef = {
    name: string;
    kind: CliValueKind;
    modes: ReadonlyArray<CliMode>;
    group: CliGroup;
    help: string;
    valueName?: string;
    hidden?: boolean;
    aliasOf?: string;
    risk?: string;
    exactToken?: boolean;
    /**
     * 이 옵션을 받는 하위 명령(#215). 공백으로 이은 경로이고 ''는 하위 명령 없음이다.
     * 없으면 실행·설정 계열('', run, config show, config save)에서 받는다. 도움말 옵션과 -dev 는 어디서나 받는다.
     */
    commands?: ReadonlyArray<string>;
};

const RUN_FAMILY_COMMANDS: ReadonlyArray<string> = ["", "run", "config show", "config save"];

/** 옵션을 이 하위 명령에서 받는지. */
const optionAllowedInCommand = (def: CliOptionDef, command: string): boolean => {
    if(def.group === "help" || def.name === "dev") return true;
    return (def.commands ?? RUN_FAMILY_COMMANDS).includes(command);
};

const ALL_MODES: ReadonlyArray<CliMode> = ["server", "client", "stop", "none"];
const RUN_MODES: ReadonlyArray<CliMode> = ["server", "client", "stop"];

const CLI_OPTIONS: ReadonlyArray<CliOptionDef> = [
    // 도움말·버전(#208)
    {name: "h", kind: "flag", modes: ALL_MODES, group: "help", help: "Show help", aliasOf: "help"},
    {name: "help", kind: "flag", modes: ALL_MODES, group: "help", help: "Show help"},
    {name: "help-advanced", kind: "flag", modes: ALL_MODES, group: "help", help: "Show help with legacy and risky options"},
    {name: "version", kind: "flag", modes: ALL_MODES, group: "help", help: "Print the version"},

    // 공통
    {name: "daemon", kind: "flag", modes: ["server", "client"], group: "run", exactToken: true, commands: ["", "run"],
        help: "Run in the background with process monitoring"},
    {name: "dev", kind: "flag", modes: RUN_MODES, group: "run", exactToken: true, hidden: true,
        help: "Development mode (paths relative to the source tree)"},

    // 서버
    {name: "adminPort", kind: "number", modes: ["server"], group: "admin", valueName: "port", help: "Admin server port"},
    {name: "keepAlive", kind: "number", modes: ["server", "client"], group: "tuning", valueName: "ms",
        help: "Control connection TCP keepalive interval"},
    {name: "trustXForwardedFor", kind: "flag", modes: ["server"], group: "proxy",
        help: "Read the admin client address from X-Forwarded-For (behind your own proxy)"},
    {name: "trustedProxyHops", kind: "number", modes: ["server"], group: "proxy", valueName: "n",
        help: "Trusted proxies in front of the admin server (default 1)"},
    {name: "reset", kind: "flag", modes: ["server"], group: "run", help: "Reset persisted server state"},
    {name: "allowLegacyAdminHttp", kind: "flag", modes: ["server"], group: "admin",
        help: "Allow legacy admin HTTP for one process run",
        risk: "the admin console and its session cookies travel in plain text"},
    {name: "allowLegacyAdminRemote", kind: "flag", modes: ["server"], group: "admin",
        help: "Allow legacy non-loopback admin bind for one process run",
        risk: "the admin console is reachable from other hosts"},
    {name: "allowLegacyControlAuth", kind: "flag", modes: ["server"], group: "identity",
        help: "Allow legacy shared-key control authentication",
        risk: "legacy data connections can be hijacked by a guessed handler ID"},
    {name: "requireCsrfHeader", kind: "flag", modes: ["server"], group: "admin",
        help: "Require the admin CSRF header (default true; 'false' turns the check off)",
        risk: "'-requireCsrfHeader false' turns off CSRF protection of the admin API"},

    // 클라이언트
    {name: "addr", kind: "string", modes: ["client"], group: "connection", valueName: "host:port",
        help: "Server address. The port is optional. tls:// or tcp:// selects the transport"},
    {name: "tls", kind: "flag", modes: ["client"], group: "connection", help: "Use TLS on the control connection"},
    {name: "clientId", kind: "string", modes: ["client"], group: "identity", valueName: "id",
        help: "Protocol v2 client identifier"},
    {name: "clientSecret", kind: "string", modes: ["client"], group: "identity", valueName: "secret",
        help: "Protocol v2 shared secret. Prefer TTTGATE_CLIENT_SECRET or -clientSecretFile: command lines are visible to other users"},
    {name: "clientSecretFile", kind: "string", modes: ["client"], group: "identity", valueName: "path",
        help: "Read the protocol v2 shared secret from a file"},
    {name: "name", kind: "string", modes: ["client"], group: "identity", valueName: "name",
        help: "Client name for legacy connections and local logs (a v2 server shows its registered name)"},
    {name: "displayName", kind: "string", modes: ["client"], group: "identity", valueName: "name",
        aliasOf: "name", help: "Deprecated alias of -name"},
    {name: "ca", kind: "string", modes: ["client"], group: "tls", valueName: "path|pem",
        help: "Trusted CA or server certificate (file path or PEM text). Turns TLS on"},
    {name: "serverName", kind: "string", modes: ["client"], group: "tls", valueName: "name",
        help: "Expected TLS server name. Turns TLS on"},
    {name: "cert", kind: "string", modes: ["client"], group: "tls", valueName: "path|pem",
        help: "Client certificate for mutual TLS (file path or PEM text). Turns TLS on"},
    {name: "privateKey", kind: "string", modes: ["client"], group: "tls", valueName: "path|pem",
        help: "Private key of -cert (file path or PEM text). Turns TLS on"},
    {name: "save", kind: "flag", modes: ["client"], group: "run", commands: ["", "run"], help: "Save the resolved options to config/client.yaml"},
    // client join(#214)
    {name: "code", kind: "string", modes: ["client"], group: "run", valueName: "code", commands: ["join"],
        help: "Enrollment code from the admin console (client join)"},
    {name: "force", kind: "flag", modes: ["client"], group: "run", commands: ["join"],
        help: "Replace an existing config/client.yaml (the old file is kept as client.yaml.bak)"},
    {name: "bufferLimit", kind: "number", modes: ["client"], group: "tuning", valueName: "MiB",
        help: "Memory buffer limit: -1 (no limit) or 16..1048576"},
    {name: "key", kind: "string", modes: ["client"], group: "identity", valueName: "key",
        help: "Legacy shared key (legacy control auth only)",
        risk: "the key is sent to any server that answers with the legacy protocol"},
    {name: "allowLegacyFallback", kind: "flag", modes: ["client"], group: "identity",
        help: "Allow legacy v1 fallback during rollback",
        risk: "a fake server can downgrade and receive the shared key"},
    {name: "allowInsecureTls", kind: "flag", modes: ["client"], group: "tls",
        help: "Disable TLS certificate verification",
        risk: "anyone on the network path can impersonate the server"},
    {name: "yes-insecure", kind: "flag", modes: ["client"], group: "run",
        help: "Accept insecure fields stored in client.yaml for this run",
        risk: "keeps TLS verification off or legacy fallback on as written in client.yaml"},
    {name: "yesInsecure", kind: "flag", modes: ["client"], group: "run", aliasOf: "yes-insecure", help: "Alias of --yes-insecure"}
];

const OPTIONS_BY_NAME = new Map<string, CliOptionDef>(CLI_OPTIONS.map(def => [def.name, def]));

const findCliOption = (name: string): CliOptionDef | undefined => OPTIONS_BY_NAME.get(name);

/** 대소문자를 무시한 편집 거리. 제안 후보를 고를 때만 쓴다. */
const editDistance = (a: string, b: string): number => {
    const s = a.toLowerCase();
    const t = b.toLowerCase();
    const row = Array.from({length: t.length + 1}, (_, i) => i);
    for(let i = 1; i <= s.length; i++) {
        let diagonal = row[0];
        row[0] = i;
        for(let j = 1; j <= t.length; j++) {
            const above = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (s[i - 1] === t[j - 1] ? 0 : 1));
            diagonal = above;
        }
    }
    return row[t.length];
};

/** 편집 거리 2 이하(대소문자 무시)인 가장 가까운 옵션 이름. */
const suggestCliOption = (name: string, mode: CliMode): string | undefined => {
    let best: {name: string, distance: number} | undefined;
    for(const def of CLI_OPTIONS) {
        if(def.hidden || (mode !== "none" && !def.modes.includes(mode))) continue;
        const distance = editDistance(name, def.name);
        if(distance <= 2 && (!best || distance < best.distance)) best = {name: def.name, distance};
    }
    return best?.name;
};

export {CLI_OPTIONS, CliOptionDef, CliMode, CliValueKind, CliGroup, findCliOption, suggestCliOption, editDistance, optionAllowedInCommand};
