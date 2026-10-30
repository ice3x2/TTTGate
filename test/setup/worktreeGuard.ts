import {execFileSync} from "child_process";
import fs from "fs";
import path from "path";

/**
 * 테스트가 저장소 작업 트리의 파일을 만들거나 바꾸지 않았는지 본다(#264).
 * 실행 전과 뒤의 `git status --porcelain` 을 비교해, 새로 나타나거나 상태가 바뀐 줄을 돌려준다.
 * 실행 중에 사라진 줄(지우거나 되돌린 파일)은 `gone: ` 을 붙여 함께 돌려준다.
 * 실행 전부터 있던 변경(개발 중인 수정)은 그대로 두고 문제 삼지 않는다.
 */
export const newWorktreeChanges = (before: string[], after: string[]): string[] => {
    const had = new Set(before);
    const has = new Set(after);
    return [...after.filter((line) => !had.has(line)),
        ...before.filter((line) => !has.has(line)).map((line) => `gone: ${line}`)];
};

// 상태 줄만으로는 이미 바뀐 파일을 다시 바꾼 경우를 가리지 못한다. 크기와 수정 시각을 붙인다.
const fingerprint = (file: string): string => {
    try {
        const stat = fs.statSync(file);
        return `${stat.size}:${stat.mtimeMs}`;
    } catch {
        return "missing";
    }
};

// 무시된 폴더는 `!! config/cert/` 처럼 한 줄로만 나온다. 안의 파일을 하나씩 펼친다.
// 읽는 사이에 폴더가 지워질 수 있다. 그때는 빈 폴더로 보고, 그 밖의 오류는 그대로 던진다.
const filesUnder = (dir: string): string[] => {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, {withFileTypes: true});
    } catch(error: any) {
        if(error.code === "ENOENT" || error.code === "ENOTDIR") return [];
        throw error;
    }
    return entries.flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? filesUnder(full) : [full];
    });
};

const withFingerprints = (root: string, line: string): string[] => {
    const status = line.slice(0, 2);
    const rel = line.slice(3).split(" -> ").pop()!.replace(/^"|"$/g, "");
    const full = path.join(root, rel);
    // 추적되지 않는 중첩 저장소(?? dir/)까지 훑지 않도록 무시된 config 폴더만 펼친다.
    if(status === "!!" && rel.endsWith("/")) {
        return filesUnder(full).map((file) =>
            `${status} ${path.relative(root, file).split(path.sep).join("/")} ${fingerprint(file)}`);
    }
    return [`${line} ${fingerprint(full)}`];
};

const gitLines = (args: string[], cwd: string): string[] =>
    // 비ASCII 경로가 8진 이스케이프로 나오지 않게 한다. 그래야 지문을 읽을 파일을 찾는다.
    execFileSync("git", ["-c", "core.quotePath=false", ...args], {cwd, encoding: "utf-8", windowsHide: true, stdio: "pipe"})
        .split(/\r?\n/).filter((line) => line.trim() !== "");

/** git 저장소가 아니거나 git 을 부를 수 없으면 undefined 다. 검사를 건너뛴다. 파일 읽기 오류는 그대로 던진다. */
export const readWorktreeStatus = (cwd: string): string[] | undefined => {
    let root: string;
    let lines: string[];
    try {
        // porcelain 경로는 저장소 최상위 기준이다. 하위 폴더에서 불러도 같은 곳을 보도록 최상위에서 읽는다.
        root = gitLines(["rev-parse", "--show-toplevel"], cwd)[0];
        // config/ 의 실행 파일은 .gitignore 로 무시하므로(#264) 무시된 항목(!!)도 따로 본다.
        // 테스트가 기본 루트(cwd)에 설정을 쓰면 여기서 드러난다.
        lines = [...gitLines(["status", "--porcelain", "--untracked-files=all"], root),
            ...gitLines(["status", "--porcelain", "--ignored=matching", "--untracked-files=all", "--", "config"], root)
                .filter((line) => line.startsWith("!!"))];
    } catch {
        return undefined;
    }
    return lines.flatMap((line) => withFingerprints(root, line));
};

/** 같은 작업 트리에서 jest 를 여러 개 동시에 돌리면 서로의 변경이 섞인다. 그때는 이 값으로 검사를 끈다. */
export const worktreeGuardDisabled = (): boolean => process.env.TTTGATE_SKIP_WORKTREE_GUARD === "1";
