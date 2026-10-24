import net from "net";
import path from "path";
import {spawnSync} from "child_process";
import {TCPServer} from "../../../src/util/TCPServer";
import {getFreePort} from "../../helpers/network";
import LoggerFactory from "../../../src/util/logger/LoggerFactory";

jest.setTimeout(60_000);

const HTTP_503 = Buffer.from("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");

const startRejecting = async (extra: {rejectLingerMs?: number, maxRejectedSockets?: number} = {}): Promise<{server: TCPServer; port: number}> => {
    const port = await getFreePort();
    const server = TCPServer.create({port, keepAlive: 0, ...extra,
        admit: () => ({allowed: false, reason: "concurrency-limit", rejectResponse: HTTP_503})});
    await new Promise<void>((resolve, reject) => server.start((err) => err ? reject(err) : resolve()));
    return {server, port};
};

const openConnections = (server: TCPServer): Promise<number> =>
    new Promise((resolve) => ((server as any)._server as net.Server).getConnections((_err, count) => resolve(count)));

/** 응답을 읽지만 FIN 을 보내지 않고 닫지도 않는 상대. */
const holdOpen = (port: number): Promise<{socket: net.Socket; received: () => string}> => new Promise((resolve) => {
    let text = "";
    const socket = net.connect({port, host: "127.0.0.1", allowHalfOpen: true});
    socket.on("error", () => {});
    socket.on("end", () => {});
    socket.on("data", (chunk) => { text += chunk.toString(); });
    socket.once("connect", () => resolve({socket, received: () => text}));
});

