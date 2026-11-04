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

    test("builds one Windows binary, sets the icon and runs it on a Windows runner", () => {
        const job = workflow.jobs["windows-icon"];
        expect(job["runs-on"]).toBe("windows-latest");
        const runs: string[] = job.steps.filter((step: any) => step.run).map((step: any) => step.run.trim());
        expect(runs).toEqual([
            "npm ci --include=dev --no-audit --no-fund",
            "npm run build",
            "npx pkg . --targets node24-win-x64 --output icon-smoke/TTTGate-win-x64.exe",
            "node scripts/set-exe-icon.cjs icon-smoke 1",
            "icon-smoke/TTTGate-win-x64.exe --version",
        ]);
        expect(workflow.permissions).toEqual({contents: "read"});
    });
});
