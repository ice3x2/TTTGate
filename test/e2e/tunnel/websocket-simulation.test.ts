import http from "http";
import crypto from "crypto";
import {WebSocket} from "ws";
import {startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";
import fs from "fs";
import os from "os";
import path from "path";
import net from "net";
import tls from "tls";
import {once} from "events";
import {generateSelfSignedCert} from "../../helpers/testCerts";
import {CONTROL_CERT_SERVER_NAME} from "../../../src/server/CertificationStore";

jest.setTimeout(180_000);

type Frame = {data: Buffer, binary: boolean};

/** 받은 프레임을 차례로 꺼내는 WebSocket 클라이언트. */
const connect = (url: string, options: object = {}): Promise<{ws: WebSocket, next: (timeoutMs?: number) => Promise<Frame>, closed: Promise<{code: number, reason: string}>}> =>
    new Promise((resolve, reject) => {
        const ws = new WebSocket(url, {maxPayload: 64 * 1024 * 1024, ...options});
        const queue: Frame[] = [];
        const waiters: Array<(frame: Frame) => void> = [];
        ws.on("message", (data: Buffer, binary: boolean) => {
            const frame = {data: Buffer.from(data), binary};
            const waiter = waiters.shift();
            if(waiter) waiter(frame); else queue.push(frame);
        });
        const closed = new Promise<{code: number, reason: string}>((done) => ws.once("close", (code, reason) => done({code, reason: reason.toString()})));
        const next = (timeoutMs = 10_000) => new Promise<Frame>((done, fail) => {
            const queued = queue.shift();
            if(queued) return done(queued);
            const timer = setTimeout(() => fail(new Error("no WebSocket message")), timeoutMs);
            waiters.push((frame) => { clearTimeout(timer); done(frame); });
        });
        ws.once("open", () => resolve({ws, next, closed}));
        ws.once("error", reject);
    });

describe("WebSocket through the HTTP tunnel (process boundary)", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;

    afterEach(async () => {
        try { await harness?.dispose(); } finally { await target?.close(); }
    });

    const start = async (spec: object = {}) => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({tunnels: [{protocol: "http", destinationPort: target.port, ...spec}]});
        const forwardPort = harness.tunnels[0].forwardPort;
        await harness.waitForTunnelOnline(forwardPort);
        return forwardPort;
    };

    // #233
    test("#233 REQ-1/5 1000 messages each way keep order and content, and server pushes arrive", async () => {
        const port = await start();
        const {ws, next} = await connect(`ws://127.0.0.1:${port}/ws-raw`);
        try {
            ws.send("push:50");
            for(let n = 1; n <= 50; n++) expect((await next()).data.toString()).toBe(`push:${n}`);
            for(let n = 0; n < 1000; n++) ws.send(`m-${n}`);
            for(let n = 0; n < 1000; n++) expect((await next()).data.toString()).toBe(`m-${n}`);
        } finally { ws.close(); }
    });

    test("#233 REQ-2 binary frames and a 1MiB frame come back byte for byte", async () => {
        const port = await start();
        const {ws, next} = await connect(`ws://127.0.0.1:${port}/ws-raw`);
        try {
            const small = crypto.randomBytes(1000);
            const big = crypto.randomBytes(1024 * 1024);
            ws.send(small, {binary: true});
            ws.send(big, {binary: true});
            const first = await next();
            expect(first.binary).toBe(true);
            expect(first.data.equals(small)).toBe(true);
            const second = await next(30_000);
            expect(second.binary).toBe(true);
            expect(second.data.length).toBe(big.length);
            expect(crypto.createHash("sha256").update(second.data).digest("hex")).toBe(crypto.createHash("sha256").update(big).digest("hex"));
        } finally { ws.close(); }
    });

    test("#233 REQ-3 twenty concurrent WebSockets echo without mixing", async () => {
        const port = await start();
        const clients = await Promise.all(Array.from({length: 20}, () => connect(`ws://127.0.0.1:${port}/ws-raw`)));
        try {
            clients.forEach((client, n) => { for(let k = 0; k < 20; k++) client.ws.send(`c${n}-${k}`); });
            for(const [n, client] of clients.entries()) {
                for(let k = 0; k < 20; k++) expect((await client.next()).data.toString()).toBe(`c${n}-${k}`);
            }
        } finally { clients.forEach((client) => client.ws.close()); }
    });

    test("#233 REQ-4 the target's close code and reason reach the external client", async () => {
        const port = await start();
        const {ws, closed} = await connect(`ws://127.0.0.1:${port}/ws-raw`);
        ws.send("close:4001:bye-from-target");
        expect(await closed).toEqual({code: 4001, reason: "bye-from-target"});
    });

    // #234
    test("#234 an idle WebSocket outlives the HTTP keepAliveTimeout while plain keep-alive connections still close", async () => {
        const port = await start({httpOption: {keepAliveTimeout: 2}});
        const {ws, next, closed} = await connect(`ws://127.0.0.1:${port}/ws-raw`);
        let closedEarly = false;
        void closed.then(() => { closedEarly = true; });
        try {
            await new Promise((resolve) => setTimeout(resolve, 8_000));
            expect(closedEarly).toBe(false);
            ws.send("still-here");
            expect((await next()).data.toString()).toBe("still-here");
        } finally { ws.close(); }

        // 대조군: 일반 keep-alive 연결은 타임아웃 뒤 닫힌다.
        const agent = new http.Agent({keepAlive: true, maxSockets: 1});
        try {
            const socketClosed = await new Promise<number>((resolve, reject) => {
                const req = http.get({host: "127.0.0.1", port, path: "/custom-response", agent}, (res) => {
                    res.resume();
                    res.on("end", () => {
                        const startedAt = Date.now();
                        req.socket?.once("close", () => resolve(Date.now() - startedAt));
                    });
                });
                req.on("error", reject);
            });
            expect(socketClosed).toBeLessThan(6_000);
        } finally { agent.destroy(); }
    });

    // #236 — 이 제품에서 터널의 tls 는 외부 포트와 목적지 연결 모두에 TLS 를 쓴다(tls-external.test.ts 참고).
    // 그래서 목적지 앞에 TLS 종료 프록시를 두고, 클라이언트 프로세스가 그 인증서를 믿게 NODE_EXTRA_CA_CERTS 로 넘긴다.
    test("#236 wss on a TLS external port echoes text and binary frames with a verified certificate", async () => {
        target = await startTargetService();
        const proxyCert = generateSelfSignedCert("127.0.0.1");
        const sockets = new Set<net.Socket>();
        const proxy = tls.createServer({key: proxyCert.keyPem, cert: proxyCert.certPem}, (socket) => {
            const upstream = net.connect(target.port, "127.0.0.1");
            sockets.add(socket); sockets.add(upstream);
            socket.on("error", () => upstream.destroy()); upstream.on("error", () => socket.destroy());
            socket.pipe(upstream).pipe(socket);
        });
        proxy.listen(0, "127.0.0.1");
        await once(proxy, "listening");
        const caFile = path.join(os.tmpdir(), `tttgate-wss-ca-${process.pid}.pem`);
        fs.writeFileSync(caFile, proxyCert.certPem);
        const previous = process.env.NODE_EXTRA_CA_CERTS;
        process.env.NODE_EXTRA_CA_CERTS = caFile;
        try {
            harness = await createProcessTunnelHarness({tunnels: [{protocol: "https", destinationPort: (proxy.address() as net.AddressInfo).port, tls: true}]});
            const port = harness.tunnels[0].forwardPort;
            await harness.waitForTunnelOnline(port);
            // 외부 포트에 따로 인증서를 두지 않으면 서버의 제어 인증서(cert/control.cert.pem)를 쓴다.
            const certPem = fs.readFileSync(path.join(harness.rootDir, "cert", "control.cert.pem"), "utf-8");
            const {ws, next} = await connect(`wss://127.0.0.1:${port}/ws-raw`, {ca: certPem, servername: CONTROL_CERT_SERVER_NAME});
            try {
                ws.send("over-tls");
                expect((await next()).data.toString()).toBe("over-tls");
                const bytes = crypto.randomBytes(256 * 1024);
                ws.send(bytes, {binary: true});
                const frame = await next(30_000);
                expect(frame.binary).toBe(true);
                expect(frame.data.equals(bytes)).toBe(true);
            } finally { ws.close(); }
        } finally {
            if(previous === undefined) delete process.env.NODE_EXTRA_CA_CERTS; else process.env.NODE_EXTRA_CA_CERTS = previous;
            fs.rmSync(caFile, {force: true});
            sockets.forEach((socket) => socket.destroy());
            await new Promise<void>((resolve) => proxy.close(() => resolve()));
        }
    });
});
