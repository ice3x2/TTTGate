import * as fs from "fs";
import * as path from "path";

const root = path.resolve(__dirname, "../..");
const readManifest = () => JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const expectedScripts: Record<string, string> = {
    "test:unit": "jest --detectOpenHandles test/unit test/commons test/util",
    "test:component": "jest --detectOpenHandles --runInBand test/component test/security test/supply-chain test/ci",
    "test:admin": "jest --runInBand test/admin",
    "test:e2e": "jest --runInBand test/e2e/tunnel test/e2e/target test/e2e/req-09-pool-swap-zombie.test.ts",
    "test:e2e:browser": "jest --runInBand test/e2e/browser",
    "test:stress": "jest --runInBand test/stress",
    "test:coverage": "jest --detectOpenHandles --coverage",
    "test:browser:install": "playwright install chromium",
};

// The directories/files each layer script selects. Their union must equal
// every *.test.ts file under test/ (excluding helpers/fixtures) with no gaps.
const layerPaths = [
    "test/unit", "test/commons", "test/util",
    "test/component", "test/security", "test/supply-chain", "test/ci",
    "test/admin",
    "test/e2e/tunnel", "test/e2e/target", "test/e2e/req-09-pool-swap-zombie.test.ts",
    "test/e2e/browser",
    "test/stress",
];

const listTestFiles = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, {withFileTypes: true});
    const files: string[] = [];
    for(const entry of entries) {
        const full = path.join(dir, entry.name);
        if(entry.isDirectory()) {
            if(entry.name === "helpers" || entry.name === "fixtures") continue;
            files.push(...listTestFiles(full));
        } else if(entry.name.endsWith(".test.ts")) {
            files.push(full);
        }
    }
    return files;
};

const isUnderLayer = (file: string): boolean => {
    const relative = path.relative(root, file).split(path.sep).join("/");
    return layerPaths.some((layerPath) => relative === layerPath || relative.startsWith(`${layerPath}/`));
};

describe("npm test layer scripts (#81)", () => {
    test.each(Object.entries(expectedScripts))("%s is defined exactly as %s", (name, expected) => {
        expect(readManifest().scripts[name]).toBe(expected);
    });

    test.each(layerPaths)("layer path %s exists", (layerPath) => {
        expect(fs.existsSync(path.join(root, layerPath))).toBe(true);
    });

    test("every test/**/*.test.ts file (excluding helpers/fixtures) belongs to exactly one layer", () => {
        const allTestFiles = listTestFiles(path.join(root, "test"));
        const outsideLayers = allTestFiles.filter((file) => !isUnderLayer(file));
        expect(outsideLayers).toEqual([]);
    });

    test("admin-browser-startup.test.ts moved from component to admin", () => {
        expect(fs.existsSync(path.join(root, "test/component/admin-browser-startup.test.ts"))).toBe(false);
        expect(fs.existsSync(path.join(root, "test/admin/admin-browser-startup.test.ts"))).toBe(true);
    });

    test("test-evidence-policy documents the test layers and harness selection", () => {
        const policy = fs.readFileSync(path.join(root, "docs/guide/test-evidence-policy.md"), "utf8");
        expect(policy).toContain("## Test layers and harness selection");
    });

    test("manual end-to-end checklist document exists", () => {
        expect(fs.existsSync(path.join(root, "docs/guide/e2e-manual-checklist.md"))).toBe(true);
    });
});
