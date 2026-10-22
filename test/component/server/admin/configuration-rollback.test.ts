import fs from "fs";
import path from "path";
import net from "net";
import {once} from "events";
import {withConfigurationServer} from "./configuration-revision-fixture";
import {getFreePort} from "../../../helpers/network";
import {SocketHandler} from "../../../../src/util/SocketHandler";
import UsablePortChecker from "../../../../src/util/UsablePortChecker";

jest.setTimeout(60_000);

import {failFileOperation} from "./persistence-fault-fixture";

test.each(["stage", "publish", "metadata"] as const)("%s failure preserves acknowledged pending state and actual control listener", async (phase) => {
    await withConfigurationServer(async ({root, store, tunnel, request, snapshot}) => {
        const initial = await snapshot();
        expect((await request("POST", "/api/serverOption", {...initial.serverOption,
            adminBindHost: "::1", expectedRevision: initial.revisionState.currentRevision})).statusCode).toBe(200);
        const baseline = await snapshot();
        expect(baseline.revisionState.currentRevision).not.toBe(baseline.revisionState.lastKnownGoodRevision);
        const option = store.serverOption;
        const revision = store.revisionState;
        const oldPort = tunnel.tunnelServer.port;
        const configPath = path.join(root.rootDir, "config/server.yaml");
        const statePath = path.join(root.rootDir, "config/.server.state.json");
        const configBytes = fs.readFileSync(configPath);
        const stateBytes = fs.readFileSync(statePath);
        const fault = failFileOperation(phase === "stage" ? "server.yaml" : phase === "metadata" ? ".server.state.json" : "server.yaml",
            phase === "stage" ? "stage" : "publish");
        let response;
        try {
            response = await request("POST", "/api/serverOption", {...baseline.serverOption,
                port: await getFreePort(), expectedRevision: revision.currentRevision});
        } finally { fault.close(); }
        expect(fault.hits()).toBe(1);
        expect(response.statusCode).toBe(500);
        expect(store.serverOption).toEqual(option);
        expect(store.revisionState).toEqual(revision);
        expect(fs.readFileSync(configPath)).toEqual(configBytes);
        expect(fs.readFileSync(statePath)).toEqual(stateBytes);
        expect(tunnel.tunnelServer.port).toBe(oldPort);
        const socket = net.connect(oldPort, "127.0.0.1");
        try { await once(socket, "connect"); } finally { socket.destroy(); }
    });
});

test("successful tunnel change retains an unrelated acknowledged pending admin scope", async () => {
    await withConfigurationServer(async ({store, request, snapshot}) => {
        const initial = await snapshot();
        expect((await request("POST", "/api/serverOption", {...initial.serverOption,
            adminBindHost: "::1", expectedRevision: initial.revisionState.currentRevision})).statusCode).toBe(200);
        const baseline = await snapshot();
        const saved = await request("POST", "/api/tunnelingOption", {forwardPort: await getFreePort(), protocol: "tcp",
            destinationAddress: "127.0.0.1", destinationPort: 9, tls: false,
            expectedRevision: baseline.revisionState.currentRevision});
        expect(saved.statusCode).toBe(200);
        expect(store.revisionState.pendingRestartScopes).toEqual(baseline.revisionState.pendingRestartScopes);
        expect(store.revisionState.lastKnownGoodRevision).toBe(baseline.revisionState.lastKnownGoodRevision);
        expect(store.serverOption.adminBindHost).toBe("::1");
    });
});

test("runtime bind failure restores actual memory limit and pending committed identity", async () => {
    await withConfigurationServer(async ({store, tunnel, request, snapshot}) => {
        const first = await snapshot();
        await request("POST", "/api/serverOption", {...first.serverOption, adminBindHost: "::1", expectedRevision: first.revisionState.currentRevision});
        const baseline = await snapshot();
        const beforeOption = store.serverOption;
        const beforeRevision = store.revisionState;
        const beforeLimit = SocketHandler.maxGlobalMemoryBufferSize;
        const oldPort = tunnel.tunnelServer.port;
        const nextPort = await getFreePort();
        const occupied = net.createServer();
        const check = UsablePortChecker.checkPorts;
        UsablePortChecker.checkPorts = async (ports) => {
            const result = await check(ports);
            if(ports.includes(nextPort)) { occupied.listen(nextPort); await once(occupied, "listening"); }
            return result;
        };
        let response;
        let observedLimit: number;
        try {
            response = await request("POST", "/api/serverOption", {...baseline.serverOption,
                port: nextPort, globalMemCacheLimit: 129, expectedRevision: baseline.revisionState.currentRevision});
            observedLimit = SocketHandler.maxGlobalMemoryBufferSize;
        } finally {
            UsablePortChecker.checkPorts = check;
            await new Promise<void>((resolve) => occupied.close(() => resolve()));
            SocketHandler.GlobalMemCacheLimit = beforeLimit;
        }
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
        expect(observedLimit!).toBe(beforeLimit);
        expect(store.serverOption).toEqual(beforeOption);
        expect({...store.revisionState, lastRollback: beforeRevision.lastRollback}).toEqual(beforeRevision);
        expect(store.revisionState.lastRollback).toMatchObject({restoredRevision: beforeRevision.currentRevision, failedScopes: ['tunnel-control']});
        expect(tunnel.tunnelServer.port).toBe(oldPort);
    });
});

