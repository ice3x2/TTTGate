import * as fs from "fs";
import * as Path from "path";
import Environment from "../Environment";
import LoggerFactory from "./logger/LoggerFactory";
import Logger from "./logger/Logger";

/**
 * 설정 오류로 끝내는 공통 함수(#207).
 *
 * -daemon 의 앱 자식은 stdio 를 버리므로 stderr 는 사라지고, 비동기 로그 스트림은 바로 process.exit 하면
 * 끝부분을 잃는다. 또 sentinel 은 앱의 종료 코드를 알 수 없어 무조건 다시 띄운다. 그래서 이 함수는
 * 이유를 로거와 stderr 에 남기고, 로그를 끝까지 쓴 뒤, 데몬 앱 자식이면 표시 파일을 남기고 끝낸다.
 * sentinel 은 표시 파일을 보고 다시 띄우지 않는다.
 */
const CONFIG_ERROR_MARKER = ".config_error";
const FLUSH_TIMEOUT_MS = 3000;

const configErrorMarkerPath = (): string => Path.join(Environment.path.binDir, CONFIG_ERROR_MARKER);

const hasConfigErrorMarker = (): boolean => fs.existsSync(configErrorMarkerPath());

const clearConfigErrorMarker = (): void => {
    try {
        fs.rmSync(configErrorMarkerPath(), {force: true});
    } catch { /* 지우지 못해도 boot 는 계속한다 */ }
};

const writeConfigErrorMarker = (code: number, message: string): void => {
    try {
        fs.mkdirSync(Environment.path.binDir, {recursive: true});
        fs.writeFileSync(configErrorMarkerPath(), `${code} ${message}\n`, {encoding: "utf-8"});
    } catch { /* 표시 파일을 못 쓰면 sentinel 이 다시 띄운다. 로그에는 이미 남았다. */ }
};

const exitWithConfigError = async (code: number, message: string, logger?: Logger): Promise<void> => {
    logger?.error(message);
    try { process.stderr.write(message + "\n"); } catch { /* stdio 가 닫혀 있을 수 있다 */ }
    process.exitCode = code;
    if(process.env.EXECUTE_MODE === "execute") {
        writeConfigErrorMarker(code, message);
    }
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
        LoggerFactory.flush(),
        new Promise<void>(resolve => { timer = setTimeout(resolve, FLUSH_TIMEOUT_MS); })
    ]);
    if(timer) clearTimeout(timer);
    process.exit(code);
};

export {exitWithConfigError, configErrorMarkerPath, hasConfigErrorMarker, clearConfigErrorMarker, CONFIG_ERROR_MARKER};
