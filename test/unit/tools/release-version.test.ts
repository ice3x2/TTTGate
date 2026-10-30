import fs from "fs";
import os from "os";
import path from "path";
import {spawnSync} from "child_process";
import {parse} from "yaml";

const root = path.resolve(__dirname, "../../..");
const bash = process.platform === "win32" ? path.join(process.env.ProgramFiles || "C:/Program Files", "Git/bin/bash.exe") : "bash";
const payload = "v$(printf TTTGATE_INPUT_EVALUATED)";
const fixture = (check: (directory: string) => void) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release input "));
    try { check(directory); } finally { fs.rmSync(directory, {recursive: true, force: true}); }
};
const shell = (script: string, directory: string, version: string) => spawnSync(bash, ["-e", "-c", script], {
    cwd: directory, encoding: "utf8", timeout: 10000, env: {...process.env, RELEASE_VERSION: version},
});

test("quoted environment control preserves substitution characters literally", () => fixture(directory => {
    const result = shell('printf "%s" "$RELEASE_VERSION"', directory, payload);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(payload);
}));

// #290 — 릴리스 워크플로는 태그 이름을 환경 변수로만 읽고, 다른 어떤 셸 단계보다 먼저 검사한다.
test("release.yml validates before all shell consumers and has no inline tag interpolation", () => {
    const workflow = parse(fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8"));
    expect(workflow.jobs.release.env.RELEASE_VERSION).toBe("${{ github.ref_name }}");
    const runs = workflow.jobs.release.steps.filter((step: any) => step.run);
    expect(runs[0].run.trim()).toBe('node scripts/validate-release-version.cjs "$RELEASE_VERSION" --match-package');
    for(const step of runs) expect(step.run).not.toContain("${{");
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

// #290 REQ-6 — 태그와 package.json 의 version 이 다르면 패키징 전에 멈춘다.
const withPackage = (version: string, check: (directory: string) => void) => fixture(directory => {
    fs.mkdirSync(path.join(directory, "scripts"));
    fs.copyFileSync(path.join(root, "scripts/validate-release-version.cjs"), path.join(directory, "scripts/validate-release-version.cjs"));
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({name: "fixture", version}));
    check(directory);
});

test("--match-package accepts a tag equal to package.json version", () => withPackage("2.0.0", directory => {
    const result = shell('node scripts/validate-release-version.cjs "$RELEASE_VERSION" --match-package', directory, "2.0.0");
    expect({status: result.status, stderr: result.stderr}).toEqual({status: 0, stderr: ""});
}));

test.each(["2.0.1", "v2.0.0", "main"])("--match-package rejects %s when package.json says 2.0.0", tag => withPackage("2.0.0", directory => {
    const result = shell('node scripts/validate-release-version.cjs "$RELEASE_VERSION" --match-package', directory, tag);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe(`Release tag ${tag} does not match package.json version 2.0.0. Push the tag 2.0.0 or run the workflow on it.\n`);
}));

test("the package version is the one being released", () => {
    expect(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version).toBe("2.0.0");
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    expect([lock.version, lock.packages[""].version]).toEqual(["2.0.0", "2.0.0"]);
});
