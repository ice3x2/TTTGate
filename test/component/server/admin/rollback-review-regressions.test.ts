import fs from "fs";
import path from "path";
import {once} from "events";
import {setTimeout as delay} from "timers/promises";
import {withConfigurationServer} from "./configuration-revision-fixture";
import {getFreePort, startEchoServer, sendTcpAndReceive, waitFor} from "../../../helpers/network";
import TTTClient from "../../../../src/client/TTTClient";
import {SocketHandler} from "../../../../src/util/SocketHandler";

jest.setTimeout(45000);
const addPort = async (f: any, extras: object = {}) => {
    const read = await f.snapshot(), port = await getFreePort();
    const result = await f.request("POST", "/api/tunnelingOption", {forwardPort: port, protocol: "tcp", tls: false,
        destinationAddress: "127.0.0.1", destinationPort: 9, ...extras, expectedRevision: read.revisionState.currentRevision});
    expect(result.statusCode).toBe(200); return port;
};

test("concurrent successful activation is not undone by another request rollback", async () => withConfigurationServer(async f => {
    const port = await addPort(f);
    expect((await f.request("POST", `/api/tunneling/active/${port}`, {active: false})).statusCode).toBe(200);
    const baseline = await f.snapshot(), apply = f.tunnel.applyServerOption;
    const limit = SocketHandler.maxGlobalMemoryBufferSize;
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => entered = resolve), pause = new Promise<void>(resolve => release = resolve);
    f.tunnel.applyServerOption = async (...args: any[]) => {
        await apply.apply(f.tunnel, args); entered(); await pause;
        return {success: false, partial: true, failedScopes: ["memory-limit"], warnings: [], restartRequiredScopes: []};
    };
    let saving: Promise<any> | undefined, activating: Promise<any> | undefined;
    try {
        saving = f.request("POST", "/api/serverOption", {...baseline.serverOption, globalMemCacheLimit: 129, expectedRevision: baseline.revisionState.currentRevision});
        await reached;
        let replied = false;
        const received = once(f.apis[1]._server, "request");
        activating = f.request("POST", `/api/tunneling/active/${port}`, {active: true, timeout: 0}, 1).then((response: any) => { replied = true; return response; });
        await received; await delay(30); const repliedWhilePaused = replied;
        release(); expect((await saving).statusCode).toBe(400); expect((await activating).statusCode).toBe(200);
        expect(f.tunnel.externalServerStatus(port).active).toBe(true);
        expect(repliedWhilePaused).toBe(false);
    } finally { release(); await Promise.allSettled([saving, activating]); f.tunnel.applyServerOption = apply; SocketHandler.GlobalMemCacheLimit = limit; }
}));

test.each(["allowedClientIds", "allowedClientNames"])("memory-only failed apply restores actual %s access", async field => withConfigurationServer(async f => {
    const echo = await startEchoServer(); let client: TTTClient | undefined;
    const apply = f.tunnel.applyServerOption, limit = SocketHandler.maxGlobalMemoryBufferSize;
    try {
        const initial = await f.snapshot();
        expect((await f.request("POST", "/api/serverOption", {...initial.serverOption,
            trustedClients: [{clientId: "allowed", clientSecret: "rollback-client-secret", displayName: "allowed"}], expectedRevision: initial.revisionState.currentRevision})).statusCode).toBe(200);
        const port = await addPort(f, {destinationPort: echo.port, [field]: ["allowed"]});
        expect((await f.request("POST", `/api/tunneling/active/${port}`, {active: true, timeout: 0})).statusCode).toBe(200);
        client = TTTClient.create({host: "127.0.0.1", port: f.tunnel.tunnelServer.port, key: f.store.serverOption.key,
            tls: false, name: "allowed", clientId: "allowed", clientSecret: "rollback-client-secret", displayName: "allowed", keepAlive: 0});
        client.start();
        await waitFor(() => { if(f.tunnel.clientStatus().length !== 1) throw new Error("client pending"); return true; }, {timeoutMs: 5000, intervalMs: 20});
        const payload = Buffer.from("ACL baseline roundtrip");
        await expect(sendTcpAndReceive(port, payload)).resolves.toEqual(payload);
        const baseline = await f.snapshot();
        f.tunnel.applyServerOption = async (...args: any[]) => {
            await apply.apply(f.tunnel, args);
            return {success: false, partial: true, failedScopes: ["memory-limit"], warnings: [], restartRequiredScopes: []};
        };
        const candidate = f.store.serverOption.tunnelingOptions.map((option: any) => ({...option, [field]: ["denied"]}));
        const result = await f.request("POST", "/api/serverOption", {...baseline.serverOption, globalMemCacheLimit: 129,
            tunnelingOptions: candidate, expectedRevision: baseline.revisionState.currentRevision});
        expect(result.statusCode).toBe(400);
        await expect(sendTcpAndReceive(port, payload)).resolves.toEqual(payload);
    } finally { f.tunnel.applyServerOption = apply; client?.stop(); await echo.close(); SocketHandler.GlobalMemCacheLimit = limit; }
}));

