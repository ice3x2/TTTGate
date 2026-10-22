import * as fs from "fs";
import * as path from "path";
import {spawnSync} from "child_process";
import AdminServer from "../../src/server/admin/AdminServer";
import ServerOptionStore from "../../src/server/ServerOptionStore";
import {applyTestRoot, cleanupTestRoot, createTestRoot} from "../helpers/runtime";
import {startAdminBrowser} from "../helpers/adminBrowser";

const root = path.resolve(__dirname, "../..");

test("the entrypoint regression uses the intended Svelte 5 and Vite 6 environment", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "admin/package.json"), "utf8"));
    expect(manifest.devDependencies.svelte).toMatch(/^\^5\./);
    expect(manifest.devDependencies.vite).toMatch(/^\^6\./);
    expect(manifest.engines.node).toBe(">=24.0.0");
    expect(manifest.scripts.test).toBe("npm --prefix .. run test:admin");
});

test.each([false, true])("actual administrator entrypoint renders sign-in without mount errors (production=%s)", async (production) => {
    if(production) {
        const build = spawnSync(process.execPath, [path.join(root, "admin/node_modules/vite/bin/vite.js"), "build"], {
            cwd: path.join(root, "admin"), encoding: "utf8", timeout: 30_000,
            env: {...process.env, NODE_ENV: "production"},
        });
        expect(build.error).toBeUndefined();
        expect({status: build.status, errors: build.status ? build.stderr : ""}).toEqual({status: 0, errors: ""});
    }
    const testRoot = await createTestRoot("admin-entrypoint-5");
    applyTestRoot(testRoot.rootDir);
    ServerOptionStore.instance;
    const api = new AdminServer({} as any, false);
    let app: Awaited<ReturnType<typeof startAdminBrowser>> | undefined;
    try {
        const port = await api.listen(0, "127.0.0.1");
        app = await startAdminBrowser({apiOrigin: `http://127.0.0.1:${port}`, preview: production});
        const document = await app.page.goto(app.url);
        expect(await document!.text()).toContain(production ? "/assets/" : "/src/main.ts");
        expect(app.errors).toEqual([]);
        await app.page.getByRole("heading", {name: "Sign in"}).waitFor({state: "visible", timeout: 5000});
        expect(await app.page.locator('input[type="password"]').count()).toBe(1);
        expect(app.errors).toEqual([]);
    } finally {
        await app?.close();
        await api.close();
        await cleanupTestRoot(testRoot);
    }
}, 45_000);
