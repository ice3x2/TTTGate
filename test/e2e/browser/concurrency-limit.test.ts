// U5-08 / #123 — 실제 서버·클라이언트 프로세스에서 그룹 동시 연결 상한을 확인한다.
import fs from "fs";
import http from "http";
import net from "net";
import path from "path";
import {startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";
import {E2E_ADMIN_PASSWORD, IdentityFixture} from "../../helpers/identityFixture";

jest.setTimeout(120_000);

const FIXTURE: IdentityFixture = {
    users: [
        {username: "admin", password: E2E_ADMIN_PASSWORD, role: "superuser"},
        {id: "u_00000000000a11ce", username: "alice", password: "alice-pass-1234", role: "regular", groupId: "g_field"}
    ],
    groups: [{id: "g_field", name: "Field", attributes: {max_concurrent_connections: 3}}]
};

const connectAndWait = (port: number, timeoutMs: number = 2000): Promise<net.Socket> => new Promise((resolve, reject) => {
    const socket = net.connect({host: "127.0.0.1", port});
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("connect did not complete in time")); }, timeoutMs);
    socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
    socket.once("error", (err) => { clearTimeout(timer); reject(err); });
});

const connectAndCollectUntilClose = (port: number, timeoutMs: number = 1000): Promise<Buffer> => new Promise((resolve, reject) => {
    const socket = net.connect({host: "127.0.0.1", port});
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new Error(`socket did not close within ${timeoutMs}ms`)), timeoutMs);
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once("close", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    socket.once("error", () => { /* a destroyed socket also raises ECONNRESET; close still fires */ });
});

const httpGet = (port: number): Promise<{status: number; headers: http.IncomingHttpHeaders; body: string}> => new Promise((resolve, reject) => {
    const req = http.get({host: "127.0.0.1", port, path: "/", agent: false}, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.once("end", () => resolve({status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf-8")}));
    });
    req.setTimeout(5000, () => req.destroy(new Error("http.get timed out")));
    req.once("error", reject);
});

const waitUntil = async (check: () => Promise<boolean> | boolean, timeoutMs: number, label: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while(Date.now() < deadline) {
        if(await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`timed out waiting for ${label}`);
};

describe("concurrency-limit e2e", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;
    let tcpPort: number;
    let httpPort: number;

    beforeAll(async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({
            tunnels: [
                {protocol: "tcp", destinationPort: target.port, extra: {ownerId: "u_00000000000a11ce"}},
                {protocol: "http", destinationPort: target.port, extra: {ownerId: "u_00000000000a11ce"}}
            ],
            identityFixture: FIXTURE
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

    // 실제 서버는 #109 의 FileAuditSink 로 감사를 남긴다(stdout 이 아니다). 날짜별 jsonl 파일의 줄을 센다.
    const auditLines = (): string[] => {
        const dir = path.join(harness.rootDir, "logs", "audit");
        if(!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir).filter((name) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort()
            .flatMap((name) => fs.readFileSync(path.join(dir, name), "utf-8").split(/\r?\n/));
    };
    const sessionsOf = async (port: number): Promise<number> => {
        const {json} = await harness.adminRequest("/api/externalServerStatuses");
        return (json.statuses as Array<{port: number; sessions: number}>).find((status) => status.port === port)?.sessions ?? -1;
    };

    test("그룹 세션 합이 상한에 이르면 tcp 는 무응답으로, http 는 503 으로 거절하고 감사는 포트별 1회다", async () => {
        const kept = [await connectAndWait(tcpPort), await connectAndWait(tcpPort), await connectAndWait(tcpPort)];
        await waitUntil(async () => (await sessionsOf(tcpPort)) === 3, 5000, "3 tcp sessions");

        const fourth = await connectAndCollectUntilClose(tcpPort, 1000);
        expect(fourth.length).toBe(0);

        const rejected = await httpGet(httpPort);
        expect(rejected.status).toBe(503);
        expect(rejected.headers.connection).toBe("close");

        // 같은 1분 안의 반복 거절은 감사를 더 남기지 않는다.
        for(let i = 0; i < 3; i++) {
            expect((await connectAndCollectUntilClose(tcpPort, 1000)).length).toBe(0);
        }

        kept.shift()!.end();
        await waitUntil(async () => (await sessionsOf(tcpPort)) === 2, 5000, "2 tcp sessions");
        await new Promise((resolve) => setTimeout(resolve, 500));
        const allowed = await httpGet(httpPort);
        expect(allowed.status).toBe(200);
        expect(allowed.body).toContain("Target OK");

        await waitUntil(() => auditLines().filter((line) => line.includes("conn_limit_hit")).length >= 2, 5000, "audit lines");
        // 쓰기는 비동기 큐를 거치므로 늦게 도착하는 줄이 없는지 잠시 더 본다.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const limitLines = auditLines().filter((line) => line.includes("conn_limit_hit"));
        expect(limitLines).toHaveLength(2);
        // 줄 안의 다른 숫자(at 등)가 포트와 겹칠 수 있으므로 파싱해 대상 id 로 고른다.
        const targets = limitLines.map((line) => JSON.parse(line).target?.id);
        expect(targets.filter((id) => id === String(tcpPort))).toHaveLength(1);
        expect(targets.filter((id) => id === String(httpPort))).toHaveLength(1);

        const stats = await harness.adminRequest("/api/security/stats");
        expect(stats.status).toBe(200);
        expect(stats.json.stats.ports[String(tcpPort)]).toBeDefined();

        kept.forEach((socket) => socket.destroy());
    });
});
