import http from "http";
import {WebSocket} from "ws";
import {startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, formatTail, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";
import {waitUntil} from "../../helpers/smokeProcess";
import net from "net";
import {once} from "events";

jest.setTimeout(180_000);

type Outcome = "end" | "error" | "close";

/** 외부에서 /drip 을 받기 시작하고, 끝나는 순간(종료·오류·닫힘)을 알려 준다. */
const startDrip = (port: number) => {
    let received = 0;
    let finished: Outcome | undefined;
    let finish!: (outcome: Outcome) => void;
    const done = new Promise<Outcome>((resolve) => { finish = (outcome) => { if(!finished) { finished = outcome; resolve(outcome); } }; });
    const req = http.get({host: "127.0.0.1", port, path: "/drip?ms=20&size=8192", agent: false}, (res) => {
        res.on("data", (chunk: Buffer) => { received += chunk.length; });
        res.on("end", () => finish("end"));
        res.on("error", () => finish("error"));
        res.on("close", () => finish("close"));
    });
    req.on("error", () => finish("error"));
    return {received: () => received, done, abort: () => req.destroy()};
};

const getText = (port: number, path: string): Promise<{status: number, body: string}> => new Promise((resolve, reject) => {
    const req = http.get({host: "127.0.0.1", port, path, agent: false, timeout: 10_000}, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString()}));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
});

const within = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not happen within ${ms}ms`)), ms); })]);
    } finally { clearTimeout(timer); }
};

const openWs = (port: number): Promise<WebSocket> => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws-raw`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
});

const echoOnce = (ws: WebSocket, text: string): Promise<string> => new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(data.toString()));
    ws.once("error", reject);
    ws.send(text);
});

describe("disconnect simulation (process boundary)", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;
    let forwardPort: number;

    beforeEach(async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({tunnels: [{protocol: "http", destinationPort: target.port}]});
        forwardPort = harness.tunnels[0].forwardPort;
        await harness.waitForTunnelOnline(forwardPort);
    });

    afterEach(async () => {
        try { await harness?.dispose(); } finally { await target?.close(); }
    });

    const clientListed = async (): Promise<boolean> => {
        const {status, json} = await harness.adminRequest("/api/clientStatus");
        return status === 200 && (json?.statuses ?? []).some((s: {clientId: string}) => s.clientId === harness.clientIds[0]);
    };

    // #231 — 전송 중 클라이언트 강제 종료
    test("#231 a killed client ends the in-flight external transfer, leaves no client on the server, and recovers after restart", async () => {
        const drip = startDrip(forwardPort);
        await waitUntil(async () => drip.received() > 64 * 1024 ? true : undefined, {timeoutMs: 15_000, label: "drip started"});

        await harness.killClient(0);
        // REQ-1: 외부 전송이 멈춘 채 남지 않고 끝난다.
        await within(drip.done, 10_000, "external transfer end");
        // REQ-2: 서버가 그 클라이언트를 목록에서 빼고, 대상 서비스 쪽 연결도 끝난다.
        await waitUntil(async () => (await clientListed()) ? undefined : true, {timeoutMs: 15_000, label: "client removed"});
        await waitUntil(async () => target.counters().activeDrips === 0 ? true : undefined, {timeoutMs: 15_000, label: "target drip closed"});

        // REQ-3: 다시 띄우면 같은 터널이 동작한다.
        await harness.startClient(0);
        await harness.waitForTunnelOnline(forwardPort);
        expect(await getText(forwardPort, "/custom-response")).toEqual({status: 200, body: "original-body"});
    });

    // #232 — 전송 중 서버 강제 종료
    test("#232 a killed server makes the client drop its endpoint connections, stay alive and reconnect", async () => {
        const drip = startDrip(forwardPort);
        await waitUntil(async () => drip.received() > 64 * 1024 ? true : undefined, {timeoutMs: 15_000, label: "drip started"});

        await harness.killServer();
        await within(drip.done, 10_000, "external transfer end");
        // REQ-1·2: 클라이언트는 살아 있고, 대상 서비스와 맺은 연결을 닫는다.
        await waitUntil(async () => target.counters().activeDrips === 0 ? true : undefined, {timeoutMs: 15_000, label: "client closed endpoint"});
        expect(harness.clients[0].child.exitCode).toBeNull();

        // REQ-3: 서버를 다시 띄우면 클라이언트가 스스로 다시 연결한다.
        await harness.startServer();
        await waitUntil(async () => (await clientListed()) ? true : undefined, {timeoutMs: 30_000, label: "client reconnected"});
        await harness.waitForTunnelOnline(forwardPort);
        expect(await getText(forwardPort, "/custom-response")).toEqual({status: 200, body: "original-body"});
        expect(harness.clients[0].child.exitCode).toBeNull();
    });

    // #235 — WebSocket 사용 중 터널이 끊길 때
    test.each([
        ["client", (h: ProcessTunnelHarness) => h.killClient(0), (h: ProcessTunnelHarness) => h.startClient(0)],
        ["server", (h: ProcessTunnelHarness) => h.killServer(), (h: ProcessTunnelHarness) => h.startServer()]
    ] as const)("#235 an open WebSocket closes within 5 seconds when the tunnel %s is killed, and a new one works after recovery", async (_label, kill, start) => {
        const ws = await openWs(forwardPort);
        expect(await echoOnce(ws, "before")).toBe("before");
        const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
        ws.on("error", () => {});

        await kill(harness);
        await within(closed, 5_000, "WebSocket close");
        await waitUntil(async () => target.counters().wsOpen === 0 ? true : undefined, {timeoutMs: 15_000, label: "target WebSocket closed"});

        await start(harness);
        await harness.waitForTunnelOnline(forwardPort);
        await waitUntil(async () => (await clientListed()) ? true : undefined, {timeoutMs: 30_000, label: "client online"});
        const again = await openWs(forwardPort);
        try {
            expect(await echoOnce(again, "after")).toBe("after");
        } finally { again.close(); }
    });

});

