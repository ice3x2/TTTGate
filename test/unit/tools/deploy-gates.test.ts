import fs from "fs";
import os from "os";
import path from "path";
import {spawnSync} from "child_process";

const root = path.resolve(__dirname, "../../..");
const stages = ["root-install", "admin-install", "browser-install", "admin-check", "root-build", "tests", "admin-build"];

// Real npm executes these local fixture scripts. They prove orchestration,
// not actual TypeScript, browser installation, tests or binary packaging.
const fixtureScript = `
const fs = require('node:fs');
const path = require('node:path');
const stage = process.argv[2];
fs.appendFileSync(path.join(__dirname, 'journal.jsonl'), JSON.stringify({stage, cwd: process.cwd(), args: process.argv.slice(3), nodeEnv: process.env.NODE_ENV}) + '\\n');
if(process.env.DEPLOY_FIXTURE_FAIL === stage) process.exit(23);
if(stage === 'root-build') {
    fs.mkdirSync(path.join(__dirname, 'build/src'), {recursive: true});
    fs.writeFileSync(path.join(__dirname, 'build/src/app.js'), 'compiled release');
}
if(stage === 'tests' || stage === 'admin-build') {
    fs.mkdirSync(path.join(__dirname, 'admin/dist'), {recursive: true});
    fs.writeFileSync(path.join(__dirname, 'admin/dist/index.html'), stage === 'tests' ? 'TEST PREVIEW FIXTURE' : process.env.NODE_ENV === 'production' ? 'PRODUCTION ADMIN' : 'WRONG ENVIRONMENT');
}
if(stage === 'pkg') {
    fs.mkdirSync(path.join(__dirname, 'dist/bin'), {recursive: true});
    fs.writeFileSync(path.join(__dirname, 'dist/bin/fixture.txt'), 'fixture package');
}
`;

const withFixture = (check: (fixture: {directory: string, result: ReturnType<typeof spawnSync>, journal: any[]}) => void, fail?: string, args: string[] = []) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release gates & "));
    const manifest = (location: string, scripts: Record<string, string>) => {
        const data = {name: "release-gate-fixture", version: "1.0.0", private: true, scripts};
        fs.mkdirSync(location, {recursive: true});
        fs.writeFileSync(path.join(location, "package.json"), JSON.stringify(data));
        fs.writeFileSync(path.join(location, "package-lock.json"), JSON.stringify({name: data.name, version: data.version,
            lockfileVersion: 3, requires: true, packages: {"": {name: data.name, version: data.version, hasInstallScript: true}}}));
    };
    try {
        fs.copyFileSync(path.join(root, "deploy.js"), path.join(directory, "deploy.js"));
        fs.writeFileSync(path.join(directory, "stage.cjs"), fixtureScript);
        manifest(directory, {postinstall: "node stage.cjs root-install", "test:browser:install": "node stage.cjs browser-install",
            build: "node stage.cjs root-build", test: "node stage.cjs tests", pkg: "node stage.cjs pkg"});
        manifest(path.join(directory, "admin"), {postinstall: "node ../stage.cjs admin-install",
            check: "node ../stage.cjs admin-check", build: "node ../stage.cjs admin-build"});
        fs.writeFileSync(path.join(directory, "package-build.json"), JSON.stringify({name: "source-fixture", main: "app.js"}));
        for(const output of ["dist", "dist.js", "caller/dist"]) {
            fs.mkdirSync(path.join(directory, output), {recursive: true});
            fs.writeFileSync(path.join(directory, output, "preserve.txt"), "previous artifact");
        }
        const result = spawnSync(process.execPath, [path.join(directory, "deploy.js"), ...args], {
            cwd: path.join(directory, "caller"), encoding: "utf8", timeout: 45_000, maxBuffer: 4 * 1024 * 1024,
            env: {...process.env, DEPLOY_FIXTURE_FAIL: fail, npm_config_update_notifier: "false"},
        });
        const journalFile = path.join(directory, "journal.jsonl");
        const journal = fs.existsSync(journalFile) ? fs.readFileSync(journalFile, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
        check({directory, result, journal});
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
};

test.each(stages)("failed %s gate preserves previous artifacts and never reaches packaging", (stage) => {
    withFixture(({directory, result, journal}) => {
        expect(result.error).toBeUndefined();
        expect(result.status).not.toBe(0);
        expect(journal.map((entry) => entry.stage)).toEqual(stages.slice(0, stages.indexOf(stage) + 1));
        expect(journal.some((entry) => entry.stage === "pkg")).toBe(false);
        for(const output of ["dist", "dist.js", "caller/dist"]) {
            expect(fs.readFileSync(path.join(directory, output, "preserve.txt"), "utf8")).toBe("previous artifact");
        }
    }, stage);
}, 50_000);

test("all gates run from fixed project directories and final production rebuild precedes output/pkg", () => {
    withFixture(({directory, result, journal}) => {
        expect(result.error).toBeUndefined();
        expect({status: result.status, error: result.status ? String(result.stderr) : ""}).toEqual({status: 0, error: ""});
        expect(journal.map((entry) => entry.stage)).toEqual([...stages, "pkg"]);
        journal.forEach((entry) => expect(entry.cwd).toBe(entry.stage.startsWith("admin-") ? path.join(directory, "admin") : directory));
        expect(journal.find((entry) => entry.stage === "root-build").args).toEqual(["--force"]);
        expect(journal.find((entry) => entry.stage === "tests").args).toEqual(["--runInBand"]);
        expect(journal.find((entry) => entry.stage === "tests").nodeEnv).toBe("test");
        expect(journal.find((entry) => entry.stage === "admin-build").nodeEnv).toBe("production");
        expect(journal.find((entry) => entry.stage === "browser-install").args)
            .toEqual(process.platform === "linux" && process.env.GITHUB_ACTIONS === "true" ? ["--with-deps"] : []);
        for(const output of ["dist/web", "dist.js/web"]) {
            expect(fs.readFileSync(path.join(directory, output, "index.html"), "utf8")).toBe("PRODUCTION ADMIN");
        }
        expect(fs.readFileSync(path.join(directory, "dist.js/app.js"), "utf8")).toBe("compiled release");
        expect(fs.readFileSync(path.join(directory, "caller/dist/preserve.txt"), "utf8")).toBe("previous artifact");
    });
}, 50_000);

test("the actual browser gate invokes the installed Playwright CLI", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(manifest.scripts["test:browser:install"]).toBe("playwright install chromium");
});

