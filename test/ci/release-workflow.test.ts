import * as fs from "fs";
import * as path from "path";
import {parse as parseYaml} from "yaml";

// #290 — 태그를 올리면 릴리스 빌드가 자동으로 돌고 끝까지 간다.
const root = path.resolve(__dirname, "../..");
const directory = path.join(root, ".github/workflows");
const workflowPath = path.join(directory, "release.yml");
const read = () => parseYaml(fs.readFileSync(workflowPath, "utf8"));
const platforms = ["linux-x64.tar.gz", "linux-arm64.tar.gz", "win-x64.zip", "win-arm64.zip", "alpine-x64.tar.gz"];

describe("release workflow (#290)", () => {
    test("is the only release workflow (REQ-2, AC-1)", () => {
        const files = fs.readdirSync(directory).filter((name) => /\.ya?ml$/.test(name) && /release/.test(name));
        expect(files).toEqual(["release.yml"]);
    });

    test("runs on a version tag push and on manual dispatch without inputs (REQ-1, AC-1)", () => {
        const workflow = read();
        expect(Object.keys(workflow.on).sort()).toEqual(["push", "workflow_dispatch"]);
        expect(workflow.on.push).toEqual({tags: ["[0-9]+.[0-9]+.[0-9]+*"]});
        // 수동 실행은 버전 태그를 골라 돈다. 입력을 받지 않으므로 태그와 다른 버전을 넣을 수 없다.
        expect(workflow.on.workflow_dispatch ?? {}).toEqual({});
    });

    test("grants write access only to the job that creates the release (REQ-3, AC-1)", () => {
        const workflow = read();
        expect(workflow.permissions).toEqual({contents: "read"});
        expect(workflow.jobs.tag.permissions).toEqual({contents: "read"});
        expect(workflow.jobs.regression.permissions).toEqual({contents: "read"});
        expect(workflow.jobs["supply-chain"].permissions).toEqual({contents: "read"});
        expect(workflow.jobs.release.permissions).toEqual({contents: "write"});
    });

    // 태그 확인을 테스트보다 먼저 한다. 브랜치에서 잘못 실행하면 테스트(20~50분)를 기다리지 않고 바로 멈춘다.
    test("checks the tag first, then reuses Code Regression, and packages only after tag, regression and supply-chain all pass (REQ-4, REQ-6, AC-2)", () => {
        const workflow = read();
        expect(Object.keys(workflow.jobs)).toEqual(["tag", "regression", "supply-chain", "release"]);
        const tagRuns = workflow.jobs.tag.steps.filter((step: any) => step.run).map((step: any) => step.run.trim());
        expect(tagRuns).toEqual(['node scripts/validate-release-version.cjs "$RELEASE_VERSION" --match-package']);
        expect(workflow.jobs.tag.env.RELEASE_VERSION).toBe("${{ github.ref_name }}");
        expect(workflow.jobs.regression.needs).toEqual(["tag"]);
        expect(workflow.jobs.regression.uses).toBe("./.github/workflows/code-regression.yml");
        expect(workflow.jobs.release.needs).toEqual(["tag", "regression", "supply-chain"]);
        expect(workflow.jobs.release.if).toBeUndefined();
        const regression = parseYaml(fs.readFileSync(path.join(directory, "code-regression.yml"), "utf8"));
        expect(regression.on.workflow_call).toEqual({});
    });

    // #293: 알려진 HIGH 권고가 든 채로 릴리스가 나가지 않게, 패키징 전에 온라인 공급망 감사를 돌린다.
    test("runs the online supply-chain audit before packaging (#293 REQ-5, AC-4)", () => {
        const workflow = read();
        const job = workflow.jobs["supply-chain"];
        expect(job.uses).toBe("./.github/workflows/supply-chain-audit.yml");
        expect(job.needs).toEqual(["tag"]);
        const audit = parseYaml(fs.readFileSync(path.join(directory, "supply-chain-audit.yml"), "utf8"));
        expect(audit.on.workflow_call).toEqual({});
        // 불린 워크플로의 github 문맥은 부른 쪽 것이다. 태그 push 로 불렸을 때 온라인 감사가 건너뛰어지면 안 된다.
        for(const name of ["audit-runtime", "audit-admin"]) {
            expect(audit.jobs[name].if).toBe("github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/')");
        }
    });

    test("validates the tag against package.json, packages without re-running tests and archives everything (REQ-5, REQ-6)", () => {
        const job = read().jobs.release;
        expect(job["runs-on"]).toBe("ubuntu-latest");
        expect(job["timeout-minutes"]).toBeLessThanOrEqual(60);
        expect(job.env.RELEASE_VERSION).toBe("${{ github.ref_name }}");
        const runs: string[] = job.steps.filter((step: any) => step.run).map((step: any) => step.run.trim());
        expect(runs).toEqual([
            "npm run dist -- --skip-tests",
            'node scripts/archive-source.cjs "$RELEASE_VERSION"',
            'node scripts/archive-binaries.cjs "$RELEASE_VERSION"',
            'node scripts/release-notes.cjs "$RELEASE_VERSION" "$GITHUB_SHA" > release_notes.md',
        ]);
        // 태그 이름은 셸에 식으로 끼워 넣지 않는다(환경 변수로만 읽는다).
        for(const run of runs) expect(run).not.toContain("${{");
        for(const step of job.steps) {
            expect(step["continue-on-error"]).toBeUndefined();
            expect(step.if).toBeUndefined();
        }
    });

    test("creates a draft release with all seven files and generated notes (REQ-2, REQ-7)", () => {
        const job = read().jobs.release;
        const release = job.steps.find((step: any) => step.uses?.startsWith("softprops/action-gh-release@"));
        expect(release.with.tag_name).toBe("${{ github.ref_name }}");
        expect(release.with.draft).toBe(true);
        expect(release.with.fail_on_unmatched_files).toBe(true);
        expect(release.with.generate_release_notes).toBe(true);
        expect(release.with.body_path).toBe("release_notes.md");
        const files = String(release.with.files).trim().split("\n").map((line) => line.trim());
        expect(files).toEqual([
            "TTTGate-${{ github.ref_name }}-dist.tar.gz",
            "TTTGate-${{ github.ref_name }}-dist.zip",
            ...platforms.map((suffix) => `TTTGate-\${{ github.ref_name }}-${suffix}`),
        ]);
        // 릴리스 노트는 얕은 클론의 git 이력에 기대지 않는다.
        const runs = job.steps.filter((step: any) => step.run).map((step: any) => step.run).join("\n");
        expect(runs).not.toMatch(/git (log|describe|fetch)/);
    });

    test("uses action majors that run on Node 24 in every workflow (REQ-8, AC-5)", () => {
        // action-gh-release 는 v3 부터 Node 24 런타임이다(v2 는 Node 20).
        const minimum: Record<string, number> = {"actions/checkout": 5, "actions/setup-node": 5, "softprops/action-gh-release": 3};
        let checked = 0;
        for(const file of fs.readdirSync(directory).filter((name) => /\.ya?ml$/.test(name))) {
            const workflow = parseYaml(fs.readFileSync(path.join(directory, file), "utf8"));
            for(const job of Object.values<any>(workflow.jobs)) {
                for(const step of job.steps || []) {
                    const match = /^([^@]+)@v(\d+)/.exec(step.uses ?? "");
                    if(!match || minimum[match[1]] === undefined) continue;
                    checked++;
                    expect({file, action: match[1], atLeastMinimum: Number(match[2]) >= minimum[match[1]]})
                        .toEqual({file, action: match[1], atLeastMinimum: true});
                }
            }
        }
        expect(checked).toBeGreaterThan(0);
    });
});
