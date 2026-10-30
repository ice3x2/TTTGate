import fs from "fs";
import os from "os";
import Path from "path";
import Environment, {resolveBuildId} from "../../src/Environment";

describe("Environment version metadata", () => {
    it("uses the package version as the runtime version name", () => {
        const packageJson = JSON.parse(fs.readFileSync(Path.join(process.cwd(), "package.json"), {encoding: "utf-8"})) as {version: string};
        const packageBuildJson = JSON.parse(fs.readFileSync(Path.join(process.cwd(), "package-build.json"), {encoding: "utf-8"})) as {version: string};

        expect(packageBuildJson.version).toBe(packageJson.version);
        expect(Environment.version.name).toBe(packageJson.version);
        expect(Environment.version.build).toMatch(/^(\d{8}|dev)$/);
    });
});

// #290 REQ-10 — 배포물은 실제 빌드 날짜를 보고한다. deploy.js 가 빌드할 때 build-info.js 에 적는다.
describe("resolveBuildId", () => {
    const withDirectory = (check: (directory: string) => void) => {
        const directory = fs.mkdtempSync(Path.join(os.tmpdir(), "build-info-"));
        try { check(directory); } finally { fs.rmSync(directory, {recursive: true, force: true}); }
    };

    it("prefers TTTGATE_BUILD from the environment", () => withDirectory((directory) => {
        fs.writeFileSync(Path.join(directory, "build-info.js"), 'module.exports = {build: "20261031"};\n');
        expect(resolveBuildId({TTTGATE_BUILD: " 20261030 "}, directory)).toBe("20261030");
    }));

    it("uses the build date written next to the module by the release build", () => withDirectory((directory) => {
        fs.writeFileSync(Path.join(directory, "build-info.js"), 'module.exports = {build: "20261031"};\n');
        expect(resolveBuildId({}, directory)).toBe("20261031");
    }));

    it("reports dev when nothing was stamped", () => withDirectory((directory) => {
        expect(resolveBuildId({}, directory)).toBe("dev");
        expect(resolveBuildId({TTTGATE_BUILD: "  "}, directory)).toBe("dev");
    }));
});
