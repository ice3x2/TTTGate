import fs from "fs";
import Path from "path";
import Environment from "../../src/Environment";

describe("Environment version metadata", () => {
    it("uses the package version as the runtime version name", () => {
        const packageJson = JSON.parse(fs.readFileSync(Path.join(process.cwd(), "package.json"), {encoding: "utf-8"})) as {version: string};
        const packageBuildJson = JSON.parse(fs.readFileSync(Path.join(process.cwd(), "package-build.json"), {encoding: "utf-8"})) as {version: string};

        expect(packageBuildJson.version).toBe(packageJson.version);
        expect(Environment.version.name).toBe(packageJson.version);
        expect(Environment.version.build).toMatch(/^\d{8}$/);
    });
});
