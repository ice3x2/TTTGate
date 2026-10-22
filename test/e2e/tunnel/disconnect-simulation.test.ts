import http from "http";
import {WebSocket} from "ws";
import {startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";
import {waitUntil} from "../../helpers/smokeProcess";

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
