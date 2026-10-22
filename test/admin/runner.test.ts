import * as fs from "fs";
import * as path from "path";

const root = path.resolve(__dirname, "../..");

test("admin exposes a repeatable Jest test command", () => {
    const admin = JSON.parse(fs.readFileSync(path.join(root, "admin/package.json"), "utf8"));
    const project = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(admin.scripts.test).toBe("npm --prefix .. run test:admin");
    expect(project.scripts["test:admin"]).toBe("jest --runInBand test/admin");
    expect(project.devDependencies.playwright).toBeDefined();
});
