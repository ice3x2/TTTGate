import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {withConfigurationServer} from "./configuration-revision-fixture";
import {peerFingerprint} from "./compound-review-fixture";
import {getFreePort, startEchoServer} from "../../../helpers/network";
import {generateSelfSignedCert} from "../../../helpers/testCerts";
import {CertificationStore} from "../../../../src/server/CertificationStore";

jest.setTimeout(60_000);
const certificate = generateSelfSignedCert("normalized-apply");
const certInfo = (port: number) => ({key: {name: `normalized-${port}.key`, value: certificate.keyPem},
    cert: {name: `normalized-${port}.crt`, value: certificate.certPem}, ca: {name: "", value: ""}});
const save = (f: any, mode: string, option: any) => f.request("POST", "/api/tunnelingOption", {...option,
    expectedRevision: f.store.revisionState.currentRevision,
    ...(mode === "compound" ? {certInfo: certInfo(option.forwardPort),
        expectedCertificateRevision: CertificationStore.instance.revisionState.currentRevision} : {})});
const installCertificate = async (f: any, port: number) => {
    expect((await f.request("POST", `/api/externalCert/${port}`, {certInfo: certInfo(port)})).statusCode).toBe(200);
};
const fingerprint = async (port: number) => (await peerFingerprint(port)).replace(/:/g, "").toLowerCase();

test.each(["ordinary", "compound"])("%s omitted HTTPS tls applies a real TLS listener matching committed configuration", async mode => withConfigurationServer(async f => {
    const service = await startEchoServer();
    try {
        const port = await getFreePort();
        if(mode === "ordinary") await installCertificate(f, port);
        const response = await save(f, mode, {forwardPort: port, protocol: "https", destinationAddress: "127.0.0.1", destinationPort: service.port});
        expect(response.statusCode).toBe(200);
        const stored = f.store.getTunnelingOption(port);
        expect(stored.tls).toBe(true);
        const disk = YAML.parse(fs.readFileSync(path.join(f.root.rootDir, "config/server.yaml"), "utf8"));
        expect(disk.tunnelingOptions.find((option: any) => option.forwardPort === port).tls).toBe(true);
        expect(await fingerprint(port)).toBe(certificate.fingerprintSha256);
        expect(f.tunnel.captureRuntimeState().external[port].option).toEqual(stored);
    } finally { await service.close(); }
}));

test.each([["ordinary", "http", 80], ["ordinary", "https", 443], ["compound", "http", 80], ["compound", "https", 443]])(
    "%s %s omitted defaults reach applied metadata without any default-port connection", async (mode, protocol, destinationPort) => withConfigurationServer(async f => {
        const port = await getFreePort();
        if(mode === "ordinary") await installCertificate(f, port);
        const response = await save(f, String(mode), {forwardPort: port, protocol, destinationAddress: "127.0.0.1"});
        expect(response.statusCode).toBe(200);
        const stored = f.store.getTunnelingOption(port);
        expect(stored).toMatchObject({destinationPort, bufferLimitOnServer: 8, bufferLimitOnClient: 8, keepAlive: -1,
            httpOption: {rewriteHostInTextBody: false, replaceAccessControlAllowOrigin: false}});
        expect(f.tunnel.captureRuntimeState().external[port].option).toEqual(stored);
        // No clients or external sessions are opened in omitted-80/443 cases.
        expect(f.tunnel.clientStatus()).toEqual([]);
        expect(f.tunnel.externalServerStatus(port).sessions).toBe(0);
    }));

test.each(["ordinary", "compound"])("%s explicit TCP values survive initial save and edit", async mode => withConfigurationServer(async f => {
    const service = await startEchoServer();
    try {
        const port = await getFreePort();
        const option = {forwardPort: port, protocol: "tcp", tls: false, destinationAddress: "127.0.0.1", destinationPort: service.port,
            keepAlive: 0, bufferLimitOnServer: 4, bufferLimitOnClient: 5};
        expect((await save(f, mode, option)).statusCode).toBe(200);
        expect(f.tunnel.captureRuntimeState().external[port].option).toMatchObject(option);
        expect((await save(f, mode, {...option, bufferLimitOnServer: 6})).statusCode).toBe(200);
        expect(f.tunnel.captureRuntimeState().external[port].option).toMatchObject({...option, bufferLimitOnServer: 6});
        expect(f.store.getTunnelingOption(port)).toMatchObject({...option, bufferLimitOnServer: 6});
    } finally { await service.close(); }
}));

test.each(["ordinary", "compound"])("%s failed apply retains pending committed state and previous TLS identity", async mode => withConfigurationServer(async f => {
    const service = await startEchoServer();
    try {
        const port = await getFreePort();
        await installCertificate(f, port);
        expect((await save(f, "ordinary", {forwardPort: port, protocol: "tcp", tls: true,
            destinationAddress: "127.0.0.1", destinationPort: service.port, keepAlive: 0})).statusCode).toBe(200);
        const current = await f.snapshot();
        expect((await f.request("POST", "/api/serverOption", {...current.serverOption, adminBindHost: "::1",
            expectedRevision: current.revisionState.currentRevision})).statusCode).toBe(200);
        const before = {options: f.store.serverOption, revision: f.store.revisionState,
            certificates: CertificationStore.instance.getAllExternalCert(), certificateRevision: CertificationStore.instance.revisionState,
            yaml: fs.readFileSync(path.join(f.root.rootDir, "config/server.yaml"), "utf8")};
        expect(before.revision.currentRevision).not.toBe(before.revision.lastKnownGoodRevision);
        const apply = f.tunnel.applyTunnelingOption;
        // Declared post-apply failure delegates real listener work before failing.
        f.tunnel.applyTunnelingOption = async (...args: any[]) => {
            await apply.apply(f.tunnel, args);
            return {success: false, partial: true, failedScopes: ["fixture-apply"], warnings: [], restartRequiredScopes: []};
        };
        try {
            expect((await save(f, mode, {forwardPort: port, protocol: "https", destinationAddress: "127.0.0.1", destinationPort: service.port})).statusCode).toBe(400);
        } finally { f.tunnel.applyTunnelingOption = apply; }
        expect(f.store.serverOption).toEqual(before.options);
        expect({...f.store.revisionState, lastRollback: before.revision.lastRollback}).toEqual(before.revision);
        expect(CertificationStore.instance.getAllExternalCert()).toEqual(before.certificates);
        expect({...CertificationStore.instance.revisionState, lastRollback: before.certificateRevision.lastRollback}).toEqual(before.certificateRevision);
        expect(fs.readFileSync(path.join(f.root.rootDir, "config/server.yaml"), "utf8")).toBe(before.yaml);
        expect(await fingerprint(port)).toBe(certificate.fingerprintSha256);
    } finally { await service.close(); }
}));
