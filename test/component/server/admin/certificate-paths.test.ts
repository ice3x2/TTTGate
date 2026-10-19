import fs from "node:fs";
import path from "node:path";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import Environment from "../../../../src/Environment";
import {withConfigurationServer} from "./configuration-revision-fixture";
import {getFreePort} from "../../../helpers/network";

jest.setTimeout(60_000);

const unsafeNames = ["../sentinel.pem", "..\\sentinel.pem", "/absolute.pem", "\\absolute.pem", "C:\\absolute.pem", "C:relative.pem",
    "\\\\server\\share\\key.pem", "\\\\?\\C:\\key.pem", "\\\\.\\NUL", "key.pem:stream", ".", "..", "NUL", "CON.pem", "COM9.key",
    "LPT¹.pem", "CONIN$", "CONOUT$", "trailing.", "trailing ", "bad\0.pem", "bad\n.pem", "bad?.pem", "<bad>.pem", "bad|name.pem"];

test("preparation rejects unsafe basenames without any OS path access", async () => withConfigurationServer(async () => {
    const store = CertificationStore.instance, original = store.getAdminCert();
    // Namespace/device strings are passed ONLY to preparation, never to file I/O.
    const accepted = unsafeNames.map(name => ({name,
        admin: store.prepareAdminServerCert({...original, key: {...original.key, name}}),
        external: store.prepareExternalServerCert({...original, cert: {...original.cert, name}})}));
    expect(accepted).toEqual(unsafeNames.map(name => ({name, admin: false, external: false})));
    for(const name of ["key.pem", "client-01.key", "인증서 2026.pem", ".local-cert.pem", "my..cert.pem"]) {
        expect(store.prepareExternalServerCert({...original, key: {...original.key, name}, ca: {name: "", value: ""}})).toBe(true);
    }
    expect(store.prepareExternalServerCert({...original, ca: {name: "../sentinel.pem", value: ""}})).toBe(false);
    expect(store.prepareExternalServerCert({...original, key: {...original.key, name: ""}})).toBe(false);
}));

const sentinelAt = (root: string, type: "admin" | "external") => {
    const certRoot = type === "admin" ? Environment.path.adminCertDir : Environment.path.externalCertDir;
    const sentinel = path.resolve(certRoot, "../sentinel.pem");
    // Every actual RED side effect remains inside this newly allocated outer root.
    expect(sentinel.startsWith(path.resolve(root) + path.sep)).toBe(true);
    expect(path.dirname(sentinel)).toBe(path.resolve(root, "cert"));
    fs.writeFileSync(sentinel, "owned sibling sentinel");
    return sentinel;
};

test.each(["admin", "external"] as const)("%s upload cannot overwrite the owned sibling sentinel", async type => withConfigurationServer(async f => {
    const store = CertificationStore.instance, original = store.getAdminCert();
    const sentinel = sentinelAt(f.root.rootDir, type);
    const candidate = {...original, key: {...original.key, name: "../sentinel.pem"}};
    const before = store.revisionState;
    const accepted = type === "admin" ? await store.commitAdminServerCert(candidate) : await store.commitExternalServerCert(18080, candidate);
    expect({accepted, sentinelPreserved: fs.readFileSync(sentinel, "utf8") === "owned sibling sentinel", revisionUnchanged: JSON.stringify(store.revisionState) === JSON.stringify(before)})
        .toEqual({accepted: false, sentinelPreserved: true, revisionUnchanged: true});
}));

test.each(["admin", "external"] as const)("stored unsafe %s name is rejected before snapshot read or deletion", async type => withConfigurationServer(async f => {
    const store = CertificationStore.instance, original = store.getAdminCert();
    const sentinel = sentinelAt(f.root.rootDir, type);
    const unsafe = {...original, key: {...original.key, name: "../sentinel.pem"}};
    // Seed only the owned fixed-name index to model pre-upgrade persisted metadata.
    const index = path.join(Environment.path.certDir, type === "admin" ? ".adminCert.json" : ".externalCert.json");
    fs.writeFileSync(index, JSON.stringify(type === "admin" ? unsafe : {18080: unsafe}));
    if(type === "admin") await store.loadAdminCert(); else await store.loadExternalCert();
    const read = fs.readFileSync;
    let sentinelReads = 0;
    (fs as any).readFileSync = (...args: any[]) => {
        if(path.resolve(String(args[0])) === sentinel) sentinelReads++;
        return (read as any)(...args);
    };
    let snapshot;
    try { snapshot = store.captureCommittedState(); } finally { fs.readFileSync = read; }
    const before = store.revisionState;
    const removed = type === "admin" ? await store.removeForAdminServer() : await store.removeForExternalServer(18080);
    expect({snapshotRejected: snapshot === undefined, sentinelReads, removalRejected: removed === false,
        sentinelPreserved: fs.existsSync(sentinel) && fs.readFileSync(sentinel, "utf8") === "owned sibling sentinel",
        revisionUnchanged: JSON.stringify(store.revisionState) === JSON.stringify(before)})
        .toEqual({snapshotRejected: true, sentinelReads: 0, removalRejected: true, sentinelPreserved: true, revisionUnchanged: true});
}));

