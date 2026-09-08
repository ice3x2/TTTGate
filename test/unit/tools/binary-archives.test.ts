import fs from "fs";
import os from "os";
import path from "path";
import {spawnSync} from "child_process";
import {parse} from "yaml";

const root = path.resolve(__dirname, "../../..");
const binaries = ["TTTGate-linux-x64", "TTTGate-linux-arm64", "TTTGate-win-x64.exe", "TTTGate-win-arm64.exe", "TTTGate-alpine-x64"];
const archives = ["linux-x64.tar.gz", "linux-arm64.tar.gz", "win-x64.zip", "win-arm64.zip", "alpine-x64.tar.gz"];
const run = (directory: string) => spawnSync(process.execPath,
    [path.join(root, "scripts/archive-binaries.cjs"), "v-fixture", directory], {encoding: "utf8", timeout: 15000});
const web = (directory: string) => {
    fs.mkdirSync(path.join(directory, "dist/web/assets"), {recursive: true});
    fs.writeFileSync(path.join(directory, "dist/web/index.html"), '<script src="/assets/main.js"></script>');
    fs.writeFileSync(path.join(directory, "dist/web/assets/main.js"), "production web fixture");
};

test("archives exactly the five configured output binaries with original bytes", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "archive bytes & "));
    try {
        fs.mkdirSync(path.join(directory, "dist/bin"), {recursive: true});
        binaries.forEach((name, i) => fs.writeFileSync(path.join(directory, "dist/bin", name), Buffer.from([0, i, 255, 13, 10])));
        web(directory);
        const result = run(directory);
        expect({status: result.status, error: result.stderr}).toEqual({status: 0, error: ""});
        expect(fs.readdirSync(directory).filter(name => name.startsWith("TTTGate-"))).toEqual(archives.map(name => `TTTGate-v-fixture-${name}`).sort());
        archives.forEach((suffix, i) => {
            const archive = path.join(directory, `TTTGate-v-fixture-${suffix}`);
            expect(fs.statSync(archive).size).toBeGreaterThan(0);
            const zip = suffix.endsWith(".zip") && process.platform !== "win32";
            const list = spawnSync(zip ? "unzip" : "tar", zip ? ["-Z1", archive] : ["-tf", archive], {encoding: "utf8"});
            expect(list.status).toBe(0);
            const members = list.stdout.trim().split(/\r?\n/).filter(name => !name.endsWith("/"));
            expect(members.sort()).toEqual([`bin/${binaries[i]}`, "web/assets/main.js", "web/index.html"].sort());
            const content = spawnSync(zip ? "unzip" : "tar", zip ? ["-p", archive, `bin/${binaries[i]}`] : ["-xOf", archive, `bin/${binaries[i]}`]);
            expect(content.status).toBe(0);
            expect(content.stdout).toEqual(fs.readFileSync(path.join(directory, "dist/bin", binaries[i])));
            const webContent = spawnSync(zip ? "unzip" : "tar", zip ? ["-p", archive, "web/assets/main.js"] : ["-xOf", archive, "web/assets/main.js"]);
            expect(webContent.stdout).toEqual(fs.readFileSync(path.join(directory, "dist/web/assets/main.js")));
        });
    } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test.each(["missing index", "empty index", "missing asset", "empty asset"])("%s rejects all five archives before output", kind => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "archive web "));
    try {
        fs.mkdirSync(path.join(directory, "dist/bin"), {recursive: true});
        binaries.forEach(name => fs.writeFileSync(path.join(directory, "dist/bin", name), "binary"));
        web(directory);
        const relative = kind.endsWith("index") ? "web/index.html" : "web/assets/main.js";
        const file = path.join(directory, "dist", relative);
        if(kind.startsWith("empty")) fs.writeFileSync(file, ""); else fs.unlinkSync(file);
        const result = run(directory);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(relative);
        expect(fs.readdirSync(directory)).toEqual(["dist"]);
    } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test.each(["missing", "empty"])("%s binary fails before any archive is emitted", (kind) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "archive invalid "));
    try {
        fs.mkdirSync(path.join(directory, "dist/bin"), {recursive: true});
        binaries.slice(0, -1).forEach(name => fs.writeFileSync(path.join(directory, "dist/bin", name), "binary"));
        if(kind === "empty") fs.writeFileSync(path.join(directory, "dist/bin", binaries[4]), "");
        const result = run(directory);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(binaries[4]);
        expect(fs.readdirSync(directory)).toEqual(["dist"]);
    } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test("workflow builds once, honors false and requires every selected upload", () => {
    const workflow = parse(fs.readFileSync(path.join(root, ".github/workflows/build-release-binaries.yml"), "utf8"));
    const steps = workflow.jobs.build.steps;
    const commands = steps.map((step: any) => step.run ?? "").join("\n");
    expect(commands).not.toContain("npm run pkg");
    expect(commands).toContain("--skip-binaries");
    expect(commands).toContain("scripts/archive-binaries.cjs");
    expect(commands).toContain("./bin/TTTGate-linux-x64 server");
    expect(commands).toContain("bin/TTTGate-win-x64.exe server");
    const release = steps.find((step: any) => step.uses?.startsWith("softprops/action-gh-release"));
    expect(release.with.fail_on_unmatched_files).toBe(true);
    expect(release.with.files).toContain("steps.release_files.outputs.files");
    const files = steps.find((step: any) => step.id === "release_files");
    expect(files.run).toContain('"$BUILD_BINARIES" = "true"');
    expect(files.env.BUILD_BINARIES).toBe("${{ inputs.build_binaries }}");
});
