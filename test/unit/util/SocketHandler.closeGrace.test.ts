import net from "net";
import crypto from "crypto";
import {once} from "events";
import {SocketHandler} from "../../../src/util/SocketHandler";
import SocketState from "../../../src/util/SocketState";
import tls from "tls";
import {EventEmitter} from "events";
import {generateSelfSignedCert} from "../../helpers/testCerts";
import {ResourcePolicyRegistry} from "../../../src/util/ResourcePolicy";
import {FileCache} from "../../../src/util/FileCache";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(30_000);

// FIN 대기 기한과 남은 출력 정체 기한. 정체 기한은 Linux 의 쓰기 완료 간격(커널 버퍼가 수 MiB 씩 비워질 때)보다 넉넉해야 한다.
const GRACE = 400;
const STALL = 5_000;

const waitFor = async (check: () => boolean, timeoutMs: number): Promise<boolean> => {
    const until = Date.now() + timeoutMs;
    while(Date.now() < until) {
        if(check()) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return check();
};

// #248 — 닫기를 시작한 연결은 FIN 을 보내거나 받은 뒤 상대가 닫지 않으면 GRACE 뒤에, 남은 출력이 멈춰 있으면 STALL 뒤에 강제로 닫는다.
describe("SocketHandler close grace (#248)", () => {
    let server: net.Server;
    let client: net.Socket;
    let serverSide: net.Socket;
    let previous: {grace: number, stall: number};

    beforeEach(async () => {
        previous = {grace: SocketHandler.closeGraceMs, stall: SocketHandler.closeStallMs};
        SocketHandler.closeGraceMs = GRACE;
        SocketHandler.closeStallMs = STALL;
        server = net.createServer();
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        // FIN 을 받아도 답하지 않는 상대(allowHalfOpen).
        client = net.connect({port: (server.address() as net.AddressInfo).port, host: "127.0.0.1", allowHalfOpen: true});
        client.on("error", () => {});
        client.on("end", () => {});
        [serverSide] = await once(server, "connection") as [net.Socket];
    });
    afterEach(async () => {
        SocketHandler.closeGraceMs = previous.grace;
        SocketHandler.closeStallMs = previous.stall;
        client.destroy();
        serverSide.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const bind = () => {
        const events: SocketState[] = [];
        const handler = SocketHandler.bound({socket: serverSide, port: 0, addr: "127.0.0.1", tls: false, keepAlive: 0},
            (_handler, state) => { if(state !== SocketState.Receive) events.push(state); });
        return {handler, events};
    };

    // REQ-1 — FIN 을 보낸 뒤 상대가 닫지 않는 경우
    test("a drained end_() whose peer never closes is destroyed after the grace time, not before", async () => {
        const {handler, events} = bind();
        handler.end_();
        await new Promise((resolve) => setTimeout(resolve, GRACE / 4));
        expect(events).not.toContain(SocketState.Closed);
        expect(await waitFor(() => events.includes(SocketState.Closed), GRACE * 10)).toBe(true);
        expect(serverSide.destroyed).toBe(true);
        expect(handler.isEnd()).toBe(true);
    });

    // REQ-1 — 남은 출력이 정체 기한 동안 하나도 나가지 않는 경우(상대가 읽지 않음). 짧은 FIN 기한으로 끊지 않는다.
    test("an end_() with output the peer never reads is destroyed after the stall time, not after the short grace", async () => {
        client.pause();
        const {handler, events} = bind();
        for(let n = 0; n < 512; n++) handler.sendData(Buffer.alloc(64 * 1024, 1));
        handler.end_();
        await new Promise((resolve) => setTimeout(resolve, STALL / 2));
        expect(events).not.toContain(SocketState.Closed);
        expect(await waitFor(() => events.includes(SocketState.Closed), STALL * 3)).toBe(true);
        expect(SocketHandler.globalFileCacheSize).toBe(0);
    });

    // REQ-1 — 상대가 먼저 FIN 을 보내고 읽지 않으면, 남은 쓰기 때문에 'close' 가 오지 않는다.
    // 아직 끝나지 않은 쓰기가 있으므로 정체 기한으로 잰다(쓰기가 모두 끝난 경우의 짧은 기한은 아래 커널 없는 테스트가 본다).
    test("a peer that sends FIN first and stops reading is destroyed once the remaining output stalls", async () => {
        client.pause();
        const {handler, events} = bind();
        for(let n = 0; n < 512; n++) handler.sendData(Buffer.alloc(64 * 1024, 1));
        await new Promise((resolve) => setTimeout(resolve, 100));
        client.end();
        expect(await waitFor(() => events.includes(SocketState.End), 3_000)).toBe(true);
        expect(await waitFor(() => events.includes(SocketState.Closed), STALL * 3)).toBe(true);
        expect(serverSide.destroyed).toBe(true);
    });

    // REQ-1 — endImmediate() 도 같다.
    test("an endImmediate() whose peer never closes is destroyed after the grace time", async () => {
        const {handler} = bind();
        handler.endImmediate();
        expect(await waitFor(() => serverSide.destroyed, GRACE * 10)).toBe(true);
    });

    // REQ-2 — 느리게라도 읽는 상대는 남은 출력을 끝까지 받는다. 커널 버퍼(Linux 는 송수신 합쳐 약 10MiB)보다 커서
    // 큐에 남는 양으로 확인한다. 기한을 짧은 FIN 기한으로 재거나 진행할 때 다시 재지 않으면 끊겨 뒷부분을 잃는다.
    test("a slow reader receives all remaining output intact even when it takes longer than the grace and the stall", async () => {
        const payload = crypto.randomBytes(16 * 1024 * 1024);
        const received: Buffer[] = [];
        let total = 0;
        let allowance = 0;
        client.pause();
        // 허용량을 넘으면 바로 멈춘다(넘침은 한 조각까지). 멈추지 않으면 루프백 속도로 다 읽어 버린다.
        client.on("data", (chunk: Buffer) => { received.push(chunk); total += chunk.length; if(total >= allowance) client.pause(); });
        const done = new Promise<void>((resolve) => client.once("end", () => resolve()));
        // 초당 약 2MiB: 50ms 마다 읽을 수 있는 양을 늘린다(16MiB 에 약 8초, 정체 기한보다 길다).
        const throttle = setInterval(() => {
            allowance += 100 * 1024;
            if(total < allowance) client.resume(); else client.pause();
        }, 50);
        try {
            const {handler} = bind();
            // 실제 트래픽처럼 64KiB 조각으로 넣는다. 한 번에 넣으면 소켓이 통째로 받아 큐에 남지 않는다.
            for(let offset = 0; offset < payload.length; offset += 64 * 1024) handler.sendData(payload.subarray(offset, offset + 64 * 1024));
            handler.end_();
            await done;
        } finally { clearInterval(throttle); }
        const all = Buffer.concat(received);
        expect(all.length).toBe(payload.length);
        expect(all.equals(payload)).toBe(true);
    });

    // REQ-2 — 큰 쓰기 하나는 64KiB 조각으로 나뉘어 나가고, 조각마다 쓰기 완료가 진행이 된다.
    // (Windows 는 커널이 한 번에 받아 바로 완료되므로 금방 FIN 단계로 넘어가고, 커널이 남은 것을 보낸다.)
    test("a slow reader of a single large write receives it intact", async () => {
        const payload = crypto.randomBytes(16 * 1024 * 1024);
        const received: Buffer[] = [];
        let total = 0;
        let allowance = 0;
        client.pause();
        client.on("data", (chunk: Buffer) => { received.push(chunk); total += chunk.length; if(total >= allowance) client.pause(); });
        const done = new Promise<void>((resolve) => client.once("end", () => resolve()));
        const throttle = setInterval(() => {
            allowance += 100 * 1024;
            if(total < allowance) client.resume(); else client.pause();
        }, 50);
        try {
            const {handler} = bind();
            handler.sendData(payload);
            handler.end_();
            await done;
        } finally { clearInterval(throttle); }
        const all = Buffer.concat(received);
        expect(all.length).toBe(payload.length);
        expect(all.equals(payload)).toBe(true);
    });

    // REQ-5 — 상대가 정상으로 닫으면 강제 종료는 일어나지 않는다.
    test("a peer that closes normally ends the connection once, without a forced destroy", async () => {
        client.on("end", () => client.end());
        const {handler, events} = bind();
        const destroy = jest.spyOn(handler, "destroy");
        handler.end_();
        expect(await waitFor(() => events.includes(SocketState.Closed), 2_000)).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, GRACE * 2));
        expect(destroy).not.toHaveBeenCalled();
        expect(events.filter((state) => state === SocketState.Closed).length).toBe(1);
    });

    // 큰 버퍼는 64KiB 이하 조각으로 나눠 쓴다. 조각마다 쓰기 완료가 생겨 닫는 중에도 진행을 볼 수 있다(TCP·TLS 모두).
    test("a large sendData is written in pieces of at most 64KiB and its callback runs once", async () => {
        const write = jest.spyOn(serverSide, "write");
        const {handler} = bind();
        let callbacks = 0;
        let received = 0;
        client.on("data", (chunk: Buffer) => { received += chunk.length; });
        handler.sendData(Buffer.alloc(1024 * 1024, 3), () => { callbacks++; });
        expect(await waitFor(() => received === 1024 * 1024 && callbacks === 1, 5_000)).toBe(true);
        const sizes = write.mock.calls.map((call) => (call[0] as Buffer).length);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(64 * 1024);
        expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(1024 * 1024);
        expect(callbacks).toBe(1);
    });

    /** 초당 약 2MiB 로 읽으며 받은 것을 모은다. */
    const slowRead = (socket: net.Socket) => {
        const received: Buffer[] = [];
        let total = 0;
        let allowance = 0;
        socket.pause();
        socket.on("data", (chunk: Buffer) => { received.push(chunk); total += chunk.length; if(total >= allowance) socket.pause(); });
        const done = new Promise<Buffer>((resolve) => socket.once("end", () => resolve(Buffer.concat(received))));
        const throttle = setInterval(() => {
            allowance += 100 * 1024;
            if(total < allowance) socket.resume(); else socket.pause();
        }, 50);
        return {done: done.finally(() => clearInterval(throttle))};
    };

    // REQ-2 — 앞선 작은 쓰기가 모두 끝난 뒤 큰 쓰기 하나가 남아도 끝까지 받는다(Linux 에서 의미 있는 경우).
    test("a slow reader receives a large write that follows completed small writes", async () => {
        const reader = slowRead(client);
        const {handler} = bind();
        const head = crypto.randomBytes(1024 * 1024);
        const tail = crypto.randomBytes(16 * 1024 * 1024);
        handler.sendData(head);
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        handler.sendData(tail);
        handler.end_();
        const all = await reader.done;
        expect(all.length).toBe(head.length + tail.length);
        expect(all.equals(Buffer.concat([head, tail]))).toBe(true);
    });

    // REQ-2 — TLS 에서도 큰 쓰기 하나를 느린 수신자가 끝까지 받는다.
    test("a slow TLS reader receives a single large write intact", async () => {
        const cert = generateSelfSignedCert("127.0.0.1");
        const tlsServer = tls.createServer({key: cert.keyPem, cert: cert.certPem});
        tlsServer.listen(0, "127.0.0.1");
        await once(tlsServer, "listening");
        const tlsClient = tls.connect({port: (tlsServer.address() as net.AddressInfo).port, host: "127.0.0.1", ca: cert.certPem, servername: "127.0.0.1"});
        tlsClient.on("error", () => {});
        const [secure] = await once(tlsServer, "secureConnection") as [tls.TLSSocket];
        try {
            const reader = slowRead(tlsClient);
            const handler = SocketHandler.bound({socket: secure, port: 0, addr: "127.0.0.1", tls: true, keepAlive: 0}, () => {});
            const payload = crypto.randomBytes(16 * 1024 * 1024);
            handler.sendData(payload);
            handler.end_();
            const all = await reader.done;
            expect(all.length).toBe(payload.length);
            expect(all.equals(payload)).toBe(true);
        } finally {
            tlsClient.destroy();
            secure.destroy();
            await new Promise<void>((resolve) => tlsServer.close(() => resolve()));
        }
    });
});

/** 쓰기가 끝나지 않는 소켓(커널의 영향 없이 진행 없음을 만든다). */
class StuckSocket extends EventEmitter {
    public remoteAddress = "127.0.0.1";
    public remotePort = 4020;
    public localAddress = "127.0.0.1";
    public destroyed = false;
    public writableLength = 0;
    public setNoDelay(): this { return this; }
    public setKeepAlive(): this { return this; }
    public setTimeout(): this { return this; }
    public pause(): this { return this; }
    public resume(): this { return this; }
    public pending: Array<(error?: Error | null) => void> = [];
    public write(_buffer: Buffer, callback?: (error?: Error | null) => void): boolean { if(callback) this.pending.push(callback); return false; }
    /** 멈춰 있던 쓰기를 끝낸다. */
    public flush(): void { this.pending.splice(0).forEach((callback) => callback(null)); }
    /** 멈춰 있던 쓰기를 오류로 끝낸다(destroy 뒤 Node 가 남은 쓰기를 ECANCELED 로 끝내는 것과 같다). */
    public fail(error: Error): void { this.pending.splice(0).forEach((callback) => callback(error)); }
    public end(): this { return this; }
    public destroy(): this { this.destroyed = true; this.emit("close"); return this; }
}

describe("SocketHandler close deadlines without a kernel (#248)", () => {
    let previous: {grace: number, stall: number};
    beforeEach(() => {
        previous = {grace: SocketHandler.closeGraceMs, stall: SocketHandler.closeStallMs};
        SocketHandler.closeGraceMs = GRACE;
        SocketHandler.closeStallMs = 2_000;
    });
    afterEach(() => { SocketHandler.closeGraceMs = previous.grace; SocketHandler.closeStallMs = previous.stall; });

    // 상대가 먼저 FIN 을 보냈어도 우리 쓰기가 아직 끝나지 않았으면, 짧은 FIN 기한이 아니라 정체 기한으로 잰다.
    test("a peer FIN while our write is still in flight is timed by the stall deadline, not the short grace", async () => {
        const socket = new StuckSocket();
        const handler = SocketHandler.bound({socket: socket as unknown as net.Socket, port: 0, addr: "127.0.0.1", tls: false, keepAlive: 0}, () => {});
        handler.sendData(Buffer.alloc(1024, 1));
        socket.emit("end");
        await new Promise((resolve) => setTimeout(resolve, GRACE * 3));
        expect(socket.destroyed).toBe(false);
        expect(await waitFor(() => socket.destroyed, 4_000)).toBe(true);
    });

    // 상대의 FIN 뒤 마지막 쓰기가 끝나면 FIN 대기(짧은 기한)로 넘어간다.
    test("after a peer FIN, the deadline switches to the short grace once the last in-flight write completes", async () => {
        const socket = new StuckSocket();
        const handler = SocketHandler.bound({socket: socket as unknown as net.Socket, port: 0, addr: "127.0.0.1", tls: false, keepAlive: 0}, () => {});
        handler.sendData(Buffer.alloc(1024, 1));
        socket.emit("end");
        socket.flush();
        expect(await waitFor(() => socket.destroyed, GRACE * 3)).toBe(true);
    });
});

// #248 — 큰 버퍼를 조각으로 나눠도 메모리·파일 캐시 경로와 예산은 버퍼 전체로 한 번만 정한다.
describe("SocketHandler large sendData routing (#248)", () => {
    let testRoot: TestRoot;
    beforeEach(async () => {
        testRoot = await createTestRoot("socket-handler-split-route");
        applyTestRoot(testRoot.rootDir);
    });
    afterEach(async () => {
        ResourcePolicyRegistry.reset();
        await cleanupTestRoot(testRoot);
    });

    const bindStuck = () => {
        const socket = new StuckSocket();
        const handler = SocketHandler.bound({socket: socket as unknown as net.Socket, port: 0, addr: "127.0.0.1", tls: false, keepAlive: 0}, () => {});
        return {socket, handler};
    };

    // 버퍼 하나가 메모리와 파일로 갈라지면, 메모리 조각(subarray)이 원래 버퍼 전체를 RAM 에 붙잡는데 계산은 일부만 센다.
    test("a buffer that must spill goes to the file cache as a whole, not partly to memory", () => {
        const {handler} = bindStuck();
        try {
            handler.setBufferSizeLimit(256 * 1024);
            handler.sendData(Buffer.alloc(4 * 1024 * 1024, 2));
            expect(SocketHandler.globalMemoryBufferSize).toBe(0);
            // 첫 조각은 이미 쓰기로 나가 파일 캐시 계산에서 빠진다.
            expect(SocketHandler.globalFileCacheSize).toBe(4 * 1024 * 1024 - 64 * 1024);
        } finally { handler.destroy(); }
        expect(SocketHandler.globalFileCacheSize).toBe(0);
    });

    // 예산을 넘는 버퍼는 조각을 하나도 넣기 전에 실패하고, 호출자는 오류와 함께 한 번만 false 를 받는다.
    test("a buffer over the file cache budget fails once with the error and leaves no accounting behind", () => {
        ResourcePolicyRegistry.configure({fileCachePerHandlerLimitBytes: 1024 * 1024, fileCacheGlobalLimitBytes: 64 * 1024 * 1024});
        const {socket, handler} = bindStuck();
        handler.setBufferSizeLimit(256 * 1024);
        const results: Array<{ok: boolean, error?: Error}> = [];
        handler.sendData(Buffer.alloc(8 * 1024 * 1024, 2), (_handler, ok, error) => { results.push({ok, error}); });
        expect(results.length).toBe(1);
        expect(results[0].ok).toBe(false);
        expect(results[0].error?.message).toMatch(/quota/i);
        expect(handler.isEnd()).toBe(true);
        expect(socket.destroyed).toBe(true);
        expect(SocketHandler.globalMemoryBufferSize).toBe(0);
        expect(SocketHandler.globalFileCacheSize).toBe(0);
    });

    // 메모리 경로의 큰 버퍼는 조각(subarray)들이 원래 버퍼를 함께 쓰므로, 마지막 조각이 끝날 때까지 RAM 에 그대로 있다.
    // 메모리 계산도 그때 한 번에 뺀다(조각마다 빼면 실제보다 일찍 줄어 배압이 일찍 풀린다).
    test("memory accounting of a large buffer is released only when its last piece completes", () => {
        const {socket, handler} = bindStuck();
        try {
            handler.sendData(Buffer.alloc(1024 * 1024, 4));
            expect(SocketHandler.globalMemoryBufferSize).toBe(1024 * 1024);
            socket.flush();
            expect(SocketHandler.globalMemoryBufferSize).toBe(1024 * 1024);
        } finally { handler.destroy(); }
        expect(SocketHandler.globalMemoryBufferSize).toBe(0);
    });

    // 조각 몇 개를 파일 캐시에 넣은 뒤 쓰기가 실패해도, 호출자는 오류와 함께 한 번만 false 를 받고 계산은 모두 0 이 된다.
    test("a file cache write that fails after some pieces were queued fails once and leaves no accounting behind", () => {
        const original = FileCache.prototype.writeSync;
        let calls = 0;
        const writeSync = jest.spyOn(FileCache.prototype, "writeSync").mockImplementation(function(this: FileCache, buffer: Buffer) {
            if(++calls === 3) throw new Error("disk full");
            return original.call(this, buffer);
        });
        try {
            const {socket, handler} = bindStuck();
            handler.setBufferSizeLimit(256 * 1024);
            const results: Array<{ok: boolean, error?: Error}> = [];
            handler.sendData(Buffer.alloc(4 * 1024 * 1024, 2), (_handler, ok, error) => { results.push({ok, error}); });
            expect(results).toEqual([{ok: false, error: expect.objectContaining({message: "disk full"})}]);
            expect(socket.destroyed).toBe(true);
            expect(SocketHandler.globalMemoryBufferSize).toBe(0);
            expect(SocketHandler.globalFileCacheSize).toBe(0);
        } finally { writeSync.mockRestore(); }
    });

    // destroy 는 그 핸들러의 메모리 계산을 전역에서 이미 뺀다. 그 뒤 늦게 끝난 쓰기가 다시 빼면,
    // 다른 핸들러가 쓰는 메모리만큼 전역 계산이 줄어 전역 상한이 느슨해진다.
    test("a write that completes after destroy() does not subtract the handler's memory from the global total again", () => {
        const a = bindStuck();
        const b = bindStuck();
        try {
            a.handler.sendData(Buffer.alloc(1024 * 1024, 1));
            b.handler.sendData(Buffer.alloc(32 * 1024, 1));
            expect(SocketHandler.globalMemoryBufferSize).toBe(1024 * 1024 + 32 * 1024);
            b.handler.destroy();
            b.socket.fail(Object.assign(new Error("write ECANCELED"), {code: "ECANCELED"}));
            expect(SocketHandler.globalMemoryBufferSize).toBe(1024 * 1024);
        } finally { a.handler.destroy(); b.handler.destroy(); }
        expect(SocketHandler.globalMemoryBufferSize).toBe(0);
    });
});
