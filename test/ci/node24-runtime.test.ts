import * as fs from "fs";
import * as path from "path";
import {parse as parseYaml} from "yaml";

const root = path.resolve(__dirname, "../..");
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

describe("Node 24 runtime and packaging contract", () => {
    test.each(["package.json", "admin/package.json", "package-build.json"])(
        "%s declares the minimum runtime", (file) => {
            expect(readJson(file).engines?.node).toBe(">=24.0.0");
        });
    test.each(["package-lock.json", "admin/package-lock.json"])(
        "%s retains the minimum runtime in its root package", (file) => {
            expect(readJson(file).packages[""].engines?.node).toBe(">=24.0.0");
        });
    test("the developer runtime and Node declarations match the supported major", () => {
        expect(fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim()).toBe("24");
        expect(readJson("package.json").devDependencies["@types/node"]).toMatch(/^\^?24\./);
        expect(readJson("package-lock.json").packages["node_modules/@types/node"].version).toMatch(/^24\./);
    });
    test("the maintained packager preserves all five platforms with Node 24", () => {
        const project = readJson("package.json");
        expect(project.devDependencies.pkg).toBeUndefined();
        expect(project.devDependencies["@yao-pkg/pkg"]).toBe("6.22.0");
        expect(project.pkg.targets.slice().sort()).toEqual([
            "node24-alpine-x64", "node24-linux-arm64", "node24-linux-x64",
            "node24-win-arm64", "node24-win-x64",
        ]);
        expect(project.scripts.pkg).toContain("--no-bytecode");
        expect(project.scripts.pkg).toContain("--public-packages");
    });
    test("all workflow Node setup steps resolve to Node 24 and use the locked packager", () => {
        const directory = path.join(root, ".github/workflows");
        let setupCount = 0;
        for(const file of fs.readdirSync(directory).filter((name) => /\.ya?ml$/.test(name))) {
            const text = fs.readFileSync(path.join(directory, file), "utf8");
            const workflow = parseYaml(text);
            expect(text).not.toMatch(/npm install -g pkg\b/);
            for(const job of Object.values<any>(workflow.jobs)) {
                for(const step of job.steps || []) {
                    if(!step.uses?.startsWith("actions/setup-node@")) continue;
                    setupCount++;
                    const version = step.with["node-version"];
                    const resolved = version === "${{ matrix.node-version }}"
                        ? job.strategy.matrix["node-version"] : [version];
                    expect(resolved.map(String)).toEqual(expect.arrayContaining([expect.stringMatching(/^24(?:\.x)?$/)]));
                    expect(resolved.every((value: unknown) => /^24(?:\.x)?$/.test(String(value)))).toBe(true);
                }
            }
        }
        expect(setupCount).toBeGreaterThan(0);
    });
    test("installation guidance and generated release requirements use Node 24", () => {
        expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toContain("Node.js 24");
        const workflow = fs.readFileSync(path.join(root, ".github/workflows/build-release-binaries.yml"), "utf8");
        expect(workflow).toContain("Node.js 24+");
        expect(workflow).not.toContain("Node.js 18+");
    });
});
