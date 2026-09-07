import * as fs from "fs";
import * as path from "path";
import {startAdminBrowser} from "../helpers/adminBrowser";

const root = path.resolve(__dirname, "../..");

test("admin removes crypto-js and its certificate challenge uses the shared native random helper", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "admin/package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(root, "admin/package-lock.json"), "utf8"));
    expect(manifest.dependencies["crypto-js"]).toBeUndefined();
    expect(lock.packages["node_modules/crypto-js"]).toBeUndefined();
    const component = fs.readFileSync(path.join(root, "admin/src/layout/InputCertFile.svelte"), "utf8");
    expect(component).not.toContain("CryptoJS");
    expect(component).toContain("randomHex(64)");
    const helper = fs.readFileSync(path.join(root, "admin/src/util/hash.ts"), "utf8");
    expect(helper).toContain("crypto.getRandomValues(");
    expect(helper).not.toMatch(/Math\.random|Date\.now/);
});

test.each([false, true])("native random challenge preserves its contract (HTTP alias=%s)", async (httpAlias) => {
    const app = await startAdminBrowser({httpAlias});
    try {
        const origin = httpAlias ? app.url.replace("127.0.0.1", "admin.test") : app.url;
        await app.page.goto(`${origin}/test/hash.html`);
        const native = await app.page.evaluate(() => ({secure: isSecureContext,
            subtle: typeof crypto.subtle !== "undefined", random: typeof crypto.getRandomValues}));
        expect(native.secure).toBe(!httpAlias);
        expect(native.subtle).toBe(!httpAlias);
        expect(native.random).toBe("function");
        await app.page.waitForFunction(() => typeof (window as any).randomChallenge === "function", undefined, {timeout: 5000});
        const challenges = await app.page.evaluate(() => [
            (window as any).randomChallenge(64), (window as any).randomChallenge(64),
        ]);
        expect(challenges[0]).toMatch(/^[a-f0-9]{128}$/);
        expect(challenges[1]).toMatch(/^[a-f0-9]{128}$/);
        expect(challenges[0]).not.toBe(challenges[1]);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);
