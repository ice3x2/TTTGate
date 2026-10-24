import type {GlobalConfig} from "jest";
import worktreeGuardSetup from "./worktreeGuardSetup";

// jest 전역 setup. 워커는 이 뒤에 만들어지므로 여기서 넣은 환경 변수를 물려받는다.
export default async function globalSetup(globalConfig: GlobalConfig): Promise<void> {
    // getFreePort 가 워커마다 다른 포트 범위를 쓰도록 워커 수를 넘긴다(#262).
    process.env.TTTGATE_JEST_WORKERS = String(globalConfig.maxWorkers);
    process.env.TTTGATE_JEST_PORT_SHIFT = String(Math.floor(Math.random() * globalConfig.maxWorkers));
    await worktreeGuardSetup(globalConfig);
}
