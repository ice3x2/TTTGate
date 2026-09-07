import {withConfigurationServer} from "../component/server/admin/configuration-revision-fixture";
import {writeWebFixture} from "../helpers/runtime";
import {getFreePort} from "../helpers/network";
import {startAdminBrowser} from "../helpers/adminBrowser";
import {generateSelfSignedCert} from "../helpers/testCerts";
import {CertificationStore} from "../../src/server/CertificationStore";

test("stale TLS editor cannot replace the live certificate before its config conflict", async () => {
    await withConfigurationServer(async ({root, ports, request, snapshot}: any) => {
        const forwardPort = await getFreePort();
        const old = generateSelfSignedCert("old-editor");
        const next = generateSelfSignedCert("new-editor");
        const certInfo = {key: {name: "old.key", value: old.keyPem}, cert: {name: "old.crt", value: old.certPem}, ca: {name: "", value: ""}};
        expect((await request("POST", `/api/externalCert/${forwardPort}`, {certInfo})).statusCode).toBe(200);
        expect((await request("POST", "/api/tunnelingOption", {forwardPort, protocol: "tcp", tls: true,
            destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0,
            expectedRevision: (await snapshot()).revisionState.currentRevision})).statusCode).toBe(200);
        const app = await startAdminBrowser();
        try {
            await writeWebFixture(root.rootDir, "index.html", `<script type="module" src="${app.url}/test/configuration.ts"></script>`);
            await app.page.goto(`http://127.0.0.1:${ports[0]}`);
            await app.page.waitForFunction(() => !!(window as any).configurationFixture);
            expect(await app.page.evaluate(async () => (await fetch("/api/login", {method: "POST",
                headers: {"Content-Type": "application/json"}, body: JSON.stringify({key: "revision-password"})})).status)).toBe(200);
            await app.page.evaluate(() => (window as any).configurationFixture.mount("tunnel"));
            const files = app.page.locator('input[type="file"]');
            await files.first().waitFor();
            await app.page.waitForFunction(() => (document.querySelector('input[type="file"]') as HTMLInputElement)?.files?.length === 1);
            await files.nth(0).setInputFiles({name: "next.key", mimeType: "text/plain", buffer: Buffer.from(next.keyPem)});
            await app.page.getByText("Invalid Key Pair", {exact: true}).waitFor();
            await app.page.getByRole("button", {name: "Ok", exact: true}).click();
            await files.nth(0).setInputFiles({name: "next.key", mimeType: "text/plain", buffer: Buffer.from(next.keyPem)});
            await files.nth(1).setInputFiles({name: "next.crt", mimeType: "text/plain", buffer: Buffer.from(next.certPem)});
            const current = await snapshot();
            expect((await request("POST", "/api/serverOption", {...current.serverOption, adminBindHost: "::1",
                expectedRevision: current.revisionState.currentRevision})).statusCode).toBe(200);
            const responses: Array<{path: string, status: number}> = [];
            app.page.on("response", (res) => {
                if(res.request().method() === "POST") responses.push({path: new URL(res.url()).pathname, status: res.status()});
            });
            await app.page.getByRole("button", {name: "Apply and Restart"}).click();
            await app.page.getByText(/Configuration changed/).first().waitFor();
            console.log(JSON.stringify({responses, certificateChanged: CertificationStore.instance.getExternalCert(forwardPort).cert.value === next.certPem}));
            expect(CertificationStore.instance.getExternalCert(forwardPort).cert.value).toBe(old.certPem);
        } finally { await app.close(); }
    });
}, 60_000);
