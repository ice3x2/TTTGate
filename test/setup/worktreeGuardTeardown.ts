import type {GlobalConfig} from "jest";
import {newWorktreeChanges, readWorktreeStatus, worktreeGuardDisabled} from "./worktreeGuard";

// #264: 테스트가 저장소 작업 트리에 파일을 만들거나 바꿨으면 실행을 실패로 끝낸다.
export default async function worktreeGuardTeardown(globalConfig: GlobalConfig): Promise<void> {
    if(worktreeGuardDisabled()) return;
    const before: string[] | undefined = (globalThis as any).__TTTGATE_WORKTREE_BEFORE__;
    if(!before) return;
    const after = readWorktreeStatus(globalConfig.rootDir);
    // 실행 전에는 읽었는데 뒤에 못 읽으면 검사가 조용히 꺼진 것이다. 통과로 두지 않는다.
    if(!after) throw new Error("[worktree guard] git status failed after the run; the #264 working tree check could not finish.");
    const changes = newWorktreeChanges(before, after);
    if(changes.length === 0) return;
    const message = "Tests created or changed files in the repository working tree (#264). " +
        "Write test output to a temporary or ignored folder. If you edited files or ran the app in this tree during the run, " +
        "rerun, or set TTTGATE_SKIP_WORKTREE_GUARD=1 for that run:\n" + changes.join("\n");
    // watch 모드에서는 실행 중에 개발자가 저장한 파일도 섞이므로 실패 대신 경고만 낸다.
    if(globalConfig.watch || globalConfig.watchAll) {
        console.warn(message);
        return;
    }
    throw new Error(message);
}
