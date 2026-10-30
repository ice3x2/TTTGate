import type {GlobalConfig} from "jest";
import {readWorktreeStatus, worktreeGuardDisabled} from "./worktreeGuard";

// #264: 실행 전 작업 트리 상태를 기록한다. 전역 teardown 이 비교한다(같은 부모 프로세스에서 돈다).
export default async function worktreeGuardSetup(globalConfig: GlobalConfig): Promise<void> {
    if(worktreeGuardDisabled()) return;
    const before = readWorktreeStatus(globalConfig.rootDir);
    if(!before) console.warn("[worktree guard] git status unavailable; the #264 working tree check is skipped.");
    (globalThis as any).__TTTGATE_WORKTREE_BEFORE__ = before;
}