test.each(["admin", "external", "compound"])("%s API maps unsafe owned traversal input to 400", async target => withConfigurationServer(async f => {
    const store = CertificationStore.instance, original = store.getAdminCert();
    const port = await getFreePort();
    const sentinel = sentinelAt(f.root.rootDir, target === "admin" ? "admin" : "external");
    const certInfo = {...original, key: {...original.key, name: "../sentinel.pem"}};
    const before = {configuration: f.store.revisionState, certificate: store.revisionState};
    const endpoint = target === "admin" ? "/api/adminCert" : target === "external" ? `/api/externalCert/${port}` : "/api/tunnelingOption";
    const body = target === "compound" ? {forwardPort: port, protocol: "tcp", tls: true, destinationAddress: "127.0.0.1", destinationPort: 9,
        certInfo, expectedRevision: before.configuration.currentRevision, expectedCertificateRevision: before.certificate.currentRevision} : {certInfo};
    const response = await f.request("POST", endpoint, body);
    expect({status: response.statusCode, sentinelPreserved: fs.readFileSync(sentinel, "utf8") === "owned sibling sentinel"}).toEqual({status: 400, sentinelPreserved: true});
    expect({configuration: f.store.revisionState, certificate: store.revisionState}).toEqual(before);
}));

test.each(["delete", "rename"])("%s API refuses an unsafe stored source name before filesystem effects", async operation => withConfigurationServer(async f => {
    const port = await getFreePort(), targetPort = await getFreePort();
    const option = {forwardPort: port, protocol: "tcp", tls: false, destinationAddress: "127.0.0.1", destinationPort: 9};
    expect((await f.request("POST", "/api/tunnelingOption", {...option, expectedRevision: f.store.revisionState.currentRevision})).statusCode).toBe(200);
    const store = CertificationStore.instance, original = store.getAdminCert();
    const sentinel = sentinelAt(f.root.rootDir, "external");
    fs.writeFileSync(path.join(Environment.path.certDir, ".externalCert.json"), JSON.stringify({[port]: {...original, key: {...original.key, name: "../sentinel.pem"}}}));
    await store.loadExternalCert();
    const before = {configuration: f.store.revisionState, certificate: store.revisionState};
    const response = operation === "delete"
        ? await f.request("DELETE", `/api/externalCert/${port}`, {expectedCertificateRevision: before.certificate.currentRevision})
        : await f.request("POST", "/api/tunnelingOption", {...option, forwardPort: targetPort, previousForwardPort: port,
            expectedRevision: before.configuration.currentRevision, expectedCertificateRevision: before.certificate.currentRevision});
    expect(response.statusCode).toBe(400);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("owned sibling sentinel");
    expect({configuration: f.store.revisionState, certificate: store.revisionState}).toEqual(before);
    expect(f.tunnel.externalServerStatus(port).online).toBe(true);
    expect(f.store.getTunnelingOption(targetPort)).toBeUndefined();
}));

test("valid Unicode and dot basenames write exact PEM bytes with an empty optional CA", async () => withConfigurationServer(async () => {
    const store = CertificationStore.instance, original = store.getAdminCert();
    const certInfo = {...original, key: {...original.key, name: "인증서 키.pem"},
        cert: {...original.cert, name: "my..cert.pem"}, ca: {name: "", value: ""}};
    expect(await store.commitExternalServerCert(18080, certInfo)).toBe(true);
    expect(fs.readFileSync(path.join(Environment.path.externalCertDir, certInfo.key.name), "utf8")).toBe(certInfo.key.value);
    expect(fs.readFileSync(path.join(Environment.path.externalCertDir, certInfo.cert.name), "utf8")).toBe(certInfo.cert.value);
    expect(await store.removeForExternalServer(18080)).toBe(true);
    expect(fs.existsSync(path.join(Environment.path.externalCertDir, certInfo.key.name))).toBe(false);
    expect(fs.existsSync(path.join(Environment.path.externalCertDir, certInfo.cert.name))).toBe(false);
}));
