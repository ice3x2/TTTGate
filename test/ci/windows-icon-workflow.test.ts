import * as fs from "fs";
import * as path from "path";
import {parse as parseYaml} from "yaml";

// #321: 실행 파일 아이콘은 Node 바이너리의 리소스 여유에 기댄다. pkg 나 아이콘을 바꾸는 PR 에서 미리 확인하도록,
// 그 파일이 바뀔 때 Windows 에서 win-x64 하나를 만들어 아이콘을 넣고 실행해 본다.
const root = path.resolve(__dirname, "../..");
const workflow = parseYaml(fs.readFileSync(path.join(root, ".github/workflows/windows-icon.yml"), "utf8"));
const WATCHED = ["package.json", "package-lock.json", "scripts/set-exe-icon.cjs", "admin/public/favicon.ico", ".github/workflows/windows-icon.yml"];

describe("Windows icon smoke workflow (#321)", () => {
    test("runs on pull requests and pushes that change the packaging or the icon", () => {
        expect(workflow.on.pull_request.paths).toEqual(WATCHED);
        expect(workflow.on.push.branches).toEqual(["main", "develop"]);
        expect(workflow.on.push.paths).toEqual(WATCHED);
    });

    test("builds both Windows binaries with the release pkg options, sets the icon and runs one on a Windows runner", () => {
        const job = workflow.jobs["windows-icon"];
        expect(job["runs-on"]).toBe("windows-latest");
        const runs: string[] = job.steps.filter((step: any) => step.run).map((step: any) => step.run.trim());
        // 릴리스와 같은 pkg 옵션을 쓰도록 npm run pkg 를 거친다. Windows 대상은 package.json 의 것과 같아야 한다.
        // 같은 플랫폼 대상만 주면 pkg 가 이름에서 win 을 빼므로(TTTGate-x64.exe), 대상마다 릴리스와 같은 이름을 준다.
        const windowsTargets: string[] = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).pkg.targets
            .filter((target: string) => target.includes("-win-")).sort();
        const pkgRuns = runs.filter((run) => run.startsWith("npm run pkg -- ")).sort();
        expect(pkgRuns).toEqual(windowsTargets.map((target) =>
            `npm run pkg -- --targets ${target} --output icon-smoke/TTTGate-${target.replace(/^node\d+-/, "")}.exe`));
        expect(runs).toContain(`node scripts/set-exe-icon.cjs icon-smoke ${windowsTargets.length}`);
        expect(runs).toContain("icon-smoke/TTTGate-win-x64.exe --version");
        expect(runs.some((run) => run.startsWith("npx pkg"))).toBe(false);
        expect(workflow.permissions).toEqual({contents: "read"});
    });

    test("caches the pkg base binaries and cancels superseded runs", () => {
        const cache = workflow.jobs["windows-icon"].steps.find((step: any) => String(step.uses ?? "").startsWith("actions/cache@"));
        expect(cache?.with?.path).toBe("~/.pkg-cache");
        expect(workflow.concurrency).toEqual({group: "windows-icon-${{ github.ref }}", "cancel-in-progress": true});
    });
});
