import {withConfigurationServer} from "../component/server/admin/configuration-revision-fixture";
import {configurationFiles, peerFingerprint} from "../component/server/admin/compound-review-fixture";
import {writeWebFixture} from "../helpers/runtime";
import {getFreePort} from "../helpers/network";
import {startAdminBrowser} from "../helpers/adminBrowser";
import {generateSelfSignedCert} from "../helpers/testCerts";
import {CertificationStore} from "../../src/server/CertificationStore";

test.each(["target-stale", "source-stale", "target-fresh"])("rename deletion snapshot survives TLS toggle/refresh: %s", async mode => withConfigurationServer(async f => {
    const sourcePort = await getFreePort(), targetPort = await getFreePort();
    const old = generateSelfSignedCert("rename-old"), later = generateSelfSignedCert("rename-later");
    const certInfo = (bundle: typeof old, name: string) => ({key: {name: `${name}.key`, value: bundle.keyPem},
        cert: {name: `${name}.crt`, value: bundle.certPem}, ca: {name: "", value: ""}});
    expect((await f.request("POST", `/api/externalCert/${sourcePort}`, {certInfo: certInfo(old, "rename-old")})).statusCode).toBe(200);
    expect((await f.request("POST", "/api/tunnelingOption", {forwardPort: sourcePort, protocol: "tcp", tls: true,
        destinationAddress: "127.0.0.1", destinationPort: 9, expectedRevision: f.store.revisionState.currentRevision})).statusCode).toBe(200);
    const app = await startAdminBrowser();
    try {
        await writeWebFixture(f.root.rootDir, "index.html", `<script type="module" src="${app.url}/test/configuration.ts"></script>`);
        await app.page.goto(`http://127.0.0.1:${f.ports[0]}`);
        await app.page.waitForFunction(() => !!(window as any).configurationFixture);
        expect(await app.page.evaluate(async () => (await fetch("/api/login", {method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({key: "revision-password"})})).status)).toBe(200);
        await app.page.evaluate(() => (window as any).configurationFixture.mount("tunnel"));
        await app.page.waitForFunction(() => (document.querySelector('input[type="file"]') as HTMLInputElement)?.files?.length === 1);
        const originalToken = CertificationStore.instance.revisionState.currentRevision;
        if(mode !== "source-stale") await app.page.locator("#input-external-port").fill(String(targetPort));
        if(mode !== "target-fresh") expect((await f.request("POST", `/api/externalCert/${sourcePort}`, {certInfo: certInfo(later, "rename-later")})).statusCode).toBe(200);
        const baseline = {options: f.store.serverOption, revision: f.store.revisionState,
            certificates: CertificationStore.instance.getAllExternalCert(), certificateRevision: CertificationStore.instance.revisionState,
            files: configurationFiles(f.root.rootDir), fingerprint: await peerFingerprint(sourcePort)};
        const refreshed = app.page.waitForResponse(response => new URL(response.url()).pathname === `/api/externalCert/${mode === "source-stale" ? sourcePort : targetPort}`);
        await app.page.locator("#sdf").uncheck();
        await (await refreshed).finished();
        await app.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        if(mode === "source-stale") await app.page.locator("#input-external-port").fill(String(targetPort));
        const saved = app.page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/tunnelingOption");
        await app.page.getByRole("button", {name: "Apply and Restart"}).click();
        const response = await saved;
        expect({status: response.status(), token: response.request().postDataJSON().expectedCertificateRevision})
            .toEqual({status: mode === "target-fresh" ? 200 : 409, token: originalToken});
        if(mode === "target-fresh") {
            expect(f.store.getTunnelingOption(sourcePort)).toBeUndefined();
            expect(CertificationStore.instance.getAllExternalCert()[sourcePort]).toBeUndefined();
            expect(f.store.getTunnelingOption(targetPort)).toMatchObject({tls: false});
            expect(f.store.getTunnelingOption(targetPort)).not.toHaveProperty("originalCertificateRevision");
            expect(f.tunnel.externalServerStatus(targetPort).online).toBe(true);
            return;
        }
        expect({options: f.store.serverOption, revision: f.store.revisionState,
            certificates: CertificationStore.instance.getAllExternalCert(), certificateRevision: CertificationStore.instance.revisionState,
            files: configurationFiles(f.root.rootDir), fingerprint: await peerFingerprint(sourcePort)}).toEqual(baseline);
        expect(f.store.getTunnelingOption(targetPort)).toBeUndefined();
    } finally { await app.close(); }
}), 60_000);
