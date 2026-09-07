import fs from "fs";
import os from "os";
import path from "path";
import {spawnSync} from "child_process";
import {parse} from "yaml";

const root = path.resolve(__dirname, "../../..");
test("distribution metadata points to the actual compiled entrypoint", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package-build.json"), "utf8"));
    expect(manifest.main).toBe("app.js");
});
const withSource = (check: (directory: string) => void) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "source archive & "));
    try {
        fs.mkdirSync(path.join(directory, "dist.js/bin"), {recursive: true});
        fs.mkdirSync(path.join(directory, "dist.js/web/assets"), {recursive: true});
        fs.writeFileSync(path.join(directory, "dist.js/app.js"), "console.log('source fixture')");
        fs.writeFileSync(path.join(directory, "dist.js/package.json"), fs.readFileSync(path.join(root, "package-build.json")));
        fs.writeFileSync(path.join(directory, "dist.js/web/index.html"), '<script src="/assets/main.js"></script>');
        fs.writeFileSync(path.join(directory, "dist.js/web/assets/main.js"), "console.log('web fixture')");
        fs.mkdirSync(path.join(directory, "dist/web"), {recursive: true});
        fs.writeFileSync(path.join(directory, "dist/web/wrong.txt"), "wrong binary distribution");
        check(directory);
    } finally { fs.rmSync(directory, {recursive: true, force: true}); }
};
const run = (directory: string) => spawnSync(process.execPath, [path.join(root, "scripts/archive-source.cjs"), "v1.0.11b", directory], {encoding: "utf8", timeout: 15000});

test("both source archives preserve flat entrypoint, manifest, web and runtime bin", () => withSource(directory => {
    const result = run(directory);
    expect({status: result.status, stderr: result.stderr}).toEqual({status: 0, stderr: ""});
    for(const extension of ["tar.gz", "zip"]) {
        const archive = path.join(directory, `TTTGate-v1.0.11b-dist.${extension}`);
        expect(fs.statSync(archive).size).toBeGreaterThan(0);
        const extracted = path.join(directory, extension);
        fs.mkdirSync(extracted);
        const zip = extension === "zip" && process.platform !== "win32";
        const extraction = spawnSync(zip ? "unzip" : "tar", zip ? ["-q", archive, "-d", extracted] : ["-xf", archive, "-C", extracted]);
        expect(extraction.status).toBe(0);
        for(const file of ["app.js", "package.json", "web/index.html", "web/assets/main.js"]) {
            expect(fs.readFileSync(path.join(extracted, file))).toEqual(fs.readFileSync(path.join(directory, "dist.js", file)));
        }
        expect(fs.statSync(path.join(extracted, "bin")).isDirectory()).toBe(true);
        expect(fs.existsSync(path.join(extracted, "web/wrong.txt"))).toBe(false);
        const manifest = JSON.parse(fs.readFileSync(path.join(extracted, "package.json"), "utf8"));
        expect(manifest.main).toBe("app.js");
        expect(manifest.engines.node).toBe(">=24.0.0");
    }
}));

test.each(["app.js", "package.json", "web/index.html", "web/assets/main.js", "bin"])("missing %s fails before output", file => withSource(directory => {
    fs.rmSync(path.join(directory, "dist.js", file), {recursive: true});
    const result = run(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(file);
    expect(fs.readdirSync(directory).filter(name => name.startsWith("TTTGate-"))).toEqual([]);
}));

test.each(["app.js", "package.json", "web/index.html", "web/assets/main.js"])("empty %s fails before output", file => withSource(directory => {
    fs.writeFileSync(path.join(directory, "dist.js", file), "");
    const result = run(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(file);
    expect(fs.readdirSync(directory).filter(name => name.startsWith("TTTGate-"))).toEqual([]);
}));

test.each(["build-release.yml", "build-release-binaries.yml"])("%s archives source and documents isolated dependency installation", name => {
    const workflow = parse(fs.readFileSync(path.join(root, ".github/workflows", name), "utf8"));
    const runs = workflow.jobs.build.steps.filter((step: any) => step.run).map((step: any) => step.run).join("\n");
    expect(runs).toContain('node scripts/archive-source.cjs "$RELEASE_VERSION"');
    expect(runs).not.toContain("cd dist\n");
    expect(runs).toContain("npm install --omit=dev");
    expect(runs).toContain("node app.js server");
    expect(runs).not.toContain("node src/app.js");
    const upload = workflow.jobs.build.steps.find((step: any) => step.uses?.startsWith("softprops/action-gh-release"));
    expect(upload.with.fail_on_unmatched_files).toBe(true);
});