const waitFor = async (check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> => {
    const until = Date.now() + timeoutMs;
    while(Date.now() < until) {
        if(await check()) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return check();
};

describe("TCPServer reject-response sockets (#245)", () => {
    const servers: TCPServer[] = [];
    const sockets: net.Socket[] = [];
    afterEach(async () => {
        sockets.splice(0).forEach((socket) => socket.destroy());
        await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.isEnd() ? resolve() : server.stop(() => resolve()))));
    });

    // REQ-1 / AC-1
    test.each(["after-response", "reset-immediate"])("a peer that resets the connection (%s) does not crash the process", (mode) => {
        const result = spawnSync(process.execPath, ["-r", "ts-node/register/transpile-only",
            path.join(__dirname, "admission-reject-driver.ts"), mode],
            {cwd: path.join(__dirname, "../../.."), encoding: "utf8", timeout: 45_000});
        expect({status: result.status, stderr: result.stderr.split(/\r?\n/).filter((line) => /Error|ECONN/.test(line)).slice(0, 3)})
            .toEqual({status: 0, stderr: []});
        expect(result.stdout).toContain("SURVIVED");
    });

    // REQ-2 / AC-2, REQ-4 / AC-4
    test("closes reject-response sockets within the linger time even when the peer never sends FIN", async () => {
        const {server, port} = await startRejecting({rejectLingerMs: 300});
        servers.push(server);
        const peers = await Promise.all(Array.from({length: 20}, () => holdOpen(port)));
        sockets.push(...peers.map((peer) => peer.socket));
        // 모두 수락되어 503 을 받은 뒤에 닫히기를 기다린다(수락 전의 0 개를 통과로 보지 않는다).
        expect(await waitFor(async () => peers.every((peer) => peer.received().includes("HTTP/1.1 503")), 2_000)).toBe(true);

        expect(await waitFor(async () => (await openConnections(server)) === 0, 3_000)).toBe(true);
    });

    // REQ-3 / AC-3
    test("stop() closes reject-response sockets that are still open", async () => {
        const {server, port} = await startRejecting({rejectLingerMs: 60_000});
        servers.push(server);
        const peers = await Promise.all(Array.from({length: 5}, () => holdOpen(port)));
        sockets.push(...peers.map((peer) => peer.socket));
        expect(await waitFor(async () => (await openConnections(server)) === 5, 2_000)).toBe(true);

        const stopped = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), 3_000);
            server.stop(() => { clearTimeout(timer); resolve(true); });
        });
        expect(stopped).toBe(true);
        expect(await waitFor(async () => (server as any)._rejectedSockets.size === 0, 2_000)).toBe(true);
    });

    // REQ-2 — 요청을 보낸 뒤 503 을 받고 닫는 정상 클라이언트는 기한을 기다리지 않고 바로 정리된다.
    test("a client that sends a request, reads the 503 and closes is released at once, not after the linger time", async () => {
        const {server, port} = await startRejecting({rejectLingerMs: 60_000});
        servers.push(server);
        const clients = await Promise.all(Array.from({length: 10}, () => new Promise<string>((resolve) => {
            let text = "";
            const socket = net.connect(port, "127.0.0.1", () => socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
            sockets.push(socket);
            socket.on("error", () => {});
            socket.on("data", (chunk) => { text += chunk.toString(); });
            socket.once("end", () => resolve(text));
        })));
        for(const text of clients) expect(text).toContain("HTTP/1.1 503");

        expect(await waitFor(async () => (await openConnections(server)) === 0, 1_500)).toBe(true);
    });

    // 거절된 상대가 데이터를 계속 밀어 넣으면, 버리는 양의 상한(64KiB)에서 읽기를 멈춘다.
    // 상한에서 바로 끊지 않으므로 상대가 503 을 읽을 시간(기한)을 번다. 기한에 닫을 때는 RST 가 갈 수 있다.
    // 멈춘 뒤에도 Node 가 highWaterMark 만큼 더 읽으므로(플랫폼마다 다름) 읽은 양이 더 늘지 않는지를 본다.
    test("a rejected peer that keeps sending data stops being read at the discard limit and is closed at the linger time", async () => {
        const {server, port} = await startRejecting({rejectLingerMs: 2_000});
        servers.push(server);
        let timer: NodeJS.Timeout | undefined;
        const socket = net.connect({port, host: "127.0.0.1", allowHalfOpen: true});
        sockets.push(socket);
        socket.on("error", () => {});
        // 503 을 받은 뒤(수락이 끝난 뒤)에 쓰기 시작한다.
        socket.once("data", () => { timer = setInterval(() => { if(!socket.destroyed) socket.write(Buffer.alloc(16 * 1024)); }, 10); });
        try {
            expect(await waitFor(async () => timer !== undefined, 2_000)).toBe(true);
            await new Promise((resolve) => setTimeout(resolve, 800));
            const rejected = Array.from((server as any)._rejectedSockets as Set<net.Socket>);
            expect(rejected.length).toBe(1);
            const readAfterPause = rejected[0].bytesRead;
            expect(readAfterPause).toBeLessThanOrEqual(64 * 1024 + 64 * 1024 + rejected[0].readableHighWaterMark);
            await new Promise((resolve) => setTimeout(resolve, 400));
            expect(rejected[0].bytesRead).toBe(readAfterPause);

            expect(await waitFor(async () => (server as any)._rejectedSockets.size === 0, 4_000)).toBe(true);
        } finally { clearInterval(timer); }
    });

    // 거절 소켓도 자원이다. 기다리는 거절 소켓이 상한에 닿으면 응답 없이 바로 닫는다.
    test("beyond the limit of lingering reject sockets, new rejected connections are closed without a response", async () => {
        const {server, port} = await startRejecting({rejectLingerMs: 60_000, maxRejectedSockets: 2});
        servers.push(server);
        const held = [await holdOpen(port), await holdOpen(port)];
        sockets.push(...held.map((peer) => peer.socket));
        expect(await waitFor(async () => held.every((peer) => peer.received().includes("503")), 2_000)).toBe(true);

        const extra = await new Promise<{text: string}>((resolve) => {
            let text = "";
            const socket = net.connect(port, "127.0.0.1");
            sockets.push(socket);
            socket.on("error", () => {});
            socket.on("data", (chunk) => { text += chunk.toString(); });
            socket.once("close", () => resolve({text}));
        });
        expect(extra.text).toBe("");
        expect((server as any)._rejectedSockets.size).toBe(2);
    });

    // 거절 소켓 상한 경고와 TLS 핸드셰이크 상한 경고는 따로 묶는다. 한쪽이 다른 쪽을 가리지 않는다.
    test("throttled warnings of different kinds do not hide each other", () => {
        const server = TCPServer.create({port: 0});
        const warn = jest.spyOn(LoggerFactory.getLogger("socket", "TCPServer"), "warn").mockImplementation(() => undefined as any);
        let now = 1_000_000;
        const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
        try {
            (server as any).warnThrottled("rejected-sockets", "A");
            (server as any).warnThrottled("pending-tls", "B");
            (server as any).warnThrottled("rejected-sockets", "A");
            (server as any).warnThrottled("pending-tls", "B");
            (server as any).warnThrottled("pending-tls", "B");
            now += 10_001;
            // 묶인 수도 종류마다 따로 센다.
            (server as any).warnThrottled("rejected-sockets", "A");
            expect(warn.mock.calls.map((call) => String(call[0]))).toEqual(["TCPServer: A", "TCPServer: B", "TCPServer: A (1 more since the last warning)"]);
        } finally { warn.mockRestore(); clock.mockRestore(); }
    });
});
