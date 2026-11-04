import ServerOptionStore from "./ServerOptionStore";
import {isLoopbackAdminHost, LEGACY_ADMIN_REMOTE_FLAG} from "./AdminSecurityPolicy";
import {isFlagOn, normalizeBooleanOption} from "./ServerCliOptions";
import {ControlProtocolMode, ServerOption} from "../types/TunnelingOption";

/**
 * TTTGate server config save (#322 REQ-17). 런처가 서버를 띄우기 전에 고른 값을 server.yaml 에 쓴다.
 * 검사는 관리 화면의 저장과 같은 경로(ServerOptionStore)를 탄다. 실행 중인 서버가 있으면 쓰지 않는다:
 * 실행 중인 서버도 같은 파일을 쓰므로 한쪽의 변경을 잃는다.
 *
 * 종료 코드: 0 저장, 1 값 오류, 75 서버 실행 중(EX_TEMPFAIL), 77 원격 관리 화면에 확인 필요(EX_NOPERM).
 * 런처는 77 을 받으면 사용자에게 위험을 알리고, 확인을 받으면 -allowLegacyAdminRemote 를 붙여 다시 부른다.
 */
type ConfigIo = {out: (line: string) => void, err: (line: string) => void};
type SaveDeps = {isServerRunning: () => boolean};

const EXIT_SAVED = 0;
const EXIT_INVALID = 1;
const EXIT_SERVER_RUNNING = 75;
const EXIT_REMOTE_ADMIN_NEEDS_CONSENT = 77;
const PROTOCOL_MODES: ReadonlyArray<ControlProtocolMode> = ["legacy", "mixed", "mtls-strict"];

type Applied = {ok: true} | {ok: false, message: string};

const parsePort = (name: string, value: string): number | string => {
    const port = Number(value);
    return Number.isSafeInteger(port) && port >= 1 && port <= 65535 ? port : `-${name} must be a port number (1 ~ 65535)`;
};

/** 명령줄에 있는 값만 옵션에 넣는다. 없는 값은 server.yaml 의 값을 그대로 둔다. */
const applyCliValues = (option: ServerOption, cli: {[key: string]: string}): Applied => {
    for(const [name, apply] of [
        ["adminPort", (port: number) => { option.adminPort = port; }],
        ["controlPort", (port: number) => { option.port = port; }]
    ] as Array<[string, (port: number) => void]>) {
        if(cli[name] === undefined) continue;
        const port = parsePort(name, cli[name]);
        if(typeof port === "string") return {ok: false, message: port};
        apply(port);
    }
    if(cli.adminBindHost !== undefined) option.adminBindHost = cli.adminBindHost.trim();
    if(cli.adminAllowedOrigins !== undefined) {
        option.adminAllowedOrigins = cli.adminAllowedOrigins.split(",").map((origin) => origin.trim()).filter((origin) => origin !== "");
    }
    if(cli.controlTls !== undefined) option.tls = normalizeBooleanOption(cli.controlTls) === true;
    if(cli.controlProtocolMode !== undefined) {
        const mode = cli.controlProtocolMode.trim() as ControlProtocolMode;
        if(!PROTOCOL_MODES.includes(mode)) return {ok: false, message: `-controlProtocolMode must be one of ${PROTOCOL_MODES.join(", ")}`};
        option.controlProtocolMode = mode;
    }
    return {ok: true};
};

const saveServerConfig = (cli: {[key: string]: string}, io: ConfigIo, deps: SaveDeps): number => {
    if(deps.isServerRunning()) {
        io.err("TTTGate is running. Stop it first (TTTGate stop), then save the settings.");
        return EXIT_SERVER_RUNNING;
    }
    const store = ServerOptionStore.instance;
    if(!store.loadStatus.ready) {
        io.err(`cannot read ${store.configFilePath}. Fix or remove the file, then try again.`);
        return EXIT_INVALID;
    }
    const option = store.serverOption;
    const applied = applyCliValues(option, cli);
    if(!applied.ok) {
        io.err(applied.message);
        return EXIT_INVALID;
    }
    const prepared = store.prepareServerOption(option);
    if(!prepared.success) {
        io.err(prepared.message);
        return EXIT_INVALID;
    }
    // 관리 화면을 다른 PC 에 여는 것은 사용자가 위험을 알고 고른 경우에만 저장한다(#322 REQ-5).
    if(!isLoopbackAdminHost(prepared.serverOption!.adminBindHost) && !isFlagOn(cli, LEGACY_ADMIN_REMOTE_FLAG)) {
        io.err(`the admin console would be reachable from other hosts (${prepared.serverOption!.adminBindHost ?? "*"}). ` +
            `Add -${LEGACY_ADMIN_REMOTE_FLAG} to save it, and start the server with the same option.`);
        return EXIT_REMOTE_ADMIN_NEEDS_CONSENT;
    }
    const committed = store.commitPreparedServerOption(option);
    if(!committed.success) {
        io.err(committed.message);
        return EXIT_INVALID;
    }
    io.out(`Saved ${store.configFilePath}`);
    return EXIT_SAVED;
};

export {saveServerConfig, EXIT_SERVER_RUNNING, EXIT_REMOTE_ADMIN_NEEDS_CONSENT};
