/**
 * #207 테스트 전용 드라이버: 로그를 잔뜩 남긴 뒤 설정 오류로 끝낸다.
 * 사용: ts-node test/helpers/configExitDriver.ts <rootDir> <exitCode>
 */
import * as path from "path";
import Environment from "../../src/Environment";
import AppCompositionRoot from "../../src/bootstrap/AppCompositionRoot";
import LoggerFactory from "../../src/util/logger/LoggerFactory";
import {exitWithConfigError} from "../../src/util/ConfigExit";

Environment.configure({rootDir: path.resolve(process.argv[2])});
AppCompositionRoot.configureLogger();
const logger = LoggerFactory.getLogger("boot", "ConfigExitDriver");
for(let n = 0; n < 300; n++) logger.info(`filler-${n}`);
void exitWithConfigError(Number(process.argv[3]), "LAST-CONFIG-ERROR-LINE", logger);
