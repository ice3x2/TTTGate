/**
 * P3-T3 테스트 전용 드라이버.
 *
 * 사용: `ts-node test/helpers/clientYamlGateDriver.ts <configDir> [--yes-insecure]`
 *   - `configDir`을 Environment.rootDir로 간주하도록 Environment.configure를 호출
 *     (rootDir/config/client.yaml을 로드)
 *   - `__testInternals.loadClientOption` 호출
 *   - 성공 시 exit 0, 실패(INSECURE YAML gate) 시 78
 *
 * Mock 없음 — 실 파일 시스템/실 process.exit.
 */
import Environment from "../../src/Environment";
import { __testInternals } from "../../src/client/ClientApp";
import * as path from "path";

function main() {
    const rootDir = process.argv[2];
    if(!rootDir) {
        process.stderr.write("usage: driver <rootDir> [--yes-insecure]\n");
        process.exit(2);
    }
    // rootDir 안에 이미 config/client.yaml이 존재한다고 가정.
    Environment.configure({ rootDir: path.resolve(rootDir) });

    const cliOptions: { [key: string]: string } = {};
    if(process.argv.includes("--yes-insecure")) {
        cliOptions["yes-insecure"] = "";
    }
    // 가이드: 실제 코드 경로를 타지만 TTTClient.start()는 부르지 않는다.
    const opt = __testInternals.loadClientOption(cliOptions);
    // yes-insecure 경로에서 여기까지 오면 YAML의 플래그가 normalize되어 있음.
    process.stdout.write(JSON.stringify({
        ok: true,
        allowInsecureTls: (opt as any).allowInsecureTls === true,
        allowLegacyFallback: (opt as any).allowLegacyFallback === true
    }));
    process.exit(0);
}

main();
