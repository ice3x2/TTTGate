import {once} from "events";
import net from "net";
import {setTimeout as delay} from "timers/promises";
import {getFreePort} from "../../../helpers/network";
import UsablePortChecker from "../../../../src/util/UsablePortChecker";
import {withConfigurationServer} from "./configuration-revision-fixture";

jest.setTimeout(45_000);

test("failed asynchronous port validation releases the mutation queue without advancing revision", async () => {
    await withConfigurationServer(async ({store, request, snapshot}) => {
        const occupied = net.createServer();
        occupied.listen(0);
        await once(occupied, "listening");
        try {
        const read = await snapshot();
        const revision = read.revisionState.currentRevision;
        const failed = await request("POST", "/api/serverOption", {...read.serverOption,
            adminPort: (occupied.address() as net.AddressInfo).port, expectedRevision: revision});
        expect(failed.statusCode).toBe(400);
        expect(JSON.parse(failed.body).message).toMatch(/already in use/);
        expect(store.revisionState.currentRevision).toBe(revision);
        const saved = await request("POST", "/api/serverOption", {...read.serverOption,
            adminBindHost: "::1", expectedRevision: revision}, 1);
        expect(saved.statusCode).toBe(200);
        expect(store.revisionState.currentRevision).toBe(revision + 1);
        } finally { await new Promise<void>((resolve) => occupied.close(() => resolve())); }
    });
});

test("configuration mutation requires a positive safe-integer snapshot revision", async () => {
    await withConfigurationServer(async ({store, request, snapshot}) => {
        const read = await snapshot();
        const original = store.serverOption;
        const revision = store.revisionState.currentRevision;
        const codes = [];
        for(const expectedRevision of [undefined, null, "2", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
            codes.push((await request("POST", "/api/serverOption", {...read.serverOption, expectedRevision})).statusCode);
        }
        expect(codes).toEqual(Array(7).fill(400));
        expect(store.serverOption).toEqual(original);
        expect(store.revisionState.currentRevision).toBe(revision);
    });
});

test("stale server updates and stale no-op requests return 409, including PUT", async () => {
    await withConfigurationServer(async ({store, request, snapshot}) => {
        const read = await snapshot();
        const revision = read.revisionState.currentRevision;
        const saved = await request("PUT", "/api/serverOption", {...read.serverOption, adminBindHost: "::1", expectedRevision: revision});
        expect(saved.statusCode).toBe(200);
        expect(JSON.parse(saved.body).revisionState.currentRevision).toBe(revision + 1);
        const stale = await request("POST", "/api/serverOption", {...read.serverOption, expectedRevision: revision});
        expect(stale.statusCode).toBe(409);
        const current = await snapshot();
        expect((await request("PUT", "/api/serverOption", {...current.serverOption, expectedRevision: revision})).statusCode).toBe(409);
        expect(store.serverOption.adminBindHost).toBe("::1");
        expect(store.serverOption.expectedRevision).toBeUndefined();
        expect(store.revisionState.currentRevision).toBe(revision + 1);
    });
});

test("tunnel creation, update and removal share revision admission", async () => {
    await withConfigurationServer(async ({store, tunnel, request, snapshot}) => {
        const revision = (await snapshot()).revisionState.currentRevision;
        const option = {forwardPort: await getFreePort(), destinationAddress: "127.0.0.1", destinationPort: 9,
            protocol: "tcp", tls: false, keepAlive: 0};
        expect((await request("POST", "/api/tunnelingOption", option)).statusCode).toBe(400);
        const added = await request("POST", "/api/tunnelingOption", {...option, expectedRevision: revision});
        expect(added.statusCode).toBe(200);
        const afterAdd = JSON.parse(added.body).revisionState.currentRevision;
        expect((await request("DELETE", "/api/tunnelingOption", {forwardPort: option.forwardPort})).statusCode).toBe(400);
        expect((await request("DELETE", "/api/tunnelingOption", {forwardPort: option.forwardPort, expectedRevision: revision})).statusCode).toBe(409);
        expect(tunnel.externalServerStatus(option.forwardPort).online).toBe(true);
        const updated = await request("PUT", "/api/tunnelingOption", {...option, destinationPort: 10, expectedRevision: afterAdd});
        expect(updated.statusCode).toBe(200);
        const afterUpdate = JSON.parse(updated.body).revisionState.currentRevision;
        expect((await request("DELETE", "/api/tunnelingOption", {forwardPort: option.forwardPort, expectedRevision: afterAdd})).statusCode).toBe(409);
        expect((await request("DELETE", "/api/tunnelingOption", {forwardPort: option.forwardPort, expectedRevision: afterUpdate})).statusCode).toBe(200);
        expect(store.getTunnelingOption(option.forwardPort)).toBeUndefined();
    });
});

test("two admin listeners serialize same-revision requests across async port checks", async () => {
    await withConfigurationServer(async ({store, apis, request, snapshot}) => {
        const read = await snapshot();
        const revision = read.revisionState.currentRevision;
        const firstPort = await getFreePort();
        const secondPort = await getFreePort();
        const original = UsablePortChecker.checkPorts;
        let calls = 0;
        let releaseFirst!: () => void;
        const barrier = new Promise<void>((resolve) => { releaseFirst = resolve; });
        // Explicit scheduling fixture delegates the real port check unchanged.
        UsablePortChecker.checkPorts = async (ports) => {
            calls++;
            if(calls === 1) await barrier;
            return original.call(UsablePortChecker, ports);
        };
        const pending: Array<Promise<any>> = [];
        try {
            pending.push(request("POST", "/api/serverOption", {...read.serverOption, adminPort: firstPort, expectedRevision: revision}));
            const deadline = Date.now() + 5000;
            while(calls === 0 && Date.now() < deadline) await delay(5);
            expect(calls).toBe(1);
            const secondSeen = once((apis[1] as any)._server, "request");
            pending.push(request("POST", "/api/serverOption", {...read.serverOption, adminPort: secondPort, expectedRevision: revision}, 1));
            await secondSeen;
            await delay(25);
            releaseFirst();
            const results = await Promise.all(pending);
            expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
            expect(store.revisionState.currentRevision).toBe(revision + 1);
            expect(store.serverOption.adminPort).toBe(firstPort);
            expect(calls).toBe(1);
        } finally {
            releaseFirst();
            await Promise.allSettled(pending);
            UsablePortChecker.checkPorts = original;
        }
    });
});
