import * as fs from "fs";
import * as Path from "path";
import YAML from "yaml";
import {parseServerAddress, formatServerAddress} from "../util/AddressParser";
import {normalizeEnrollmentCode} from "../commons/Enrollment";
import {DEFAULT_CLIENT_PORT} from "../types/TunnelingOption";
import {requestEnrollment} from "./ClientEnrollment";
import {CLIENT_OPTION_FILE_NAME} from "./ClientOptionResolver";
import {isFlagOn} from "../server/ServerCliOptions";

/**
 * TTTGate client join <addr> --code <code> [--force] (#214).
 * 서버에서 받은 값으로 config/client.yaml 과 CA 파일을 쓰고 끝난다. 연결을 유지하거나 터널을 열지 않는다.
 *
 * 종료 코드: 0 성공, 1 서버가 거부·증명 실패·네트워크, 2 명령줄 오류, 78 로컬 파일(기존 파일·쓰기 실패).
 */
const SERVER_CA_FILE_NAME = "server-ca.pem";

type JoinIo = {configDir: string, out: (line: string) => void, err: (line: string) => void};

/** 권한을 0600 으로 맞춘다. chmod 를 지원하지 않는 파일 시스템(CIFS 등)에서는 경고만 남긴다. */
const restrictToOwner = (file: string, io: JoinIo): void => {
    if(process.platform === "win32") return;
    try {
        fs.chmodSync(file, 0o600);
    } catch (e) {
        io.err(`warning: cannot restrict ${file} to 0600 (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}). It holds the client secret.`);
    }
};

const runClientJoin = async (addr: string, options: {[key: string]: string}, io: JoinIo): Promise<number> => {
    const parsed = parseServerAddress(addr ?? "");
    if(!parsed.ok) {
        io.err(parsed.message);
        return 2;
    }
    if(parsed.scheme === "tcp") {
        io.err("client join needs TLS on the server control port; tcp:// cannot be used");
        return 2;
    }
    const code = options["code"];
    if(code === undefined || code.length === 0) {
        io.err("client join needs --code <code> from the admin console");
        return 2;
    }
    if(!normalizeEnrollmentCode(code)) {
        io.err("the enrollment code must have 12 letters or digits, for example 7Q4K-M2XP-AB01");
        return 2;
    }
    const yamlFile = Path.join(io.configDir, CLIENT_OPTION_FILE_NAME);
    const force = isFlagOn(options, "force");
    if(fs.existsSync(yamlFile) && !force) {
        io.err(`${yamlFile} already exists. Run again with --force to replace it (the old file is kept as ${CLIENT_OPTION_FILE_NAME}.bak).`);
        return 78;
    }

    const host = parsed.host;
    const port = parsed.port ?? DEFAULT_CLIENT_PORT;
    const result = await requestEnrollment({host, port, code});
    if(!result.ok) {
        io.err(`enrollment failed: ${result.message}`);
        return 1;
    }

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
        io.err(`cannot write the client settings in ${io.configDir}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
        return 78;
    }

    io.out(`Enrolled as '${payload.clientId}' with ${formatServerAddress(host, port)}.`);
    io.out(`Saved ${yamlFile}`);
    io.out(`Saved ${caFile}`);
    io.out("Start the client with: TTTGate client   (or TTTGate client -daemon to run in the background)");
    return 0;
};

export {runClientJoin, SERVER_CA_FILE_NAME};
