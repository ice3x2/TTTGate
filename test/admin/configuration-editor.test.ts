import {withConfigurationServer} from "../component/server/admin/configuration-revision-fixture";
import {writeWebFixture} from "../helpers/runtime";
import {getFreePort} from "../helpers/network";
import {startAdminBrowser} from "../helpers/adminBrowser";
import {generateSelfSignedCert} from "../helpers/testCerts";

jest.setTimeout(60_000);

test("server editor submits its held revision after another controller read and retains the stale draft", async () => {
    await withConfigurationServer(async ({root, ports, request, snapshot}: any) => {
        const app = await startAdminBrowser();
        try {
            await writeWebFixture(root.rootDir, "index.html", `<script type="module" src="${app.url}/test/configuration.ts"></script>`);
            await app.page.goto(`http://127.0.0.1:${ports[0]}`);
            await app.page.waitForFunction(() => !!(window as any).configurationFixture);
            expect(await app.page.evaluate(async () => (await fetch("/api/login", {method: "POST",
                headers: {"Content-Type": "application/json"}, body: JSON.stringify({key: "revision-password"})})).status)).toBe(200);
            const read = await snapshot();
            await app.page.evaluate(() => (window as any).configurationFixture.mount("server"));
            const input = app.page.locator("#input-admin-port");
            await input.waitFor();
            const draftPort = await getFreePort();
            await input.fill(String(draftPort));
            expect((await request("POST", "/api/serverOption", {...read.serverOption, adminBindHost: "::1",
                expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
            await app.page.evaluate(() => (window as any).configurationFixture.controller.getServerOption());
            const sent: any[] = [];
            app.page.on("request", (req) => { if(req.method() === "POST") sent.push(req.postDataJSON()); });
            await app.page.getByRole("button", {name: "Apply", exact: true}).click();
            await app.page.getByText(/Configuration changed/).waitFor();
            expect(sent).toHaveLength(1);
            expect(sent[0].expectedRevision).toBe(read.revisionState.currentRevision);
            expect(await input.inputValue()).toBe(String(draftPort));
            expect((await snapshot()).serverOption.adminPort).toBe(read.serverOption.adminPort);
        } finally { await app.close(); }
    });
});

test.each([[false, true], [true, true], [false, false]])("old-port replacement retains revisions and stops on conflict (certificate=%s, stale=%s)", async (withCertificate, stale) => {
    await withConfigurationServer(async ({root, ports, request, snapshot}: any) => {
        const oldPort = await getFreePort();
        const newPort = await getFreePort();
        const revision = (await snapshot()).revisionState.currentRevision;
        if(withCertificate) {
            const bundle = generateSelfSignedCert("revision-editor");
            expect((await request("POST", `/api/externalCert/${oldPort}`, {certInfo: {
                key: {name: "editor.key", value: bundle.keyPem}, cert: {name: "editor.crt", value: bundle.certPem},
                ca: {name: "", value: ""},
            }})).statusCode).toBe(200);
        }
        const added = await request("POST", "/api/tunnelingOption", {forwardPort: oldPort,
            protocol: "tcp", tls: false, destinationAddress: "127.0.0.1", destinationPort: 9,
            keepAlive: 0, inactiveOnStartup: true, expectedRevision: revision});
        expect(added.statusCode).toBe(200);
        const app = await startAdminBrowser();
        try {
            await writeWebFixture(root.rootDir, "index.html", `<script type="module" src="${app.url}/test/configuration.ts"></script>`);
            await app.page.goto(`http://127.0.0.1:${ports[0]}`);
            await app.page.waitForFunction(() => !!(window as any).configurationFixture);
            expect(await app.page.evaluate(async () => (await fetch("/api/login", {method: "POST",
                headers: {"Content-Type": "application/json"}, body: JSON.stringify({key: "revision-password"})})).status)).toBe(200);
            await app.page.evaluate(() => (window as any).configurationFixture.mount("tunnel"));
            await app.page.locator("#input-external-port").waitFor();
            await app.page.locator("#input-external-port").fill(String(newPort));
            const current = await snapshot();
            if(stale) expect((await request("POST", "/api/serverOption", {...current.serverOption,
                adminBindHost: "::1", expectedRevision: current.revisionState.currentRevision})).statusCode).toBe(200);
            const mutations: string[] = [];
            const revisions: number[] = [];
            app.page.on("request", (req) => {
                if(["POST", "DELETE"].includes(req.method())) {
                    mutations.push(`${req.method()} ${new URL(req.url()).pathname}`);
                    revisions.push(req.postDataJSON()?.expectedRevision);
                }
            });
            await app.page.getByRole("button", {name: "Apply and Restart"}).click();
            await app.page.getByText(stale ? /Fail/ : /Success to apply/).first().waitFor();
            expect(mutations).toEqual(stale ? ["DELETE /api/tunnelingOption"] : ["DELETE /api/tunnelingOption", "POST /api/tunnelingOption"]);
            expect(revisions).toEqual(stale ? [current.revisionState.currentRevision] : [current.revisionState.currentRevision, current.revisionState.currentRevision + 1]);
            expect(await app.page.locator("#input-external-port").inputValue()).toBe(String(newPort));
            const final = JSON.parse((await request("GET", "/api/tunnelingOption")).body);
            expect(final.tunnelingOptions.map((option: any) => option.forwardPort)).toEqual([stale ? oldPort : newPort]);
            await app.page.evaluate(() => (window as any).configurationFixture.unmount());
        } finally { await app.close(); }
    });
});
