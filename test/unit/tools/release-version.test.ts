import fs from "fs";
import os from "os";
import path from "path";
import {spawnSync} from "child_process";
import {parse} from "yaml";

const root = path.resolve(__dirname, "../../..");
const bash = process.platform === "win32" ? path.join(process.env.ProgramFiles || "C:/Program Files", "Git/bin/bash.exe") : "bash";
const workflows = ["build-release.yml", "build-release-binaries.yml"];
const payload = "v$(printf TTTGATE_INPUT_EVALUATED)";
const fixture = (check: (directory: string) => void) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release input "));
    try { check(directory); } finally { fs.rmSync(directory, {recursive: true, force: true}); }
};
const shell = (script: string, directory: string, version: string) => spawnSync(bash, ["-e", "-c", script], {
    cwd: directory, encoding: "utf8", timeout: 10000, env: {...process.env, RELEASE_VERSION: version},
});

test.each(workflows)("%s heading treats the harmless version as data", name => fixture(directory => {
    const workflow = parse(fs.readFileSync(path.join(root, ".github/workflows", name), "utf8"));
    const notes = workflow.jobs.build.steps.find((step: any) => step.id === "release_notes");
    const heading = notes.run.split("\n")[0].replaceAll("${{ inputs.version }}", payload);
    const result = shell(heading, directory, payload);
    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(directory, "release_notes.md"), "utf8")).toContain(payload);
}));

test("quoted environment control preserves substitution characters literally", () => fixture(directory => {
    const result = shell('printf "%s" "$RELEASE_VERSION"', directory, payload);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(payload);
}));

test.each(workflows)("%s validates before all shell consumers and has no inline version interpolation", name => {
    const workflow = parse(fs.readFileSync(path.join(root, ".github/workflows", name), "utf8"));
    expect(workflow.jobs.build.env.RELEASE_VERSION).toBe("${{ inputs.version }}");
    const steps = workflow.jobs.build.steps;
    const runs = steps.filter((step: any) => step.run);
    expect(runs[0].run).toBe('node scripts/validate-release-version.cjs "$RELEASE_VERSION"');
    for(const step of runs) expect(step.run).not.toContain("${{ inputs.version }}");
    const release = steps.find((step: any) => step.uses?.startsWith("softprops/action-gh-release"));
    expect(release.with.tag_name).toBe("${{ inputs.version }}");
    expect(release.with.name).toBe("${{ inputs.release_title || inputs.version }}");
});

test.each([payload, "../outside", "", "v1\nnext", "v1\n", "v1\r\n", "v1;printf marker"])("invalid version %j stops before heading or archive creation", version => fixture(directory => {
    fs.mkdirSync(path.join(directory, "scripts"));
    const validator = path.join(root, "scripts/validate-release-version.cjs");
    expect(fs.existsSync(validator)).toBe(true);
    fs.copyFileSync(validator, path.join(directory, "scripts/validate-release-version.cjs"));
    const result = shell('node scripts/validate-release-version.cjs "$RELEASE_VERSION"\nprintf "%s" "$RELEASE_VERSION" > release_notes.md\ntar -czf artifact.tar.gz scripts', directory, version);
    expect(result.status).not.toBe(0);
    expect(fs.readdirSync(directory)).toEqual(["scripts"]);
    expect(result.stdout).not.toContain("TTTGATE_INPUT_EVALUATED");
}));

test.each(["v1.0.11b", "1.2.3-rc.1", "release_2026"])("valid %s keeps exact archive name and metadata", version => fixture(directory => {
    const validator = path.join(root, "scripts/validate-release-version.cjs");
    expect(fs.existsSync(validator)).toBe(true);
    fs.mkdirSync(path.join(directory, "scripts"));
    fs.copyFileSync(validator, path.join(directory, "scripts/validate-release-version.cjs"));
    const result = shell('node scripts/validate-release-version.cjs "$RELEASE_VERSION"\nprintf "%s" "$RELEASE_VERSION" > release_notes.md\ntar -czf "TTTGate-$RELEASE_VERSION-dist.tar.gz" scripts', directory, version);
    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(directory, "release_notes.md"), "utf8")).toBe(version);
    expect(fs.statSync(path.join(directory, `TTTGate-${version}-dist.tar.gz`)).size).toBeGreaterThan(0);
}));
