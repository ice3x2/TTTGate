import {execFileSync} from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {newWorktreeChanges, readWorktreeStatus} from "../../setup/worktreeGuard";

// #264 — 테스트가 저장소 작업 트리를 바꿨는지 가리는 비교.
describe("worktree guard", () => {
    test("reports lines that appear or change during the run", () => {
        expect(newWorktreeChanges([], [" M reports/req-01-chi2.json", "?? config/identity.yaml"]))
            .toEqual([" M reports/req-01-chi2.json", "?? config/identity.yaml"]);
    });

    test("ignores changes that were already there before the run", () => {
        expect(newWorktreeChanges([" M src/app.ts"], [" M src/app.ts"])).toEqual([]);
    });

    test("reports a file whose state changed (modified to deleted)", () => {
        expect(newWorktreeChanges([" M src/app.ts"], [" D src/app.ts"])).toEqual([" D src/app.ts", "gone:  M src/app.ts"]);
    });

    // 지우거나 되돌려 사라진 줄도 작업 트리를 바꾼 것이다.
    test("reports lines that disappear during the run", () => {
        expect(newWorktreeChanges(["!! config/server.yaml 8:1", " M src/app.ts 3:2"], [" M src/app.ts 3:2"]))
            .toEqual(["gone: !! config/server.yaml 8:1"]);
    });
});

// 실제 저장소를 건드리지 않도록 임시 git 저장소에서 확인한다.
describe("worktree guard on a git repository", () => {
    let repo: string;
    let emptyConfig: string;
    // 개발 PC 의 전역 설정(서명, 훅 등)이 임시 저장소 커밋에 끼어들지 않게 한다.
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
        {cwd: repo, windowsHide: true, stdio: "pipe", env: {...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: "1"}});
    const write = (rel: string, text: string) => {
        fs.mkdirSync(path.dirname(path.join(repo, rel)), {recursive: true});
        fs.writeFileSync(path.join(repo, rel), text);
    };
    const changesWhile = (act: () => void): string[] => {
        const before = readWorktreeStatus(repo);
        expect(before).toBeDefined();
        act();
        return newWorktreeChanges(before!, readWorktreeStatus(repo)!);
    };

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-guard-"));
        emptyConfig = path.join(repo, "..", `${path.basename(repo)}.gitconfig`);
        fs.writeFileSync(emptyConfig, "");
        git("init", "-q");
        // git 기본값이다. 비ASCII 경로가 8진 이스케이프로 나와도 지문을 읽어야 한다.
        git("config", "core.quotePath", "true");
        write(".gitignore", "/config/*\n!/config/*.sample.yaml\n");
        write("config/server.sample.yaml", "sample: true\n");
        write("src/app.ts", "export {};\n");
        git("add", "-A");
        git("commit", "-q", "-m", "init");
    });

    afterEach(() => {
        fs.rmSync(repo, {recursive: true, force: true});
        fs.rmSync(emptyConfig, {force: true});
    });

    test("sees an ignored runtime config file created in the repository", () => {
        expect(changesWhile(() => write("config/identity.yaml", "probe: true\n")))
            .toEqual([expect.stringMatching(/^!! config\/identity\.yaml /)]);
    });

    test("sees an ignored config file that already existed being overwritten", () => {
        write("config/server.yaml", "port: 1\n");
        expect(changesWhile(() => write("config/server.yaml", "port: 22222\n")))
            .toEqual([expect.stringMatching(/^!! config\/server\.yaml /), expect.stringMatching(/^gone: !! config\/server\.yaml /)]);
    });

    test("sees a new file inside an ignored config folder that already existed", () => {
        write("config/cert/a.pem", "a\n");
        expect(changesWhile(() => write("config/cert/b.pem", "b\n")))
            .toEqual([expect.stringMatching(/^!! config\/cert\/b\.pem /)]);
    });

    test("sees an ignored config file being deleted", () => {
        write("config/server.yaml", "port: 1\n");
        expect(changesWhile(() => fs.rmSync(path.join(repo, "config", "server.yaml"))))
            .toEqual([expect.stringMatching(/^gone: !! config\/server\.yaml /)]);
    });

    test("sees an already modified file with a non-ASCII name being modified again", () => {
        write("docs/한글.md", "a\n");
        git("add", "-A");
        git("commit", "-q", "-m", "doc");
        write("docs/한글.md", "ab\n");
        expect(changesWhile(() => write("docs/한글.md", "abcdef\n")))
            .toEqual([expect.stringMatching(/^ M docs\/한글\.md \d+:/), expect.stringMatching(/^gone:  M docs\/한글\.md \d+:/)]);
    });

    test("sees a tracked file that was already modified being modified again", () => {
        write("src/app.ts", "export const a = 1;\n");
        expect(changesWhile(() => write("src/app.ts", "export const a = 12345;\n")))
            .toEqual([expect.stringMatching(/^ M src\/app\.ts /), expect.stringMatching(/^gone:  M src\/app\.ts /)]);
    });

    // 지문의 두 값이 각각 변경을 잡는지 본다. 하나는 그대로 두고 다른 하나만 바꾼다.
    test("sees an overwrite that keeps the modified time but changes the size", () => {
        write("config/server.yaml", "port: 1\n");
        const file = path.join(repo, "config", "server.yaml");
        // 파일 시스템의 ms 미만 정밀도는 되돌릴 수 없으므로 정수 초로 맞춰 둔다.
        const fixed = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
        fs.utimesSync(file, fixed, fixed);
        expect(changesWhile(() => {
            fs.writeFileSync(file, "port: 22222\n");
            fs.utimesSync(file, fixed, fixed);
        })).toEqual([expect.stringMatching(/^!! config\/server\.yaml /), expect.stringMatching(/^gone: !! config\/server\.yaml /)]);
    });

    test("sees an overwrite that keeps the size but changes the modified time", () => {
        write("config/server.yaml", "port: 1\n");
        const file = path.join(repo, "config", "server.yaml");
        const later = new Date(fs.statSync(file).mtimeMs + 60_000);
        expect(changesWhile(() => {
            fs.writeFileSync(file, "port: 2\n");
            fs.utimesSync(file, later, later);
        })).toEqual([expect.stringMatching(/^!! config\/server\.yaml /), expect.stringMatching(/^gone: !! config\/server\.yaml /)]);
    });

    test("reports nothing when the run leaves the tree as it was", () => {
        write("src/app.ts", "export const a = 1;\n");
        write("config/server.yaml", "port: 1\n");
        expect(changesWhile(() => undefined)).toEqual([]);
    });

    test("reads the repository from a subfolder", () => {
        fs.mkdirSync(path.join(repo, "src", "deep"), {recursive: true});
        const before = readWorktreeStatus(path.join(repo, "src", "deep"))!;
        write("config/identity.yaml", "probe: true\n");
        expect(newWorktreeChanges(before, readWorktreeStatus(path.join(repo, "src", "deep"))!))
            .toEqual([expect.stringMatching(/^!! config\/identity\.yaml /)]);
    });

    test("returns undefined outside a git repository", () => {
        const plain = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-plain-"));
        try {
            expect(readWorktreeStatus(plain)).toBeUndefined();
        } finally {
            fs.rmSync(plain, {recursive: true, force: true});
        }
    });
});