test("packaged binaries bundle the geoip-lite country databases", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(manifest.pkg.assets).toEqual([
        "node_modules/geoip-lite/data/geoip-country.dat",
        "node_modules/geoip-lite/data/geoip-country6.dat"]);
    expect(manifest.scripts["geoip:update"]).toBe("node scripts/geoip-update.mjs");
});

// 종료 코드 2 는 "갱신하지 않았다" 를 실제 갱신 실패(1)와 구분하는 신호다. 0 으로 바뀌면 릴리스가
// 갱신하지 않은 DB 를 담은 채 그대로 진행된다. 라이선스 키가 있는 경로는 실제 다운로드를 수행하므로
// 실행하지 않는다.
test("the geoip update script reports a skipped update without a license key", () => {
    const result = spawnSync(process.execPath, [path.join(root, "scripts/geoip-update.mjs")],
        {cwd: root, encoding: "utf8", timeout: 15_000, env: {...process.env, MAXMIND_LICENSE_KEY: ""}});
    expect({status: result.status, stdout: result.stdout, stderr: result.stderr}).toEqual({status: 2, stdout: "",
        stderr: "MAXMIND_LICENSE_KEY is not set; keeping the bundled GeoLite2 database\n"});
});

// #290 — 릴리스 워크플로는 Code Regression 을 먼저 통과하므로 패키징 때 테스트를 다시 돌리지 않는다.
test("--skip-tests skips only the browser install and test gates and still packages", () => {
    withFixture(({directory, result, journal}) => {
        expect({status: result.status, error: result.status ? String(result.stderr) : ""}).toEqual({status: 0, error: ""});
        expect(journal.map(entry => entry.stage)).toEqual(["root-install", "admin-install", "admin-check", "root-build", "admin-build", "pkg"]);
        expect(fs.readFileSync(path.join(directory, "dist/web/index.html"), "utf8")).toBe("PRODUCTION ADMIN");
        expect(fs.readFileSync(path.join(directory, "dist/bin/fixture.txt"), "utf8")).toBe("fixture package");
    }, undefined, ["--skip-tests"]);
}, 50_000);

test("explicit source-only deployment runs all gates but never invokes pkg", () => {
    withFixture(({directory, result, journal}) => {
        expect(result.status).toBe(0);
        expect(journal.map(entry => entry.stage)).toEqual(stages);
        expect(fs.existsSync(path.join(directory, "dist/bin/fixture.txt"))).toBe(false);
        expect(fs.readFileSync(path.join(directory, "dist.js/app.js"), "utf8")).toBe("compiled release");
    }, undefined, ["--skip-binaries"]);
}, 50_000);