// #230 — 반쯤 열린 연결: 연결은 열어 둔 채 전달만 멈추는 프록시를 서버와 클라이언트 사이에 둔다.
describe("half-open control connection (process boundary, #230)", () => {
    const ENV = {TTTGATE_HEARTBEAT_INTERVAL_MS: "300", TTTGATE_HEARTBEAT_TIMEOUT_MS: "1500"};
    const previous: {[key: string]: string | undefined} = {};
    let target: TargetService;
    let harness: ProcessTunnelHarness;
    let proxy: net.Server;
    const sockets = new Set<net.Socket>();
    let blackhole = false;

    beforeEach(() => {
        for(const [key, value] of Object.entries(ENV)) { previous[key] = process.env[key]; process.env[key] = value; }
    });
    afterEach(async () => {
        try { await harness?.dispose(); } finally {
            await target?.close();
            sockets.forEach((socket) => socket.destroy());
            await new Promise<void>((resolve) => proxy ? proxy.close(() => resolve()) : resolve());
            for(const key of Object.keys(ENV)) { if(previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
        }
    });

    test("both processes detect a blackholed control connection and the client reconnects once the path heals", async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({tunnels: [{protocol: "http", destinationPort: target.port}], startClient: false});
        const forwardPort = harness.tunnels[0].forwardPort;
        proxy = net.createServer((inbound) => {
            const outbound = net.connect(harness.tunnelPort, "127.0.0.1");
            for(const socket of [inbound, outbound]) { sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket)); }
            inbound.on("data", (chunk) => { if(!blackhole) outbound.write(chunk); });
            outbound.on("data", (chunk) => { if(!blackhole) inbound.write(chunk); });
            // 블랙홀은 닫힘(FIN·RST)도 넘기지 않는다. 넘기면 먼저 알아챈 쪽의 닫힘이 다른 쪽의 하트비트 감지를 가로챈다(#274).
            inbound.on("close", () => { if(!blackhole) outbound.destroy(); });
            outbound.on("close", () => { if(!blackhole) inbound.destroy(); });
        });
        proxy.listen(0, "127.0.0.1");
        await once(proxy, "listening");
        await harness.startClient(0, {connectPort: (proxy.address() as net.AddressInfo).port});
        await harness.waitForTunnelOnline(forwardPort);
        const firstId = async () => ((await harness.adminRequest("/api/clientStatus")).json?.statuses ?? [])[0]?.id;
        const first = await firstId();
        expect(first).toBeDefined();

        blackhole = true;
        // 서버: 정해진 시간(1.5초) 안에 그 클라이언트를 뺀다.
        await waitUntil(async () => (await firstId()) === undefined ? true : undefined, {timeoutMs: 15_000, intervalMs: 200, label: "server dropped the client"})
            .catch((error) => { throw new Error(`${error.message}\nCLIENT:\n${formatTail(harness.clients[0], 25)}\nSERVER:\n${formatTail(harness.server, 25)}`); });
        // 클라이언트: 끊김을 알아채고 다시 연결을 시도한다.
        await waitUntil(async () => harness.clients[0].readChannel().stdout.includes("heartbeat timed out") ? true : undefined,
            {timeoutMs: 15_000, intervalMs: 200, label: "client detected the timeout"});
        expect(harness.clients[0].child.exitCode).toBeNull();

        // 길이 복구되면(블랙홀 해제·남은 연결 정리) 다시 연결되어 터널이 동작한다.
        blackhole = false;
        sockets.forEach((socket) => socket.destroy());
        await waitUntil(async () => { const id = await firstId(); return id !== undefined && id !== first ? true : undefined; },
            {timeoutMs: 30_000, intervalMs: 200, label: "client reconnected"});
        await harness.waitForTunnelOnline(forwardPort);
        expect(await getText(forwardPort, "/custom-response")).toEqual({status: 200, body: "original-body"});
    });

    // #274 — 서버가 먼저 끊김을 알아채 연결을 닫아도 블랙홀은 그 닫힘을 클라이언트에 넘기지 않는다(실제 블랙홀처럼).
    // 그래야 클라이언트가 하트비트로 스스로 알아챈다. 두 기한이 같으면 부하에 따라 순서가 바뀌므로 클라이언트 기한을 길게 둔다.
    test("the client detects the blackhole by heartbeat even when the server drops it first", async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({tunnels: [{protocol: "http", destinationPort: target.port}], startClient: false});
        const forwardPort = harness.tunnels[0].forwardPort;
        proxy = net.createServer((inbound) => {
            const outbound = net.connect(harness.tunnelPort, "127.0.0.1");
            for(const socket of [inbound, outbound]) { sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket)); }
            inbound.on("data", (chunk) => { if(!blackhole) outbound.write(chunk); });
            outbound.on("data", (chunk) => { if(!blackhole) inbound.write(chunk); });
            // 블랙홀은 닫힘(FIN·RST)도 넘기지 않는다. 넘기면 먼저 알아챈 쪽의 닫힘이 다른 쪽의 하트비트 감지를 가로챈다(#274).
            inbound.on("close", () => { if(!blackhole) outbound.destroy(); });
            outbound.on("close", () => { if(!blackhole) inbound.destroy(); });
        });
        proxy.listen(0, "127.0.0.1");
        await once(proxy, "listening");
        await harness.startClient(0, {connectPort: (proxy.address() as net.AddressInfo).port, env: {TTTGATE_HEARTBEAT_TIMEOUT_MS: "4000"}});
        await harness.waitForTunnelOnline(forwardPort);
        const firstId = async () => ((await harness.adminRequest("/api/clientStatus")).json?.statuses ?? [])[0]?.id;
        const first = await firstId();
        expect(first).toBeDefined();

        blackhole = true;
        // 서버: 정해진 시간(1.5초) 안에 그 클라이언트를 뺀다.
        await waitUntil(async () => (await firstId()) === undefined ? true : undefined, {timeoutMs: 15_000, intervalMs: 200, label: "server dropped the client"})
            .catch((error) => { throw new Error(`${error.message}\nCLIENT:\n${formatTail(harness.clients[0], 25)}\nSERVER:\n${formatTail(harness.server, 25)}`); });
        // 클라이언트: 끊김을 알아채고 다시 연결을 시도한다.
        await waitUntil(async () => harness.clients[0].readChannel().stdout.includes("heartbeat timed out") ? true : undefined,
            {timeoutMs: 15_000, intervalMs: 200, label: "client detected the timeout"});
        expect(harness.clients[0].child.exitCode).toBeNull();

        // 길이 복구되면(블랙홀 해제·남은 연결 정리) 다시 연결되어 터널이 동작한다.
        blackhole = false;
        sockets.forEach((socket) => socket.destroy());
        await waitUntil(async () => { const id = await firstId(); return id !== undefined && id !== first ? true : undefined; },
            {timeoutMs: 30_000, intervalMs: 200, label: "client reconnected"});
        await harness.waitForTunnelOnline(forwardPort);
        expect(await getText(forwardPort, "/custom-response")).toEqual({status: 200, body: "original-body"});
    });
});