test("cleanup unlink failure retains original publication and restoration failure diagnostics", async () => withConfigurationServer(async f => {
    const read = await f.snapshot(), rename = fs.renameSync, unlink = fs.unlinkSync;
    let published = false, failedPublish = false, failedRestore = false, failedCleanup = false;
    (fs as any).renameSync = (...args: any[]) => {
        const target = path.basename(String(args[1]));
        if(target === ".server.state.json") { failedPublish = true; throw Object.assign(new Error("fixture publication failure"), {code: "EIO"}); }
        if(target === "server.yaml") {
            if(published) { failedRestore = true; throw Object.assign(new Error("fixture restore failure"), {code: "EIO"}); }
            published = true;
        }
        return (rename as any)(...args);
    };
    (fs as any).unlinkSync = (...args: any[]) => {
        if(failedPublish && String(args[0]).endsWith(".tmp")) { failedCleanup = true; throw Object.assign(new Error("fixture cleanup failure"), {code: "EACCES"}); }
        return (unlink as any)(...args);
    };
    try {
        const response = await f.request("POST", "/api/serverOption", {...read.serverOption, adminBindHost: "::1", expectedRevision: read.revisionState.currentRevision});
        expect([failedPublish, failedRestore, failedCleanup]).toEqual([true, true, true]);
        const body = JSON.parse(response.body);
        expect(body.partial).toBe(true);
        expect(body.failedScopes).toContain("configuration-restore");
        expect(body.message).toContain("publication failure");
    } finally { fs.renameSync = rename; fs.unlinkSync = unlink; }
}));

test.each([false, true])("DELETE stop failure preserves rollback diagnostic; diagnostic write fails=%s", async failDiagnostic => withConfigurationServer(async f => {
    const port = await addPort(f), baseline = await f.snapshot();
    const stop = f.tunnel.stopExternalPortServer, rename = fs.renameSync;
    let publications = 0;
    f.tunnel.stopExternalPortServer = async (...args: any[]) => { await stop.apply(f.tunnel, args); return false; };
    (fs as any).renameSync = (...args: any[]) => {
        if(path.basename(String(args[1])) === ".server.state.json" && ++publications === 3 && failDiagnostic)
            throw Object.assign(new Error("fixture delete diagnostic failure"), {code: "EIO"});
        return (rename as any)(...args);
    };
    try {
        const result = await f.request("DELETE", "/api/tunnelingOption", {forwardPort: port, expectedRevision: baseline.revisionState.currentRevision});
        const body = JSON.parse(result.body);
        expect(result.statusCode).toBe(400);
        expect(f.tunnel.externalServerStatus(port).online).toBe(true);
        if(failDiagnostic) {
            expect(body.partial).toBe(true);
            expect(body.failedScopes).toContain("configuration-rollback-metadata");
        } else {
            expect(f.store.revisionState.lastRollback).toMatchObject({restoredRevision: baseline.revisionState.currentRevision, failedScopes: [`external-listener:${port}`]});
            const state = JSON.parse(fs.readFileSync(path.join(f.root.rootDir, "config/.server.state.json"), "utf8"));
            expect(state.lastRollback).toEqual(f.store.revisionState.lastRollback);
        }
    } finally { fs.renameSync = rename; f.tunnel.stopExternalPortServer = stop; }
}));
