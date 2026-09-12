import * as fs from "fs";
import * as path from "path";
import {parse as parseYaml} from "yaml";

const workflowPath = path.resolve(__dirname, "../../.github/workflows/code-regression.yml");

const fastCommands = ["npm ci --no-audit --no-fund", "npm run build", "npm run lint", "npm run test:unit", "npm run test:component"];
const browserCommands = ["npm ci --no-audit --no-fund", "npm ci --prefix admin --no-audit --no-fund",
    "npx playwright install --with-deps chromium", "npm run build", "npm run test:admin", "npm run test:e2e", "npm run test:e2e:browser"];

describe("code regression CI (#14)", () => {
    test("runs for every pull request without branch or path filters", () => {
        const workflow = parseYaml(fs.readFileSync(workflowPath, "utf8"));
        expect(workflow.on.pull_request).toEqual({});
        expect(workflow.on.push.branches).toContain("main");
    });

    test.each([
        ["fast", fastCommands],
        ["browser-e2e", browserCommands],
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

    test("declares exactly the fast and browser-e2e jobs with no dependency between them", () => {
        const workflow = parseYaml(fs.readFileSync(workflowPath, "utf8"));
        expect(Object.keys(workflow.jobs)).toEqual(["fast", "browser-e2e"]);
        for(const job of Object.values<any>(workflow.jobs)) expect(job.needs).toBeUndefined();
    });
});
