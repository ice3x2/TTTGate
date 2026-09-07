import {startAdminBrowser} from "../helpers/adminBrowser";
import {generateSelfSignedCert} from "../helpers/testCerts";

const empty = () => ({key: {name: "", value: ""}, cert: {name: "", value: ""}, ca: {name: "", value: ""}});
const bundle = generateSelfSignedCert("certificate-lifecycle");
const saved = () => ({key: {name: "saved-key.pem", value: bundle.keyPem},
    cert: {name: "saved-cert.pem", value: bundle.certPem}, ca: {name: "", value: ""}});

test("certificate component mounts and unmounts without update-depth errors", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.goto(`${app.url}/test/certificate.html`);
        expect(app.errors).toEqual([]);
        expect(await app.page.locator('input[type="file"]').count()).toBe(3);
        await app.page.evaluate(() => (window as any).unmountFixture());
        expect(await app.page.locator('input[type="file"]').count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

test("partial file edits survive component and unrelated parent updates until the pair is complete", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.goto(`${app.url}/test/certificate.html`);
        expect(app.errors).toEqual([]);
        const files = app.page.locator('input[type="file"]');
        await files.nth(0).setInputFiles({name: "draft-key.pem", mimeType: "application/x-pem-file", buffer: Buffer.from(bundle.keyPem)});
        await app.page.getByRole("button", {name: "Parent redraw"}).click();
        await files.nth(1).setInputFiles({name: "invalid.pem", mimeType: "text/plain", buffer: Buffer.from("invalid certificate")});
        await app.page.getByText("Invalid certificate", {exact: true}).waitFor({state: "visible"});
        await app.page.getByRole("button", {name: "Ok", exact: true}).click();
        expect(await files.nth(0).evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe("draft-key.pem");
        expect(await app.page.locator("#updates").textContent()).toBe("0");
        // Equivalent replacement props must not erase an unfinished user edit.
        await app.page.evaluate((value) => (window as any).certificateFixture.replace(value), empty());
        await files.nth(1).setInputFiles({name: "draft-cert.pem", mimeType: "application/x-pem-file", buffer: Buffer.from(bundle.certPem)});
        await app.page.waitForFunction(() => document.querySelector("#updates")?.textContent === "1");
        const value = JSON.parse((await app.page.locator("#certificate").textContent())!);
        expect(value.key).toEqual({name: "draft-key.pem", value: bundle.keyPem});
        expect(value.cert).toEqual({name: "draft-cert.pem", value: bundle.certPem});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

test("changed parent props refresh native files, including in-place updates and clearing", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.addInitScript((value) => { (window as any).initialCertificate = value; }, saved());
        await app.page.goto(`${app.url}/test/certificate.html`);
        expect(app.errors).toEqual([]);
        const files = app.page.locator('input[type="file"]');
        expect(await files.nth(0).evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe("saved-key.pem");
        const replacement = saved();
        replacement.key.name = "replacement-key.pem";
        await app.page.evaluate((value) => (window as any).certificateFixture.replace(value), replacement);
        await app.page.waitForFunction(() => (document.querySelector('input[type="file"]') as HTMLInputElement)?.files?.[0]?.name === "replacement-key.pem");
        expect(await files.nth(1).evaluate((input: HTMLInputElement) => input.files![0].text())).toBe(bundle.certPem);
        const mutated = saved();
        mutated.key.name = "mutated-key.pem";
        await app.page.evaluate((value) => (window as any).certificateFixture.mutate(value), mutated);
        await app.page.waitForFunction(() => (document.querySelector('input[type="file"]') as HTMLInputElement)?.files?.[0]?.name === "mutated-key.pem");
        await app.page.evaluate((value) => (window as any).certificateFixture.replace(value), empty());
        await app.page.waitForFunction(() => Array.from(document.querySelectorAll('input[type="file"]')).every((input: HTMLInputElement) => input.files!.length === 0));
        expect(await app.page.locator("#updates").textContent()).toBe("0");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

test("related Gauge and Timer lifecycle paths mount, update and unmount under Svelte 5", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.goto(`${app.url}/test/certificate.html?auxiliary`);
        expect(app.errors).toEqual([]);
        await app.page.evaluate(() => (window as any).certificateFixture.updateAuxiliary());
        await app.page.waitForFunction(() => document.querySelector(".percent-box")?.textContent?.includes("50"));
        expect(await app.page.locator(".time-text").textContent()).toMatch(/\d+m.*\d+s/);
        await app.page.evaluate(() => (window as any).unmountFixture());
        expect(await app.page.locator(".percent-box").count()).toBe(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

test("a null parent certificate clears native file inputs without a lifecycle error", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.addInitScript((value) => { (window as any).initialCertificate = value; }, saved());
        await app.page.goto(`${app.url}/test/certificate.html`);
        await app.page.evaluate(() => (window as any).certificateFixture.replace(null));
        await app.page.waitForFunction(() => Array.from(document.querySelectorAll('input[type="file"]')).every((input: HTMLInputElement) => input.files!.length === 0), undefined, {timeout: 3000});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);