test("a failed restoration is reported as partial failure, never a completed rollback", async () => {
    await withConfigurationServer(async ({request, snapshot}) => {
        const read = await snapshot();
        const fault = failFileOperation(".server.state.json", "publish", true);
        let response;
        try {
            response = await request("POST", "/api/serverOption", {...read.serverOption,
                adminBindHost: "::1", expectedRevision: read.revisionState.currentRevision});
        } finally { fault.close(); }
        const body = JSON.parse(response.body);
        expect(response.statusCode).toBe(500);
        expect(body.success).toBe(false);
        expect(body.partial).toBe(true);
        expect(body.failedScopes).toContain("configuration-restore");
    });
});

test("failed removal persistence leaves the previously configured listener online", async () => {
    await withConfigurationServer(async ({store, tunnel, request, snapshot}) => {
        const port = await getFreePort();
        const first = await snapshot();
        expect((await request("POST", "/api/tunnelingOption", {forwardPort: port, protocol: "tcp", tls: false,
            destinationAddress: "127.0.0.1", destinationPort: 9, expectedRevision: first.revisionState.currentRevision})).statusCode).toBe(200);
        const option = store.serverOption;
        const revision = store.revisionState;
        const fault = failFileOperation("server.yaml", "stage");
        let response;
        try { response = await request("DELETE", "/api/tunnelingOption", {forwardPort: port, expectedRevision: revision.currentRevision}); }
        finally { fault.close(); }
        expect(response.statusCode).toBe(500);
        expect(store.serverOption).toEqual(option);
        expect(store.revisionState).toEqual(revision);
        expect(tunnel.externalServerStatus(port).online).toBe(true);
    });
});

test("recovering a memory-only apply failure preserves the unaffected control listener instance", async () => {
    await withConfigurationServer(async ({tunnel, request, snapshot}) => {
        const read = await snapshot();
        const control = tunnel.tunnelServer;
        const limit = SocketHandler.maxGlobalMemoryBufferSize;
        const apply = tunnel.applyServerOption;
        tunnel.applyServerOption = async (...args: any[]) => {
            await apply.apply(tunnel, args);
            return {success: false, partial: true, failedScopes: ["memory-limit"], restartRequiredScopes: [], warnings: []};
        };
        try {
            const result = await request("POST", "/api/serverOption", {...read.serverOption, globalMemCacheLimit: 129,
                expectedRevision: read.revisionState.currentRevision});
            expect(result.statusCode).toBe(400);
            expect(SocketHandler.maxGlobalMemoryBufferSize).toBe(limit);
            expect(tunnel.tunnelServer).toBe(control);
        } finally { tunnel.applyServerOption = apply; SocketHandler.GlobalMemCacheLimit = limit; }
    });
});

test("failure to persist rollback diagnostics remains visible after successful baseline restoration", async () => {
    await withConfigurationServer(async ({root, store, tunnel, request, snapshot}) => {
        const initial = await snapshot();
        await request("POST", "/api/serverOption", {...initial.serverOption, adminBindHost: "::1", expectedRevision: initial.revisionState.currentRevision});
        const baseline = await snapshot();
        const stateFile = path.join(root.rootDir, "config/.server.state.json");
        const stateBytes = fs.readFileSync(stateFile);
        const control = tunnel.tunnelServer;
        const limit = SocketHandler.maxGlobalMemoryBufferSize;
        const apply = tunnel.applyServerOption;
        const rename = fs.renameSync;
        let statePublications = 0;
        (fs as any).renameSync = (...args: any[]) => {
            // Candidate publication, exact baseline restoration, then diagnostic.
            if(path.basename(String(args[1])) === ".server.state.json" && ++statePublications === 3)
                throw Object.assign(new Error("fixture diagnostic publication EIO"), {code: "EIO"});
            return (rename as any)(...args);
        };
        tunnel.applyServerOption = async (...args: any[]) => {
            await apply.apply(tunnel, args);
            return {success: false, partial: true, failedScopes: ["memory-limit"], restartRequiredScopes: [], warnings: []};
        };
        try {
            const result = await request("POST", "/api/serverOption", {...baseline.serverOption, globalMemCacheLimit: 129,
                expectedRevision: baseline.revisionState.currentRevision});
            expect(statePublications).toBe(3);
            expect(JSON.parse(result.body)).toMatchObject({success: false, partial: true,
                failedScopes: ["memory-limit", "configuration-rollback-metadata"]});
            expect(store.revisionState).toEqual(baseline.revisionState);
            expect(fs.readFileSync(stateFile)).toEqual(stateBytes);
            expect(SocketHandler.maxGlobalMemoryBufferSize).toBe(limit);
            expect(tunnel.tunnelServer).toBe(control);
        } finally { fs.renameSync = rename; tunnel.applyServerOption = apply; SocketHandler.GlobalMemCacheLimit = limit; }
    });
});
