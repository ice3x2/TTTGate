import * as fs from "fs";
import * as Path from "path";
import {isIPv6} from "net";
import YAML from "yaml";
import {RunningProcess} from "./Sentinel";
import {readClientStatus, ClientConnectionState} from "./client/ClientStatusFile";
import {BOOTSTRAP_TOKEN_FILE_NAME} from "./server/rbac/IdentityMigration";
import {isFlagOn} from "./server/ServerCliOptions";

/**
 * TTTGate status [--json] (#322 REQ-13). 런처가 무엇이 도는지 알아보는 명령이다.
 * PID·로그 파일을 만들지 않는다. 종료 코드는 LSB 관례를 따른다: 0 실행 중, 3 실행 중이 아님.
 */
type StatusDeps = {findRunning: () => RunningProcess | undefined, binDir: string, configDir: string, version: string};

type ServerStatus = {adminUrl: string, bootstrapRequired: boolean, bootstrapTokenFile: string | null};
type ClientStatus = {state: ClientConnectionState, since: number, failures: number};
type DaemonStatus = {
    version: string, running: boolean, mode: RunningProcess["mode"], pid: number | null, daemon: boolean,
    client: ClientStatus | null, server: ServerStatus | null
};

const EXIT_RUNNING = 0;
const EXIT_NOT_RUNNING = 3;
/** server.yaml 이 없을 때 서버가 만드는 기본값과 같다(ServerOptionStore.makeDefaultOption). */
const DEFAULT_ADMIN = {port: 9300, tls: true};
const WILDCARD_HOSTS = new Set(["", "*", "0.0.0.0", "::"]);

const readServerYaml = (configDir: string): {[key: string]: unknown} | undefined => {
    const file = Path.join(configDir, "server.yaml");
    if(!fs.existsSync(file)) return undefined;
    let parsed: unknown;
    try {
        parsed = YAML.parse(fs.readFileSync(file, "utf-8"));
    } catch {
        return undefined;
    }
    return typeof parsed === "object" && parsed !== null ? parsed as {[key: string]: unknown} : undefined;
};

/** 이 PC 에서 관리 화면을 여는 주소. 모든 주소에 묶였으면 루프백으로 연다. */
const adminUrlOf = (yaml: {[key: string]: unknown} | undefined): string => {
    if(yaml === undefined) return `https://127.0.0.1:${DEFAULT_ADMIN.port}/`;
    const port = Number.isSafeInteger(yaml.adminPort) ? yaml.adminPort as number : DEFAULT_ADMIN.port;
    const tls = yaml.adminTls === true;
    const bind = typeof yaml.adminBindHost === "string" ? yaml.adminBindHost.trim() : "";
    const host = WILDCARD_HOSTS.has(bind) ? "127.0.0.1" : isIPv6(bind) ? `[${bind}]` : bind;
    return `${tls ? "https" : "http"}://${host}:${port}/`;
};

const serverStatusOf = (configDir: string): ServerStatus => {
    const tokenFile = Path.join(configDir, BOOTSTRAP_TOKEN_FILE_NAME);
    const bootstrapRequired = fs.existsSync(tokenFile);
    return {adminUrl: adminUrlOf(readServerYaml(configDir)), bootstrapRequired, bootstrapTokenFile: bootstrapRequired ? tokenFile : null};
};

const clientStatusOf = (binDir: string, pid: number): ClientStatus | null => {
    const status = readClientStatus(binDir);
    // 앞서 끝난 클라이언트가 남긴 파일은 지금 상태가 아니다.
    if(status === undefined || status.pid !== pid) return null;
    return {state: status.state, since: status.since, failures: status.failures};
};

const buildStatus = (deps: StatusDeps): DaemonStatus => {
    const running = deps.findRunning();
    if(running === undefined) {
        return {version: deps.version, running: false, mode: null, pid: null, daemon: false, client: null, server: null};
    }
    return {
        version: deps.version, running: true, mode: running.mode, pid: running.pid, daemon: running.daemon,
        client: running.mode === "client" ? clientStatusOf(deps.binDir, running.pid) : null,
        server: running.mode === "server" ? serverStatusOf(deps.configDir) : null
    };
};

const describeStatus = (status: DaemonStatus): string => {
    if(!status.running) return "TTTGate is not running";
    const name = status.mode === null ? "TTTGate" : `TTTGate ${status.mode}`;
    return `${name} is running${status.daemon ? " in the background" : ""} (pid ${status.pid})`;
};

const runStatus = (options: {[key: string]: string}, io: {out: (line: string) => void}, deps: StatusDeps): number => {
    const status = buildStatus(deps);
    io.out(isFlagOn(options, "json") ? JSON.stringify(status) : describeStatus(status));
    return status.running ? EXIT_RUNNING : EXIT_NOT_RUNNING;
};

export {buildStatus, runStatus, StatusDeps, DaemonStatus};
