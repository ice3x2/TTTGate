import * as fs from "fs";
import * as path from "path";
import {parse as parseYaml} from "yaml";

const workflowPath = path.resolve(__dirname, "../../.github/workflows/code-regression.yml");

const fastCommands = ["npm ci --no-audit --no-fund", "npm run build", "npm run lint", "npm run test:unit"];
// #191: 컴포넌트 테스트는 단위 테스트와 합쳐 30분을 넘으므로 따로 돈다. 일부가 build/ 를 띄우므로 빌드한다.
const componentCommands = ["npm ci --no-audit --no-fund", "npm run build", "npm run test:component"];
const browserCommands = ["npm ci --no-audit --no-fund", "npm ci --prefix admin --no-audit --no-fund",
    "npx playwright install --with-deps chromium", "npm run build", "npm run test:admin", "npm run test:e2e", "npm run test:e2e:browser"];
// #131: src 와 test 를 함께 타입 체크한다. 실패하면 워크플로가 실패한다.
const typecheckCommands = ["npm ci --no-audit --no-fund", "npm run typecheck"];

describe("code regression CI (#14)", () => {
    test("runs for every pull request without branch or path filters", () => {
        const workflow = parseYaml(fs.readFileSync(workflowPath, "utf8"));
        expect(workflow.on.pull_request).toEqual({});
        expect(workflow.on.push.branches).toContain("main");
    });

    test.each([
        ["fast", fastCommands],
        ["component", componentCommands],
        ["browser-e2e", browserCommands],
        ["typecheck", typecheckCommands],
    ])("%s job installs locked dependencies then runs its commands without bypassing failures", (jobName, commands) => {
        const workflow = parseYaml(fs.readFileSync(workflowPath, "utf8"));
        const job = workflow.jobs[jobName as string];
        expect(job["runs-on"]).toBe("ubuntu-latest");
        expect(Object.keys(job.env ?? {})).toEqual(["NODE_ENV"]);
        expect(job.if).toBeUndefined();
        expect(job.needs).toBeUndefined();
        expect(job["continue-on-error"]).toBeUndefined();
        expect(workflow.defaults?.run?.["working-directory"]).toBeUndefined();
        expect(job.defaults?.run?.["working-directory"]).toBeUndefined();
        expect(job.steps[0].uses).toMatch(/^actions\/checkout@/);
        expect(job.steps[1].uses).toMatch(/^actions\/setup-node@/);
        expect(job.steps[1].with["node-version"]).toBe("24");
        const stepCommands = job.steps.filter((step: {run?: string}) => step.run);
        expect(stepCommands.map((step: {run: string}) => step.run)).toEqual(commands);
        for(const step of job.steps) {
            expect(step.if).toBeUndefined();
            expect(step["continue-on-error"]).toBeUndefined();
            expect(step["working-directory"]).toBeUndefined();
        }
    });

    test("declares exactly the fast, component, typecheck and browser-e2e jobs with no dependency between them", () => {
        const workflow = parseYaml(fs.readFileSync(workflowPath, "utf8"));
        expect(Object.keys(workflow.jobs)).toEqual(["fast", "component", "typecheck", "browser-e2e"]);
        for(const job of Object.values<any>(workflow.jobs)) expect(job.needs).toBeUndefined();
    });

    // #191: 로컬에서 test:component 는 --runInBand 로 30분을 넘는다. 단위 작업은 30분을 유지한다.
    test("gives the component job enough time and keeps the unit job bounded", () => {
        const workflow = parseYaml(fs.readFileSync(workflowPath, "utf8"));
        expect(workflow.jobs.component["timeout-minutes"]).toBeGreaterThanOrEqual(90);
        expect(workflow.jobs.fast["timeout-minutes"]).toBe(30);
    });
});
