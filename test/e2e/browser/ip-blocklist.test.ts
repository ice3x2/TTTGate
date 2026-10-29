import http from "http";
import {startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";

jest.setTimeout(120_000);

// #286 — 관리자 차단 목록이 실제 서버 프로세스의 터널 연결을 막고, 서버를 다시 시작해도 남는지 본다.

/** 터널로 GET 을 보내 상태 코드를 돌려준다. 연결이 응답 없이 끊기면 "closed" 다. */
const fetchStatus = (port: number): Promise<number | "closed"> => new Promise((resolve) => {
    const req = http.get({host: "127.0.0.1", port, path: "/", agent: false, timeout: 5000}, (res) => {
        res.resume();
        res.once("end", () => resolve(res.statusCode ?? 0));
    });
    req.once("timeout", () => req.destroy(new Error("timeout")));
    req.once("error", () => resolve("closed"));
});

describe("ip-blocklist e2e", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;
    let tcpPort: number;
    let httpPort: number;

    beforeAll(async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({
            tunnels: [{protocol: "tcp", destinationPort: target.port}, {protocol: "http", destinationPort: target.port}]
        });
        tcpPort = harness.tunnels[0].forwardPort;
        httpPort = harness.tunnels[1].forwardPort;
        await harness.waitForTunnelOnline(tcpPort);
        await harness.waitForTunnelOnline(httpPort);
    });

    afterAll(async () => {
        try {
            await harness?.dispose();
        } finally {
            await target?.close();
        }
    });

    it("넣은 주소는 TCP·HTTP 터널에서 거절되고, 서버를 다시 시작해도 남으며, 풀면 다시 들어온다", async () => {
        expect(await fetchStatus(tcpPort)).toBe(200);
        expect(await fetchStatus(httpPort)).toBe(200);

        const added = await harness.adminRequest("/api/security/blocklist", {method: "POST", body: {address: "127.0.0.1"}});
        expect(added.status).toBe(201);
        expect(await fetchStatus(tcpPort)).toBe("closed");
        expect(await fetchStatus(httpPort)).toBe("closed");

        await harness.restartServer();
        await harness.waitForTunnelOnline(tcpPort);
        await harness.waitForTunnelOnline(httpPort);
        // 관리 화면에는 적용하지 않으므로 같은 주소로 관리 API 를 계속 쓸 수 있다(REQ-3 AC-3).
        const listed = await harness.adminRequest("/api/security/blocklist");
        expect(listed.status).toBe(200);
        expect(listed.json.entries.map((entry: {address: string}) => entry.address)).toEqual(["127.0.0.1"]);
        expect(await fetchStatus(tcpPort)).toBe("closed");
        expect(await fetchStatus(httpPort)).toBe("closed");

        const removed = await harness.adminRequest(`/api/security/blocklist/${encodeURIComponent("127.0.0.1")}`, {method: "DELETE"});
        expect(removed.status).toBe(200);
        expect(await fetchStatus(tcpPort)).toBe(200);
        expect(await fetchStatus(httpPort)).toBe(200);
    });

    it("포트를 고른 항목은 그 터널만 막는다", async () => {
        const added = await harness.adminRequest("/api/security/blocklist", {method: "POST", body: {address: "127.0.0.0/8", port: tcpPort}});
        expect(added.status).toBe(201);
        try {
            expect(await fetchStatus(tcpPort)).toBe("closed");
            expect(await fetchStatus(httpPort)).toBe(200);
        } finally {
            await harness.adminRequest(`/api/security/blocklist/${encodeURIComponent("127.0.0.0/8")}`, {method: "DELETE"});
        }
    });
});
