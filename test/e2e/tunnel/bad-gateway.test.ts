import http from "node:http";
import {createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";
import {getFreePort} from "../../helpers/smokeProcess";

// #284 — HTTP 터널이 대상 서버에 닿지 못하면 응답 없이 끊지 않고 502 Bad Gateway 로 답한다(AC-1).
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

describe("bad gateway", () => {
    let harness: ProcessTunnelHarness;

    beforeAll(async () => {
        // 아무것도 듣지 않는 포트를 대상으로 둔다.
        const closedPort = await getFreePort();
        harness = await createProcessTunnelHarness({tunnels: [{protocol: "http", destinationPort: closedPort}]});
        await harness.waitForTunnelOnline(harness.tunnels[0].forwardPort);
    });

    afterAll(async () => {
        await harness?.dispose();
    });

    test("an HTTP tunnel whose destination is down answers 502 (AC-1)", async () => {
        const result = await get(harness.tunnels[0].forwardPort);
        expect("status" in result ? result.status : result.error).toBe(502);
    });
});
