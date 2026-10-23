import net from "net";
import {once} from "events";
import {createTunnelHarness, TunnelHarness} from "../../helpers/tunnelHarness";

jest.setTimeout(120_000);

const MiB = 1048576;

/** 서버 쪽 외부 핸들러들의 요청·응답 파이프 버퍼 중 가장 큰 값을 주기적으로 잰다. */
const sampleBuffers = (harness: TunnelHarness, pipe: "_requestPipe" | "_responsePipe") => {
    let max = 0;
    const timer = setInterval(() => {
        const handlers = ((harness.getServer() as any)?._externalPortServerPool?._handlerMap as Map<number, any> | undefined)?.values() ?? [];
        for(const handler of handlers) max = Math.max(max, handler[pipe]?.bufferSize ?? 0);
    }, 5);
    return {stop: () => { clearInterval(timer); return max; }};
};

const waitClosed = async (closed: () => boolean, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while(!closed() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
};

// #246 — chunk 크기 줄을 줄바꿈 없이 끝없이 보내도 서버 버퍼가 커지지 않고 연결이 닫힌다.
describe("an endless chunk-size line through an HTTP tunnel (#246)", () => {
    let harness: TunnelHarness | undefined;
    let destination: net.Server | undefined;
    const sockets = new Set<net.Socket>();
    afterEach(async () => {
        sockets.forEach((socket) => socket.destroy());
        sockets.clear();
        await harness?.dispose();
        if(destination) await new Promise<void>((resolve) => destination!.close(() => resolve()));
        harness = undefined; destination = undefined;
    });

    const startTunnel = async (onDestination: (socket: net.Socket) => void) => {
        destination = net.createServer((socket) => { sockets.add(socket); socket.on("error", () => {}); onDestination(socket); });
        destination.listen(0, "127.0.0.1");
        await once(destination, "listening");
        const destinationPort = (destination.address() as net.AddressInfo).port;
        harness = await createTunnelHarness({clients: [{clientId: "chunk-line", clientSecret: "chunk-line-secret",
            endpointFactory: async () => ({port: destinationPort, close: async () => {}}), tunnelingOptionOverride: {protocol: "http"} as any}]});
        await harness.start();
        const socket = net.connect(harness.forwardPort, "127.0.0.1");
        sockets.add(socket);
        socket.on("error", () => {});
        let closed = false;
        socket.once("close", () => { closed = true; });
        await once(socket, "connect");
        return {socket, closed: () => closed};
    };

    test("AC-3 (request) the server closes the connection and its request buffer stays under 1MiB", async () => {
        let destinationBytes = 0;
        const {socket, closed} = await startTunnel((socket) => socket.on("data", (chunk) => { destinationBytes += chunk.length; }));
        const sampler = sampleBuffers(harness!, "_requestPipe");
        socket.write("POST /up HTTP/1.1\r\nHost: chunk.example\r\nTransfer-Encoding: chunked\r\n\r\n");
        const piece = Buffer.alloc(MiB, "1");
        for(let sent = 0; sent < 32 && !closed(); sent++) {
            // 서버가 끊으면 쓰기에서 ECONNRESET 이 난다. 그것이 기대한 결과이므로 오류로 기다림을 끝내지 않는다.
            if(!socket.write(piece)) await new Promise<void>((resolve) => { socket.once("drain", resolve); socket.once("close", resolve); });
        }
        await waitClosed(closed, 10_000);
        const maxBuffer = sampler.stop();

        expect(closed()).toBe(true);
        expect(maxBuffer).toBeLessThan(MiB);
        // 헤더는 목적지로 넘어가지만, 크기 줄의 바이트는 넘어가지 않는다.
        expect(destinationBytes).toBeLessThan(1024);
    });

    test("AC-3 (response) a destination that streams an endless chunk-size line gets the external connection closed", async () => {
        let destinationSocket: net.Socket | undefined;
        const {socket, closed} = await startTunnel((socket) => {
            destinationSocket = socket;
            socket.once("data", async () => {
                socket.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n");
                const piece = Buffer.alloc(256 * 1024, "1");
                for(let sent = 0; sent < 128 && !socket.destroyed; sent++) {
                    if(!socket.write(piece)) await new Promise<void>((resolve) => { socket.once("drain", resolve); socket.once("close", resolve); });
                }
            });
        });
        const sampler = sampleBuffers(harness!, "_responsePipe");
        let received = 0;
        socket.on("data", (chunk) => { received += chunk.length; });
        socket.write("GET / HTTP/1.1\r\nHost: chunk.example\r\n\r\n");
        await waitClosed(closed, 20_000);
        const maxBuffer = sampler.stop();

        expect(closed()).toBe(true);
        expect(maxBuffer).toBeLessThan(MiB);
        // 응답 헤더는 전달될 수 있지만 크기 줄의 바이트는 전달되지 않는다.
        expect(received).toBeLessThan(1024);
        expect(destinationSocket).toBeDefined();
    });
});
