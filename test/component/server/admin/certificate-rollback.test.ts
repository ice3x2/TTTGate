import fs from "fs";
import path from "path";
import tls from "tls";
import {withConfigurationServer} from "./configuration-revision-fixture";
import {failFileOperation} from "./persistence-fault-fixture";
import {getFreePort} from "../../../helpers/network";
import {generateSelfSignedCert} from "../../../helpers/testCerts";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import Environment from "../../../../src/Environment";

jest.setTimeout(60_000);
const fingerprint = (port: number) => new Promise<string>((resolve, reject) => {
    const socket = tls.connect({host: "127.0.0.1", port, rejectUnauthorized: false});
    socket.once("secureConnect", () => {
        const value = socket.getPeerCertificate().fingerprint256.replace(/:/g, "").toLowerCase();
        socket.destroy(); resolve(value);
    });
    socket.once("error", (error) => { socket.destroy(); reject(error); });
});
const files = (directory: string): Record<string, string> => {
    const result: Record<string, string> = {};
    for(const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const file = path.join(directory, entry.name);
        if(entry.isDirectory()) Object.assign(result, files(file));
        else if(!entry.name.endsWith(".tmp")) result[file] = fs.readFileSync(file).toString("base64");
    }
    return result;
};

test.each(["stage:.externalCert.json", "stage:next.key", "stage:next.crt", "stage:.cert.state.json",
    ".externalCert.json", "next.key", "next.crt", ".cert.state.json", "runtime", "restore", "success"])("certificate %s outcome preserves committed and applied scope identities", async (target) => {
    await withConfigurationServer(async ({tunnel, request, snapshot}) => {
        const port = await getFreePort();
        const original = generateSelfSignedCert("rollback-original");
        const replacement = generateSelfSignedCert("rollback-replacement");
        const cert = (bundle: ReturnType<typeof generateSelfSignedCert>, name: string) => ({
            key: {name: `${name}.key`, value: bundle.keyPem}, cert: {name: `${name}.crt`, value: bundle.certPem}, ca: {name: "", value: ""},
        });
        expect((await request("POST", "/api/adminCert", {certInfo: cert(original, "pending-admin")})).statusCode).toBe(200);
        expect((await request("POST", `/api/externalCert/${port}`, {certInfo: cert(original, "old")})).statusCode).toBe(200);
        expect((await request("POST", "/api/tunnelingOption", {forwardPort: port, protocol: "tcp", tls: true,
            destinationAddress: "127.0.0.1", destinationPort: 9, expectedRevision: (await snapshot()).revisionState.currentRevision})).statusCode).toBe(200);
        if(target === "runtime") expect((await request("POST", `/api/tunneling/active/${port}`, {active: true, timeout: 60})).statusCode).toBe(200);
        const baselineStatus = {...tunnel.externalServerStatus(port)};
        const baselineCert = CertificationStore.instance.getExternalCert(port);
        const baselineRevision = CertificationStore.instance.revisionState;
        expect(baselineRevision.pendingRestartScopes).toContain("admin-cert");
        expect(baselineRevision.currentRevision).not.toBe(baselineRevision.lastKnownGoodRevision);
        const baselineFiles = files(Environment.path.certDir);
        const baselineFingerprint = await fingerprint(port);
        expect(baselineFingerprint).toBe(original.fingerprintSha256);
        const fault = failFileOperation(target === "restore" ? ".cert.state.json" : target.replace(/^stage:/, ""),
            target.startsWith("stage:") ? "stage" : "publish", target === "restore");
        const apply = tunnel.applyExternalServerCert;
        if(target === "runtime") tunnel.applyExternalServerCert = async (...args: any[]) => {
            await apply.apply(tunnel, args);
            return {success: false, partial: true, failedScopes: [`external-cert:${port}`], warnings: ["declared post-apply fault"], restartRequiredScopes: []};
        };
        let response;
        try { response = await request("POST", `/api/externalCert/${port}`, {certInfo: cert(replacement, "next")}); }
        finally { fault.close(); tunnel.applyExternalServerCert = apply; }
        if(target === "restore") {
            expect(response.statusCode).toBe(500);
            expect(JSON.parse(response.body)).toMatchObject({success: false, partial: true, failedScopes: ["certificate-restore"]});
            expect(CertificationStore.instance.getExternalCert(port)).toEqual(baselineCert);
            expect(await fingerprint(port)).toBe(baselineFingerprint);
            return;
        }
        if(target === "success") {
            expect(response.statusCode).toBe(200);
            expect(CertificationStore.instance.revisionState.pendingRestartScopes).toEqual(baselineRevision.pendingRestartScopes);
            expect(CertificationStore.instance.revisionState.lastKnownGoodRevision).toBe(baselineRevision.lastKnownGoodRevision);
            expect(await fingerprint(port)).toBe(replacement.fingerprintSha256);
            expect(tunnel.captureRuntimeState().external[port].certificateRevision).toBe(CertificationStore.instance.revisionState.currentRevision);
            return;
        }
        expect(fault.hits()).toBe(target === "runtime" ? 0 : 1);
        expect(response.statusCode).toBe(target === "runtime" ? 400 : 500);
        expect(CertificationStore.instance.getExternalCert(port)).toEqual(baselineCert);
        const currentFiles = files(Environment.path.certDir);
        if(target === "runtime") {
            expect({...CertificationStore.instance.revisionState, lastRollback: baselineRevision.lastRollback}).toEqual(baselineRevision);
            expect(CertificationStore.instance.revisionState.lastRollback).toMatchObject({restoredRevision: baselineRevision.currentRevision});
            const stateFile = path.join(Environment.path.certDir, ".cert.state.json");
            const state = JSON.parse(Buffer.from(currentFiles[stateFile], "base64").toString());
            expect({...state, lastRollback: baselineRevision.lastRollback}).toEqual(baselineRevision);
            delete currentFiles[stateFile]; delete baselineFiles[stateFile];
        } else expect(CertificationStore.instance.revisionState).toEqual(baselineRevision);
        expect(currentFiles).toEqual(baselineFiles);
        expect(await fingerprint(port)).toBe(baselineFingerprint);
        if(target === "runtime") {
            const restored = tunnel.externalServerStatus(port);
            expect(restored.active).toBe(baselineStatus.active);
            expect(restored.activeTimeout).toBe(baselineStatus.activeTimeout);
            expect(restored.activeStart).toBe(baselineStatus.activeStart);
        }
    });
});
