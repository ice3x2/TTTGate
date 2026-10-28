import http from "node:http";
import {createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";
import {getFreePort} from "../../helpers/smokeProcess";

// #279 — 켜진 터널의 외부 포트를 바꾸면, 바로 새 포트로 들어온 연결이 대상 서버까지 간다(REQ-2).
jest.setTimeout(120_000);

const get = (port: number): Promise<{status: number; body: string} | {error: string}> => new Promise((resolve) => {
    const req = http.get({host: "127.0.0.1", port, path: "/", agent: false, timeout: 10_000}, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({status: res.statusCode!, body}));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => resolve({error: error.message}));
});

describe("renaming an active tunnel", () => {
    let target: http.Server;
    let harness: ProcessTunnelHarness;

    beforeAll(async () => {
        target = http.createServer((_req, res) => res.end("rename-ok"));
        await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", () => resolve()));
        const targetPort = (target.address() as {port: number}).port;
        harness = await createProcessTunnelHarness({tunnels: [{protocol: "tcp", destinationPort: targetPort}]});
        await harness.waitForTunnelOnline(harness.tunnels[0].forwardPort);
    });

    afterAll(async () => {
        try { await harness?.dispose(); }
        finally { await new Promise<void>((resolve) => { target.closeAllConnections(); target.close(() => resolve()); }); }
    });

    test("forwards a connection on the new port right after the change (REQ-2)", async () => {
        const from = harness.tunnels[0].forwardPort;
        expect(await get(from)).toEqual({status: 200, body: "rename-ok"});

        const list = await harness.adminRequest("/api/tunnelingOption");
        expect(list.status).toBe(200);
        const {ownerId: _ownerId, owner: _owner, editable: _editable, ...stored} = list.json.tunnelingOptions.find((row: any) => row.forwardPort === from);
        const to = await getFreePort();
        const saved = await harness.adminRequest("/api/tunnelingOption", {method: "POST",
            body: {...stored, forwardPort: to, previousForwardPort: from, expectedRevision: list.json.revisionState.currentRevision}});
        expect(saved.status).toBe(200);

        expect(await get(to)).toEqual({status: 200, body: "rename-ok"});
    });
});
