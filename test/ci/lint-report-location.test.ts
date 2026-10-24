import {spawnSync} from "child_process";
import fs from "fs";
import path from "path";
import {newWorktreeChanges, readWorktreeStatus, worktreeGuardDisabled} from "../setup/worktreeGuard";

// #272 — npm run lint 는 저장소가 추적하는 파일을 바꾸지 않는다. 보고서는 무시되는 build/reports 에 쓴다.
jest.setTimeout(120_000);

const root = process.cwd();

test("npm run lint leaves the working tree untouched and writes its report to build/reports (AC-1·AC-2)", () => {
    // AC-1 의 기준은 npm run lint 다. package.json 의 명령을 그대로 쓴다(명령이 바뀌어 회귀해도 드러나게).
    const lint: string = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")).scripts.lint;
    const [command, ...args] = lint.split(/\s+/);
    expect(command).toBe("node");
    const report = path.join(root, "build", "reports", "auth-compare.json");
    // 줄마다 크기·수정 시각 지문이 붙는다. 이미 수정된 파일을 다시 써도 차이가 드러난다(#264).
    const before = readWorktreeStatus(root);
    expect(before).toBeDefined();
    const startedAt = Date.now() - 1_000;
    const run = spawnSync(process.execPath, args, {cwd: root, encoding: "utf-8", windowsHide: true, timeout: 60_000});
    expect({status: run.status, stderr: run.stderr}).toEqual({status: 0, stderr: expect.any(String)});
    // 같은 트리에서 jest 를 여러 개 돌려 검사를 끈 실행에서는 다른 실행의 변경이 섞이므로 비교하지 않는다.
    if(!worktreeGuardDisabled()) expect(newWorktreeChanges(before!, readWorktreeStatus(root)!)).toEqual([]);
    expect(fs.statSync(report).mtimeMs).toBeGreaterThanOrEqual(startedAt);
    const written = JSON.parse(fs.readFileSync(report, "utf-8"));
    expect(written.summary.scannedFiles).toBeGreaterThan(0);
    expect(Array.isArray(written.violations)).toBe(true);
});

test("build/reports is ignored by git", () => {
    expect(spawnSync("git", ["check-ignore", "-q", "--no-index", "build/reports/auth-compare.json"], {cwd: root}).status).toBe(0);
});
