import fs from "fs";
import os from "os";
import path from "path";
import net from "net";
import crypto from "crypto";
import {once} from "events";
import {createTunnelHarness} from "../../helpers/tunnelHarness";
import {QueueLimiterRegistry} from "../../../src/util/QueueLimiter";
import {SocketHandler} from "../../../src/util/SocketHandler";

jest.setTimeout(180_000);

const MiB = 1048576;
const pattern = (offset: number, length: number) => {
    const chunk = Buffer.alloc(length);
    for(let n = 0; n < length; n++) chunk[n] = ((offset + n) * 31 + ((offset + n) >>> 16)) & 255;
    return chunk;
};

/** 연결마다 total 바이트를 보낸다. cutAt 이 있으면 그만큼 보낸 뒤 목적지 쪽에서 연결을 끊는다. */
const startEndpoint = async (first: {total: number, cutAt?: number}, later: {total: number}) => {
    let connections = 0;
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on("error", () => {});
        socket.on("close", () => sockets.delete(socket));
        const plan = connections++ === 0 ? first : later;
        const limit = (plan as {cutAt?: number}).cutAt ?? plan.total;
        let offset = 0;
        const writeNext = () => {
            while(offset < limit) {
                const length = Math.min(64 * 1024, limit - offset);
                const ok = socket.write(pattern(offset, length));
                offset += length;
                if(!ok) { socket.once("drain", writeNext); return; }
            }
            if((plan as {cutAt?: number}).cutAt !== undefined) socket.destroy(); else socket.end();
        };
        writeNext();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {port: (server.address() as net.AddressInfo).port,
        close: () => new Promise<void>((resolve) => { sockets.forEach((s) => s.destroy()); server.close(() => resolve()); })};
};

const cacheFiles = (dir: string) => fs.readdirSync(dir).filter((name) => name.endsWith(".cache"));

const waitFor = async (condition: () => boolean, timeoutMs: number, label: string) => {
    const deadline = Date.now() + timeoutMs;
    while(!condition()) {
        if(Date.now() > deadline) throw new Error(`${label} did not happen within ${timeoutMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
};

// #237 — 디스크 캐시로 넘친 세션이 도중에 끊기면 캐시 파일과 사용량이 회수된다.
// 실제 프로세스에서는 배압(TCP 흐름 제어)이 송신을 먼저 멈춰 느린 소비자로는 넘침이 일어나지 않는다(#240 이 그 메모리 상한을 본다).
// 그래서 넘침 정책을 바꿔 데이터 청크가 캐시 경로를 강제로 타게 한다.
describe("spilled cache is reclaimed when a transfer is cut (#237)", () => {
    let cacheDir: string;
    beforeEach(() => {
        cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-reclaim-"));
    });
    afterEach(() => {
        QueueLimiterRegistry.reset();
        fs.rmSync(cacheDir, {recursive: true, force: true});
    });

    test.each([
        ["the external client aborts", {total: 8 * MiB}],
        ["the endpoint cuts the connection", {total: 8 * MiB, cutAt: 4 * MiB}]
    ] as const)("when %s, cache files and the cache budget go back to zero and the next transfer is intact", async (label, plan) => {
        const endpoint = await startEndpoint(plan, {total: 1 * MiB});
        const harness = await createTunnelHarness({clients: [{clientId: "reclaim", clientSecret: "reclaim-secret",
            endpointFactory: async () => endpoint}]});
        // 하네스가 applyTestRoot 로 런타임 상태(넘침 정책·캐시 경로 포함)를 초기화하므로 그 뒤에 건다.
        SocketHandler.fileCacheDirPath = cacheDir;
        // 데이터 청크만 넘치게 한다(제어 패킷은 작아서 메모리로 간다). 운영에서 넘치는 것도 큰 데이터다.
        QueueLimiterRegistry.configure({shouldSpillToFile: (input) => input.incomingSize > 4096});
        try {
            await harness.start();
            // 제어 연결도 넘침 정책을 따라 캐시 파일을 쓴다. 전송 전의 파일을 기준선으로 두고 새로 생긴 것만 본다.
            const baseline = new Set(cacheFiles(cacheDir));
            const sessionFiles = () => cacheFiles(cacheDir).filter((name) => !baseline.has(name));
            const external = net.connect(harness.forwardPort, "127.0.0.1");
            external.on("error", () => {});
            let received = 0;
            let pausedOnce = false;
            external.on("data", (chunk) => {
                received += chunk.length;
                // 한 번만 멈춘다(다시 읽기 시작한 뒤에는 멈추지 않는다).
                if(!pausedOnce && received > 256 * 1024) { pausedOnce = true; external.pause(); }
            });
            const closed = new Promise<void>((resolve) => external.once("close", () => resolve()));
            // 정책 때문에 모든 송신이 캐시 파일을 거친다.
            await waitFor(() => sessionFiles().length > 0, 30_000, "cache spill");
            // 외부가 실제로 읽기를 멈춘 뒤에 다음 단계로 간다(넘침은 첫 데이터부터 일어나므로 순서를 맞춘다).
            await waitFor(() => pausedOnce, 30_000, "external paused");

            if(label.startsWith("the external")) {
                external.destroy();
            } else {
                external.resume();
            }
            await Promise.race([closed, new Promise((_, reject) => setTimeout(() =>
                reject(new Error(`external connection not closed: received=${received} cacheBytes=${SocketHandler.globalFileCacheSize}`)), 30_000))]);
            // REQ-1·2: 그 세션의 캐시 파일과 전역 캐시 사용량이 회수된다.
            await waitFor(() => sessionFiles().length === 0, 30_000, `cache files removed (left: ${sessionFiles().join(",")})`);
            await waitFor(() => SocketHandler.globalFileCacheSize === 0, 30_000, "cache budget released");
            if(label.startsWith("the endpoint")) expect(received).toBeLessThan(plan.total);

            // REQ-3: 다음 전송은 캐시를 거쳐도 온전하다.
            const next = net.connect(harness.forwardPort, "127.0.0.1");
            const chunks: Buffer[] = [];
            next.on("data", (chunk) => chunks.push(chunk));
            await once(next, "end");
            const body = Buffer.concat(chunks);
            expect(body.length).toBe(1 * MiB);
            expect(crypto.createHash("sha256").update(body).digest("hex")).toBe(crypto.createHash("sha256").update(pattern(0, 1 * MiB)).digest("hex"));
            next.destroy();
        } finally {
            await harness.dispose();
            await endpoint.close();
        }
    });
});
