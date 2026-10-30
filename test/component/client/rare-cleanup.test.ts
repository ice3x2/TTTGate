jest.setTimeout(30_000);
import net from "net";
import {once, EventEmitter} from "events";
import {TunnelClient} from "../../../src/client/TunnelClient";
import Dequeue from "../../../src/util/Dequeue";
import {ClientOption} from "../../../src/types/TunnelingOption";
import {DataHandlerState, TunnelControlHandler, TunnelDataHandler} from "../../../src/types/TunnelHandler";
import {CtrlPacket, CtrlPacketStreamer} from "../../../src/commons/CtrlPacket";
import SocketState from "../../../src/util/SocketState";
import {SocketHandler} from "../../../src/util/SocketHandler";
import {getFreePort, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

// #254 — 클라이언트의 드문 종료 경로에서 리스너·대기 바이트·타이머·옛 핸들러가 남지 않아야 한다.

/** write 완료를 붙잡아 둘 수 있는 소켓. stuck 이면 출력이 비지 않는다. */
class ControllableSocket extends EventEmitter {
    public remoteAddress = "127.0.0.1";
    public remotePort = 4000;
    public localAddress = "127.0.0.1";
    public stuck = false;
    public destroyed = false;
    public setNoDelay(): this { return this; }
    public setKeepAlive(): this { return this; }
    public setTimeout(): this { return this; }
    public pause(): this { return this; }
    public resume(): this { return this; }
    public write(_buffer: Buffer, callback?: (error?: Error | null) => void): boolean {
        if(!this.stuck) callback?.();
        return !this.stuck;
    }
    public end(): this { this.emit("end"); this.emit("close"); return this; }
    public destroy(): this { this.destroyed = true; this.emit("close"); return this; }
}

const bound = (socket: ControllableSocket, port: number) =>
    SocketHandler.bound({socket: socket as any, port, addr: "127.0.0.1", tls: false, keepAlive: 0}, () => {});

const option = (port = 0): ClientOption => ({key: "hello-TTTGate", host: "127.0.0.1", port, tls: false, name: "rare-cleanup",
    globalMemCacheLimit: 128, keepAlive: 0});

describe("client rare-path cleanup (#254)", () => {
    let root: TestRoot;
    beforeEach(async () => {
        root = await createTestRoot("client-rare-cleanup");
        applyTestRoot(root.rootDir);
    });
    afterEach(async () => {
        jest.restoreAllMocks();
        await cleanupTestRoot(root);
    });

    /** 핸드셰이크를 마친 것처럼 꾸민 TunnelClient. 제어 연결은 가짜 소켓이다. */
    const connectedClient = (port = 0) => {
        const tunnel = TunnelClient.create(option(port)) as any;
        const control = bound(new ControllableSocket(), 7000) as TunnelControlHandler;
        control.packetStreamer = new CtrlPacketStreamer();
        tunnel._ctrlHandler = control;
        tunnel._state = 2; // CtrlState.Connected (내보내지 않은 enum)
        tunnel._id = 1;
        return {tunnel, control};
    };

    const onlineDataHandler = (tunnel: any, sessionID: number, socket = new ControllableSocket()) => {
        const handler = bound(socket, 6000 + sessionID) as TunnelDataHandler;
        handler.sessionID = sessionID;
        handler.handlerID = 500 + sessionID;
        handler.dataHandlerState = DataHandlerState.OnlineSession;
        tunnel._activatedSessionDataHandlerMap.set(sessionID, handler);
        return {handler, socket};
    };

    // REQ-1 / AC-1
    test("ten CloseSession packets for a session whose output is blocked leave one drain listener", () => {
        const {tunnel, control} = connectedClient();
        const {handler, socket} = onlineDataHandler(tunnel, 11);
        let release!: () => void;
        socket.write = (_buffer: Buffer, callback?: (error?: Error | null) => void) => { release = () => callback?.(); return false; };
        handler.sendData(Buffer.alloc(64, 1));
        expect(handler.isOutputDrained).toBe(false);
        const closes: Array<[number, number]> = [];
        tunnel._onEndPointCloseCallback = (sessionID: number, count: number) => closes.push([sessionID, count]);
        for(let n = 0; n < 10; n++) tunnel.onReceiveFromCtrlHandler(control, CtrlPacket.closeSession(handler.handlerID!, 11, 100 + n).toBuffer());
        expect(closes).toEqual([]);
        // 출력이 비면 끝점을 한 번만 닫는다. 리스너가 쌓였다면 열 번 닫는다.
        release();
        expect(closes).toEqual([[11, 109]]);
    });

    // REQ-1 — 리스너는 하나여도 마지막으로 받은 count 로 닫는다.
    test("the single drain listener closes the endpoint with the latest CloseSession count", () => {
        const {tunnel, control} = connectedClient();
        const {handler, socket} = onlineDataHandler(tunnel, 12);
        let release!: () => void;
        socket.write = (_buffer: Buffer, callback?: (error?: Error | null) => void) => { release = () => callback?.(); return false; };
        handler.sendData(Buffer.alloc(64, 1));
        const closes: Array<[number, number]> = [];
        tunnel._onEndPointCloseCallback = (sessionID: number, count: number) => closes.push([sessionID, count]);
        tunnel.onReceiveFromCtrlHandler(control, CtrlPacket.closeSession(handler.handlerID!, 12, 10).toBuffer());
        tunnel.onReceiveFromCtrlHandler(control, CtrlPacket.closeSession(handler.handlerID!, 12, 20).toBuffer());
        release();
        expect(closes).toEqual([[12, 20]]);
    });

    // REQ-2 / AC-2 — 끝점이 다시 열리면(중복 OpenSession) 대기 버퍼 항목을 바꾼다. 옛 항목의 바이트를 반납한다.
    test("replacing the wait buffer on a repeated endpoint sync returns its bytes", () => {
        const {tunnel} = connectedClient();
        const {handler} = onlineDataHandler(tunnel, 21);
        handler.dataHandlerState = DataHandlerState.ConnectingEndPoint;
        tunnel._waitBufferQueueMap.set(21, {queue: new Dequeue<Buffer>(), bytes: 0, limitBytes: -1});
        expect(tunnel.writeWaitBuffer(21, Buffer.alloc(100))).toBe(true);
        expect(tunnel._waitBufferBytesTotal).toBe(100);
        expect(tunnel.syncEndpointSession(21)).toBe(true);
        tunnel.terminateEndPointSession(21);
        expect(tunnel._waitBufferBytesTotal).toBe(0);
    });

    // REQ-2 / AC-2 — 데이터 핸들러가 없어 대기 버퍼를 버릴 때도 바이트를 반납한다.
    test("dropping a wait buffer whose data handler is gone returns its bytes", () => {
        const {tunnel} = connectedClient();
        tunnel._waitBufferQueueMap.set(22, {queue: new Dequeue<Buffer>(), bytes: 0, limitBytes: -1});
        expect(tunnel.writeWaitBuffer(22, Buffer.alloc(100))).toBe(true);
        tunnel.flushWaitBuffer(22);
        expect(tunnel._waitBufferQueueMap.has(22)).toBe(false);
        expect(tunnel._waitBufferBytesTotal).toBe(0);
    });

    // REQ-3 / AC-3 — 거부된 연결은 연결 기한 타이머를 바로 지운다. 남으면 기한(45초)까지 핸들러를 붙잡는다.
    test("a refused connection clears its connect deadline timer at once", async () => {
        const port = await getFreePort();
        const timers: unknown[] = [];
        const setTimeoutSpy = jest.spyOn(global, "setTimeout");
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
        let closed = false;
        SocketHandler.connect({host: "127.0.0.1", port, tls: false, connectTimeout: 45_000}, (_handler, state) => {
            if(state === SocketState.Closed || state === SocketState.End) closed = true;
        });
        setTimeoutSpy.mock.calls.forEach((call, index) => { if(call[1] === 45_000) timers.push(setTimeoutSpy.mock.results[index].value); });
        expect(timers).toHaveLength(1);
        await waitFor(() => { if(!closed) throw new Error("not closed"); return true; }, {timeoutMs: 5000, intervalMs: 20});
        expect(clearTimeoutSpy.mock.calls.some((call) => call[0] === timers[0])).toBe(true);
    });

    // REQ-3 — 연결 중인 핸들러를 destroy 해도 타이머를 지운다.
    test("destroying a connecting handler clears its connect deadline timer", async () => {
        const server = net.createServer(() => {});
        // 접속을 받지 않게 백로그를 채우는 대신, TLS 로 평문 서버에 붙어 핸드셰이크가 끝나지 않게 한다.
        server.on("connection", (socket) => { socket.on("error", () => {}); socket.resume(); });
        server.listen(0, "127.0.0.1"); await once(server, "listening");
        const setTimeoutSpy = jest.spyOn(global, "setTimeout");
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
        try {
            const handler = SocketHandler.connect({host: "127.0.0.1", port: (server.address() as net.AddressInfo).port, tls: true,
                rejectUnauthorized: false, connectTimeout: 45_000} as any, () => {});
            const index = setTimeoutSpy.mock.calls.findIndex((call) => call[1] === 45_000);
            const timer = setTimeoutSpy.mock.results[index].value;
            handler.destroy();
            expect(clearTimeoutSpy.mock.calls.some((call) => call[0] === timer)).toBe(true);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    // REQ-4 / AC-4 — 활성 세션에 NewDataHandler 가 다시 오면 옛 데이터 연결을 닫는다.
    test("a repeated NewDataHandler for an active session closes the old data connection", async () => {
        const accepted: net.Socket[] = [];
        const closed = new Set<net.Socket>();
        const server = net.createServer((socket) => {
            accepted.push(socket);
            socket.on("error", () => {});
            socket.on("close", () => closed.add(socket));
            socket.resume();
        });
        server.listen(0, "127.0.0.1"); await once(server, "listening");
        const {tunnel} = connectedClient((server.address() as net.AddressInfo).port);
        try {
            tunnel.connectDataHandler(801, 31, undefined);
            await waitFor(() => { if(!tunnel._activatedSessionDataHandlerMap.has(31) || accepted.length < 1) throw new Error("first not connected"); return true; }, {timeoutMs: 5000, intervalMs: 20});
            const first = tunnel._activatedSessionDataHandlerMap.get(31);
            // 옛 핸들러에 배압이 걸려 끝점 읽기를 멈춘 상태를 만든다. 옛 핸들러를 닫을 때 해제 리스너가 불려야 끝점이 다시 읽는다.
            Object.defineProperty(first, "isBackpressured", {get: () => true, configurable: true});
            let relieved = false;
            first.addOncePressureReliefListener(() => { relieved = true; });
            expect(relieved).toBe(false);
            tunnel.connectDataHandler(802, 31, undefined);
            await waitFor(() => { if(tunnel._activatedSessionDataHandlerMap.get(31) === first || accepted.length < 2) throw new Error("second not connected"); return true; }, {timeoutMs: 5000, intervalMs: 20});
            await waitFor(() => { if(!closed.has(accepted[0])) throw new Error("old data connection still open"); return true; }, {timeoutMs: 3000, intervalMs: 20});
            expect(closed.has(accepted[1])).toBe(false);
            expect(relieved).toBe(true);
        } finally {
            tunnel.destroy();
            accepted.forEach((socket) => socket.destroy());
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
