import * as fs from "fs";
import * as Path from "path";
import YAML from "yaml";
import {parseServerAddress, formatServerAddress} from "../util/AddressParser";
import {normalizeEnrollmentCode} from "../commons/Enrollment";
import {DEFAULT_CLIENT_PORT} from "../types/TunnelingOption";
import {EnrollmentFailureCategory, requestEnrollment} from "./ClientEnrollment";
import {CLIENT_OPTION_FILE_NAME} from "./ClientOptionResolver";
import {isFlagOn} from "../server/ServerCliOptions";

/**
 * TTTGate client join <addr> --code <code> [--force] (#214).
 * 서버에서 받은 값으로 config/client.yaml 과 CA 파일을 쓰고 끝난다. 연결을 유지하거나 터널을 열지 않는다.
 *
 * 종료 코드: 0 성공, 1 서버가 거부·증명 실패·네트워크, 2 명령줄 오류, 78 로컬 파일(기존 파일·쓰기 실패).
 */
const SERVER_CA_FILE_NAME = "server-ca.pem";

/** readInput 은 --code-stdin 일 때 입력 전체를 돌려준다. 없으면 표준 입력을 읽는다. */
type JoinIo = {configDir: string, out: (line: string) => void, err: (line: string) => void, readInput?: () => string};

const readStandardInput = (): string => fs.readFileSync(0, "utf-8");

/** 권한을 0600 으로 맞춘다. chmod 를 지원하지 않는 파일 시스템(CIFS 등)에서는 경고만 남긴다. */
const restrictToOwner = (file: string, io: JoinIo): void => {
    if(process.platform === "win32") return;
    try {
        fs.chmodSync(file, 0o600);
    } catch (e) {
        io.err(`warning: cannot restrict ${file} to 0600 (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}). It holds the client secret.`);
    }
};

/** 런처가 읽는 실패 종류(#322 REQ-16). 문장은 바뀔 수 있지만 이 값은 바뀌지 않는다. */
type JoinFailureCategory = "argument" | "exists" | "write" | EnrollmentFailureCategory;
type JoinResult = {ok: true, clientId: string, server: string, files: string[]}
    | {ok: false, category: JoinFailureCategory, message: string};

const EXIT_CODE_OF: {[category in JoinFailureCategory]: number} = {
    argument: 2, exists: 78, write: 78, rejected: 1, proof: 1, network: 1, throttled: 1, unavailable: 1
};

const enroll = async (addr: string, options: {[key: string]: string}, io: JoinIo): Promise<JoinResult> => {
    const parsed = parseServerAddress(addr ?? "");
    if(!parsed.ok) return {ok: false, category: "argument", message: parsed.message};
    if(parsed.scheme === "tcp") return {ok: false, category: "argument", message: "client join needs TLS on the server control port; tcp:// cannot be used"};
    const fromInput = isFlagOn(options, "code-stdin");
    if(fromInput && options["code"] !== undefined) return {ok: false, category: "argument", message: "use either --code or --code-stdin, not both"};
    // #322 REQ-2: --code-stdin 은 코드를 명령줄에 두지 않는다(프로세스 목록·프로세스 생성 감사 로그에 남지 않는다). 첫 줄만 쓴다.
    const code = fromInput ? ((io.readInput ?? readStandardInput)().split(/\r?\n/)[0] ?? "").trim() : options["code"];
    if(code === undefined || code.length === 0) {
        return {ok: false, category: "argument", message: "client join needs --code <code> (or --code-stdin) from the admin console"};
    }
    if(!normalizeEnrollmentCode(code)) {
        return {ok: false, category: "argument", message: "the enrollment code must have 12 letters or digits, for example 7Q4K-M2XP-AB01"};
    }
    const yamlFile = Path.join(io.configDir, CLIENT_OPTION_FILE_NAME);
    if(fs.existsSync(yamlFile) && !isFlagOn(options, "force")) {
        return {ok: false, category: "exists",
            message: `${yamlFile} already exists. Run again with --force to replace it (the old file is kept as ${CLIENT_OPTION_FILE_NAME}.bak).`};
    }

    const host = parsed.host;
    const port = parsed.port ?? DEFAULT_CLIENT_PORT;
    const result = await requestEnrollment({host, port, code});
    if(!result.ok) return {ok: false, category: result.category, message: `enrollment failed: ${result.message}`};

    const payload = result.payload;
    const caFile = Path.join(io.configDir, SERVER_CA_FILE_NAME);
    try {
        fs.mkdirSync(io.configDir, {recursive: true});
        if(fs.existsSync(yamlFile)) {
            const backup = `${yamlFile}.bak`;
            fs.copyFileSync(yamlFile, backup);
            restrictToOwner(backup, io);
        }
        fs.writeFileSync(caFile, payload.ca, {encoding: "utf-8", mode: 0o644});
        const clientYaml = {
            host, port, tls: true,
            name: payload.clientId,
            clientId: payload.clientId,
            clientSecret: payload.clientSecret,
            serverName: payload.serverName,
            // configDir 기준 상대 경로(#201): 설정 디렉터리를 옮겨도 그대로 맞는다.
            ca: SERVER_CA_FILE_NAME
        };
        fs.writeFileSync(yamlFile, YAML.stringify(clientYaml), {encoding: "utf-8", mode: 0o600});
        restrictToOwner(yamlFile, io);
    } catch (e) {
        return {ok: false, category: "write",
            message: `cannot write the client settings in ${io.configDir}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`};
    }
    return {ok: true, clientId: payload.clientId, server: formatServerAddress(host, port), files: [yamlFile, caFile]};
};

/**
 * --json(#322 REQ-16)이면 stdout 에 결과 JSON 한 줄만 쓴다. 경고는 그대로 stderr 로 간다.
 * 어느 출력에도 등록 코드를 넣지 않는다.
 */
const runClientJoin = async (addr: string, options: {[key: string]: string}, io: JoinIo): Promise<number> => {
    const result = await enroll(addr, options, io);
    if(isFlagOn(options, "json")) {
        io.out(JSON.stringify(result.ok ? {ok: true, clientId: result.clientId, server: result.server}
            : {ok: false, category: result.category, message: result.message}));
    } else if(result.ok) {
        io.out(`Enrolled as '${result.clientId}' with ${result.server}.`);
        for(const file of result.files) io.out(`Saved ${file}`);
        io.out("Start the client with: TTTGate client   (or TTTGate client -daemon to run in the background)");
    } else {
        io.err(result.message);
    }
    return result.ok ? 0 : EXIT_CODE_OF[result.category];
};

export {runClientJoin, SERVER_CA_FILE_NAME};
