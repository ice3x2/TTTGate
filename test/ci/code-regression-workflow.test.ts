import * as fs from "fs";
import * as path from "path";
import {parse as parseYaml} from "yaml";

const workflowPath = path.resolve(__dirname, "../../.github/workflows/code-regression.yml");

describe("code regression CI (#14)", () => {
    test("runs for every pull request without branch or path filters", () => {
        const workflow = parseYaml(fs.readFileSync(workflowPath, "utf8"));
        expect(workflow.on.pull_request).toEqual({});
        expect(workflow.on.push.branches).toContain("main");
    });

    test("installs locked dependencies then builds and runs the full suite without bypassing failures", () => {
        const workflow = parseYaml(fs.readFileSync(workflowPath, "utf8"));
        const job = workflow.jobs.test;
        expect(job.if).toBeUndefined();
        expect(job["continue-on-error"]).toBeUndefined();
        expect(workflow.defaults?.run?.["working-directory"]).toBeUndefined();
        expect(job.defaults?.run?.["working-directory"]).toBeUndefined();
        expect(job.steps[0].uses).toMatch(/^actions\/checkout@/);
        expect(job.steps[1].uses).toMatch(/^actions\/setup-node@/);
        expect(job.steps[1].with["node-version"]).toBe("24");
        const commands = job.steps.filter((step: {run?: string}) => step.run);
        expect(commands.map((step: {run: string}) => step.run)).toEqual([
            "npm ci --no-audit --no-fund",
            "npm ci --prefix admin --no-audit --no-fund",
            "npx playwright install --with-deps chromium",
            "npm run build",
            "npm test -- --runInBand",
        ]);
        for (const step of job.steps) {
            expect(step.if).toBeUndefined();
            expect(step["continue-on-error"]).toBeUndefined();
            expect(step["working-directory"]).toBeUndefined();
        }
    });
});
