import fs from "fs";
import path from "path";
import tls from "tls";
import net from "net";
import {once} from "events";
import {setTimeout as delay} from "timers/promises";
import {withConfigurationServer} from "./configuration-revision-fixture";
import {failFileOperation} from "./persistence-fault-fixture";
import {getFreePort} from "../../../helpers/network";
import {generateSelfSignedCert} from "../../../helpers/testCerts";
import {CertificationStore} from "../../../../src/server/CertificationStore";

jest.setTimeout(60000);
const original = generateSelfSignedCert("compound-original"), replacement = generateSelfSignedCert("compound-replacement");
const cert = (bundle: typeof original, name: string) => ({key: {name: `${name}.key`, value: bundle.keyPem}, cert: {name: `${name}.crt`, value: bundle.certPem}, ca: {name: "", value: ""}});
const fingerprint = (port: number) => new Promise<string>((resolve, reject) => {
    // Explicit test-only peer inspection; production certificate policy is untouched.
    const socket = tls.connect({host: "127.0.0.1", port, rejectUnauthorized: false});
    socket.setTimeout(3000, () => socket.destroy(new Error("TLS probe timeout")));
    socket.once("secureConnect", () => { const value = socket.getPeerCertificate().fingerprint256.replace(/:/g, "").toLowerCase(); socket.destroy(); resolve(value); });
    socket.once("error", error => { socket.destroy(); reject(error); });
});
const fileBytes = (root: string) => {
    const result: Record<string, string> = {};
    const read = (directory: string) => {
        for(const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            const file = path.join(directory, entry.name);
            if(entry.isDirectory()) read(file);
            else if(!entry.name.endsWith(".tmp")) {
                let data = fs.readFileSync(file).toString("base64");
                if(entry.name.endsWith(".state.json")) { const state = JSON.parse(fs.readFileSync(file, "utf8")); delete state.lastRollback; data = JSON.stringify(state); }
                result[file] = data;
            }
        }
    };
    read(path.join(root, "config")); read(path.join(root, "cert")); return result;
};
const setup = async (f: any) => {
    const port = await getFreePort(), oldCert = cert(original, `old-${port}`);
    expect((await f.request("POST", `/api/externalCert/${port}`, {certInfo: oldCert})).statusCode).toBe(200);
    const read = await f.snapshot();
    const option = {forwardPort: port, protocol: "tcp", tls: true, destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0};
    expect((await f.request("POST", "/api/tunnelingOption", {...option, expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
    return {port, option, oldCert};
};
const tokens = (f: any) => ({expectedRevision: f.store.revisionState.currentRevision,
    expectedCertificateRevision: CertificationStore.instance.revisionState.currentRevision});

test.each(["new", "rotation", "rename"])("compound %s publishes one matching certificate/configuration and fresh TLS identity", async mode => withConfigurationServer(async f => {
    const existing = mode === "new" ? undefined : await setup(f);
    const port = mode === "rotation" ? existing!.port : await getFreePort();
    const before = tokens(f), nextCert = cert(replacement, `next-${port}`);
    const response = await f.request("POST", "/api/tunnelingOption", {forwardPort: port, protocol: "tcp", tls: true,
        destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0, certInfo: nextCert,
        ...(mode === "rename" ? {previousForwardPort: existing!.port} : {}), ...before});
    expect(response.statusCode).toBe(200);
    expect(await fingerprint(port)).toBe(replacement.fingerprintSha256);
    expect(CertificationStore.instance.getExternalCert(port)).toEqual(nextCert);
    expect(f.store.revisionState.currentRevision).toBe(before.expectedRevision + 1);
    expect(CertificationStore.instance.revisionState.currentRevision).toBe(before.expectedCertificateRevision + 1);
    expect(JSON.parse(response.body).certificateRevisionState.currentRevision).toBe(before.expectedCertificateRevision + 1);
    const yaml = fs.readFileSync(path.join(f.root.rootDir, "config/server.yaml"), "utf8");
    for(const field of ["certInfo", "expectedRevision", "expectedCertificateRevision", "previousForwardPort", "BEGIN PRIVATE", "BEGIN RSA"]) expect(yaml).not.toContain(field);
    if(mode === "rename") {
        expect(f.store.getTunnelingOption(existing!.port)).toBeUndefined();
        expect(CertificationStore.instance.getAllExternalCert()[existing!.port]).toBeUndefined();
        expect(f.tunnel.externalServerStatus(existing!.port).online).toBe(false);
    }
}));

test.each(["stale-config", "stale-cert", "missing-cert", "stale-rename-delete", "missing-rename-delete", "invalid-pem", "mismatched-key", "invalid-ca"])("%s preserves files, revisions and fresh certificate", async mode => withConfigurationServer(async f => {
    const {port, option} = await setup(f), before = tokens(f), bytes = fileBytes(f.root.rootDir);
    const certificate = cert(replacement, `next-${port}`);
    const body: any = {...option, certInfo: certificate, ...before};
    if(mode === "stale-config") body.expectedRevision--;
    if(mode.startsWith("stale") && mode !== "stale-config") body.expectedCertificateRevision--;
    if(mode.startsWith("missing")) delete body.expectedCertificateRevision;
    if(mode.includes("rename-delete")) { body.previousForwardPort = port; body.forwardPort = await getFreePort(); body.tls = false; delete body.certInfo; }
    if(mode === "invalid-pem") body.certInfo.cert.value = "not PEM";
    if(mode === "mismatched-key") body.certInfo.key.value = original.keyPem;
    if(mode === "invalid-ca") body.certInfo.ca = {name: "invalid.ca", value: "not PEM"};
    const response = await f.request("POST", "/api/tunnelingOption", body);
    expect(response.statusCode).toBe(mode.startsWith("stale") ? 409 : 400);
    expect(tokens(f)).toEqual(before); expect(fileBytes(f.root.rootDir)).toEqual(bytes);
    expect(await fingerprint(port)).toBe(original.fingerprintSha256);
}));

test.each(["missing", "stale"])("standalone certificate DELETE requires its %s snapshot token", async mode => withConfigurationServer(async f => {
    const {port} = await setup(f), before = tokens(f), bytes = fileBytes(f.root.rootDir);
    const response = await f.request("DELETE", `/api/externalCert/${port}`, mode === "missing" ? {} : {expectedCertificateRevision: before.expectedCertificateRevision - 1});
    expect(response.statusCode).toBe(mode === "missing" ? 400 : 409);
    expect(tokens(f)).toEqual(before); expect(fileBytes(f.root.rootDir)).toEqual(bytes);
    expect(await fingerprint(port)).toBe(original.fingerprintSha256);
}));

test("rename cannot replace another configured row even when that listener is offline", async () => withConfigurationServer(async f => {
    const a = await setup(f), b = await setup(f);
    await f.tunnel.stopExternalPortServer(b.port);
    const before = tokens(f), bytes = fileBytes(f.root.rootDir);
    const response = await f.request("POST", "/api/tunnelingOption", {...a.option, forwardPort: b.port, previousForwardPort: a.port,
        certInfo: cert(replacement, "conflict"), ...before});
    expect(response.statusCode).toBe(409); expect(tokens(f)).toEqual(before);
    expect(fileBytes(f.root.rootDir)).toEqual(bytes);
    expect(f.tunnel.externalServerStatus(b.port).online).toBe(false);
    expect(await fingerprint(a.port)).toBe(original.fingerprintSha256);
}));

test.each(["stage", "publication", "certificate-metadata", "runtime", "runtime-throw"])("compound %s failure restores both committed domains and actual TLS", async phase => withConfigurationServer(async f => {
    const {port, option} = await setup(f), before = tokens(f), bytes = fileBytes(f.root.rootDir);
    const target = phase === "stage" ? "compound-next.key" : phase === "certificate-metadata" ? ".cert.state.json" : ".externalCert.json";
    const fault = phase.startsWith("runtime") ? undefined : failFileOperation(target, phase === "stage" ? "stage" : "publish");
    const apply = f.tunnel.applyTunnelingOption;
    if(phase.startsWith("runtime")) f.tunnel.applyTunnelingOption = async (...args: any[]) => { await apply.apply(f.tunnel, args); if(phase === "runtime-throw") throw new Error("fixture runtime exception"); return {success: false, partial: true, failedScopes: ["fixture-runtime"], warnings: [], restartRequiredScopes: []}; };
    try {
        const response = await f.request("POST", "/api/tunnelingOption", {...option, certInfo: cert(replacement, "compound-next"), ...before});
        if(fault) expect(fault.hits()).toBe(1);
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
        expect(tokens(f)).toEqual(before); expect(fileBytes(f.root.rootDir)).toEqual(bytes);
        expect(await fingerprint(port)).toBe(original.fingerprintSha256);
    } finally { fault?.close(); f.tunnel.applyTunnelingOption = apply; }
}));

test("concurrent compound edits admit one complete matching revision pair", async () => withConfigurationServer(async f => {
    const {port, option} = await setup(f), before = tokens(f);
    const request = {...option, certInfo: cert(replacement, "concurrent"), ...before};
    const responses = await Promise.all([f.request("POST", "/api/tunnelingOption", request), f.request("POST", "/api/tunnelingOption", request, 1)]);
    expect(responses.map(result => result.statusCode).sort()).toEqual([200, 409]);
    expect(await fingerprint(port)).toBe(replacement.fingerprintSha256);
    expect(tokens(f)).toEqual({expectedRevision: before.expectedRevision + 1, expectedCertificateRevision: before.expectedCertificateRevision + 1});
}));

test("busy rename target rejects before certificate publication", async () => withConfigurationServer(async f => {
    const {port, option} = await setup(f), occupied = net.createServer();
    try {
        occupied.listen(0); await once(occupied, "listening");
        const before = tokens(f), bytes = fileBytes(f.root.rootDir);
        const response = await f.request("POST", "/api/tunnelingOption", {...option, previousForwardPort: port,
            forwardPort: (occupied.address() as net.AddressInfo).port, certInfo: cert(replacement, "busy"), ...before});
        expect(response.statusCode).toBe(400); expect(tokens(f)).toEqual(before);
        expect(fileBytes(f.root.rootDir)).toEqual(bytes); expect(await fingerprint(port)).toBe(original.fingerprintSha256);
    } finally { await new Promise<void>(resolve => occupied.close(() => resolve())); }
}));

test("successful compound save preserves unrelated pending administrator scopes", async () => withConfigurationServer(async f => {
    const {port, option} = await setup(f), first = await f.snapshot();
    expect((await f.request("POST", "/api/serverOption", {...first.serverOption, adminBindHost: "::1", expectedRevision: first.revisionState.currentRevision})).statusCode).toBe(200);
    expect((await f.request("POST", "/api/adminCert", {certInfo: cert(original, "pending-admin")})).statusCode).toBe(200);
    const configState = f.store.revisionState, certState = CertificationStore.instance.revisionState;
    const response = await f.request("POST", "/api/tunnelingOption", {...option, certInfo: cert(replacement, "pending-next"), ...tokens(f)});
    expect(response.statusCode).toBe(200); expect(await fingerprint(port)).toBe(replacement.fingerprintSha256);
    expect(f.store.revisionState.pendingRestartScopes).toEqual(configState.pendingRestartScopes);
    expect(f.store.revisionState.lastKnownGoodRevision).toBe(configState.lastKnownGoodRevision);
    expect(CertificationStore.instance.revisionState.pendingRestartScopes).toEqual(certState.pendingRestartScopes);
    expect(CertificationStore.instance.revisionState.lastKnownGoodRevision).toBe(certState.lastKnownGoodRevision);
}));

test("certificate-only writer waits for compound admission/publication/runtime completion", async () => withConfigurationServer(async f => {
    const {port, option} = await setup(f), before = tokens(f), apply = f.tunnel.applyTunnelingOption;
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => entered = resolve), pause = new Promise<void>(resolve => release = resolve);
    f.tunnel.applyTunnelingOption = async (...args: any[]) => { entered(); await pause; return apply.apply(f.tunnel, args); };
    let compound: Promise<any> | undefined, standalone: Promise<any> | undefined;
    try {
        compound = f.request("POST", "/api/tunnelingOption", {...option, certInfo: cert(replacement, "queued-compound"), ...before});
        await reached;
        let resolved = false;
        const received = once(f.apis[1]._server, "request");
        standalone = f.request("POST", `/api/externalCert/${port}`, {certInfo: cert(original, "queued-standalone")}, 1).then((result: any) => { resolved = true; return result; });
        await received; await delay(30); const interleaved = resolved;
        release(); const first = await compound; expect(first.statusCode).toBe(200);
        expect((await standalone).statusCode).toBe(200); expect(interleaved).toBe(false);
        expect(JSON.parse(first.body).certificateRevisionState.currentRevision).toBe(before.expectedCertificateRevision + 1);
        expect(CertificationStore.instance.revisionState.currentRevision).toBe(before.expectedCertificateRevision + 2);
        expect(await fingerprint(port)).toBe(original.fingerprintSha256);
    } finally { release(); await Promise.allSettled([compound, standalone]); f.tunnel.applyTunnelingOption = apply; }
}));

test.each(["rename", "delete"])("a certificate replaced after the snapshot survives stale %s", async operation => withConfigurationServer(async f => {
    const {port, option} = await setup(f), stale = tokens(f);
    expect((await f.request("POST", `/api/externalCert/${port}`, {certInfo: cert(replacement, "other-writer")})).statusCode).toBe(200);
    const before = tokens(f), bytes = fileBytes(f.root.rootDir);
    const response = operation === "delete"
        ? await f.request("DELETE", `/api/externalCert/${port}`, {expectedCertificateRevision: stale.expectedCertificateRevision})
        : await f.request("POST", "/api/tunnelingOption", {...option, tls: false, forwardPort: await getFreePort(), previousForwardPort: port, ...stale});
    expect(response.statusCode).toBe(409); expect(tokens(f)).toEqual(before);
    expect(fileBytes(f.root.rootDir)).toEqual(bytes); expect(await fingerprint(port)).toBe(replacement.fingerprintSha256);
}));

test("compound restoration failure remains explicit while actual baseline TLS is recovered", async () => withConfigurationServer(async f => {
    const {port, option} = await setup(f), before = tokens(f), apply = f.tunnel.applyTunnelingOption;
    let fault: ReturnType<typeof failFileOperation> | undefined;
    f.tunnel.applyTunnelingOption = async (...args: any[]) => {
        await apply.apply(f.tunnel, args);
        fault = failFileOperation(".externalCert.json", "publish", true);
        return {success: false, partial: true, failedScopes: ["fixture-runtime"], warnings: [], restartRequiredScopes: []};
    };
    try {
        const response = await f.request("POST", "/api/tunnelingOption", {...option, certInfo: cert(replacement, "recovery-fault"), ...before});
        const body = JSON.parse(response.body);
        expect(body).toMatchObject({success: false, partial: true});
        expect(body.failedScopes).toEqual(expect.arrayContaining(["certificate-restore", "configuration-restore"]));
        expect(await fingerprint(port)).toBe(original.fingerprintSha256);
    } finally { fault?.close(); f.tunnel.applyTunnelingOption = apply; }
}));
