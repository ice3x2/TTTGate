jest.setTimeout(30_000);
import {EventEmitter} from "events";
import {TunnelClient} from "../../../src/client/TunnelClient";
import {CtrlPacket, CtrlPacketStreamer} from "../../../src/commons/CtrlPacket";
import {ClientOption} from "../../../src/types/TunnelingOption";
import {DataHandlerState, TunnelControlHandler, TunnelDataHandler} from "../../../src/types/TunnelHandler";
import {SocketHandler} from "../../../src/util/SocketHandler";
import Dequeue from "../../../src/util/Dequeue";
import {ResourcePolicyRegistry} from "../../../src/util/ResourcePolicy";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

// #257 — 목적지 → 외부 바이트 순서는 Ack 전후로 나뉘어 도착한 데이터에서도 지켜져야 한다.
// 클라이언트는 ResultOfOpenSession 쓰기가 끝나면 데이터 핸들러를 OnlineSession 으로 바꾸지만,
// Ack 전에 모아 둔 대기 버퍼는 SuccessOfOpenSessionAck 를 받아야 비운다. 그 사이 온 데이터가 앞지르면 안 된다.

/** 쓴 바이트를 기록하는 소켓. hold 이면 write 완료 콜백을 붙잡아 둔다(느린 제어 연결). */
class RecordingSocket extends EventEmitter {
    public remoteAddress = "127.0.0.1";
    public remotePort = 4000;
    public localAddress = "127.0.0.1";
    public hold = false;
    public ended = false;
    public written: Buffer[] = [];
    private held: Array<() => void> = [];
    public setNoDelay(): this { return this; }
    public setKeepAlive(): this { return this; }
    public setTimeout(): this { return this; }
    public pause(): this { return this; }
    public resume(): this { return this; }
    public write(buffer: Buffer, callback?: (error?: Error | null) => void): boolean {
        this.written.push(Buffer.from(buffer));
        if(this.hold) this.held.push(() => callback?.()); else callback?.();
        return true;
    }
    public release(): void { const held = this.held; this.held = []; held.forEach((done) => done()); }
    public end(): this { this.ended = true; this.emit("end"); this.emit("close"); return this; }
    public destroy(): this { this.emit("close"); return this; }
}

const bound = (socket: RecordingSocket, port: number) =>
    SocketHandler.bound({socket: socket as any, port, addr: "127.0.0.1", tls: false, keepAlive: 0}, () => {});

const OPTION: ClientOption = {key: "hello-TTTGate", host: "127.0.0.1", port: 0, tls: false, name: "ack-order",
    globalMemCacheLimit: 128, keepAlive: 0};

describe("byte order across SuccessOfOpenSessionAck (#257)", () => {
    let root: TestRoot;
    beforeEach(async () => {
        root = await createTestRoot("client-ack-order");
        applyTestRoot(root.rootDir);
    });
    afterEach(async () => { ResourcePolicyRegistry.reset(); await cleanupTestRoot(root); });

    const setup = () => {
        const tunnel = TunnelClient.create(OPTION) as any;
        const controlSocket = new RecordingSocket();
        const control = bound(controlSocket, 7000) as TunnelControlHandler;
        control.packetStreamer = new CtrlPacketStreamer();
        tunnel._ctrlHandler = control;
        tunnel._state = 2; // CtrlState.Connected
        tunnel._id = 1;
        const dataSocket = new RecordingSocket();
        const data = bound(dataSocket, 6001) as TunnelDataHandler;
        data.sessionID = 41;
        data.handlerID = 541;
        data.dataHandlerState = DataHandlerState.ConnectingEndPoint;
        tunnel._activatedSessionDataHandlerMap.set(41, data);
        tunnel._waitBufferQueueMap.set(41, {queue: new Dequeue<Buffer>(), bytes: 0, limitBytes: -1});
        return {tunnel, control, controlSocket, data, dataSocket};
    };

    // REQ-1 / AC-1 — 목적지가 Ack 전과 후에 연속된 번호를 보낸다. 데이터 연결로 나가는 순서가 번호 순서여야 한다.
    test("data sent before and after the Ack leaves in the order the endpoint produced it", () => {
        const {tunnel, control, controlSocket, data, dataSocket} = setup();
        controlSocket.hold = true;
        expect(tunnel.syncEndpointSession(41)).toBe(true);
        // ResultOfOpenSession 쓰기가 끝나기 전: 대기 버퍼에 쌓인다.
        tunnel.sendData(41, Buffer.from("1,"));
        tunnel.sendData(41, Buffer.from("2,"));
        // 쓰기가 끝났다. 핸들러는 OnlineSession 이지만 Ack 는 아직 오지 않았다.
        controlSocket.release();
        expect(data.dataHandlerState).toBe(DataHandlerState.OnlineSession);
        tunnel.sendData(41, Buffer.from("3,"));
        tunnel.sendData(41, Buffer.from("4,"));
        // 서버가 늦게 Ack 를 보낸다.
        tunnel.onReceiveFromCtrlHandler(control, CtrlPacket.resultOfOpenSessionAck(541, 41).toBuffer());
        tunnel.sendData(41, Buffer.from("5,"));
        expect(Buffer.concat(dataSocket.written).toString()).toBe("1,2,3,4,5,");
        expect(tunnel._waitBufferBytesTotal).toBe(0);
    });

    // REQ-1 — Ack 전에 대기 버퍼가 비어 있으면 OnlineSession 데이터는 그대로 바로 나간다(지연 없음).
    test("with an empty wait buffer, data after the write completes is sent at once", () => {
        const {tunnel, controlSocket, dataSocket} = setup();
        expect(tunnel.syncEndpointSession(41)).toBe(true);
        expect(controlSocket.written.length).toBeGreaterThan(0);
        tunnel.sendData(41, Buffer.from("now"));
        expect(Buffer.concat(dataSocket.written).toString()).toBe("now");
    });

    // #257 리뷰 — 목적지가 Ack 전에 정상으로 끝나도 대기 데이터를 버리지 않는다. 데이터 연결은 Ack 뒤 대기 버퍼를 다 보낸 뒤에 닫는다.
    test("a graceful endpoint end before the Ack still delivers the waiting data, then ends", () => {
        const {tunnel, control, controlSocket, dataSocket} = setup();
        controlSocket.hold = true;
        expect(tunnel.syncEndpointSession(41)).toBe(true);
        tunnel.sendData(41, Buffer.from("1,"));
        controlSocket.release();
        tunnel.sendData(41, Buffer.from("2,"));
        tunnel.terminateEndPointSession(41, "graceful");
        expect(dataSocket.ended).toBe(false);
        tunnel.onReceiveFromCtrlHandler(control, CtrlPacket.resultOfOpenSessionAck(541, 41).toBuffer());
        expect(Buffer.concat(dataSocket.written).toString()).toBe("1,2,");
        expect(dataSocket.ended).toBe(true);
    });

    // #257 리뷰 — 대기 버퍼도 배압으로 본다. 상한에 닿아 세션을 닫기 전에 목적지 읽기를 멈추고, Ack 뒤 비우면 다시 읽게 한다.
    test("a filling wait buffer reports backpressure and relieves it after the Ack flush", () => {
        const {tunnel, control, controlSocket} = setup();
        controlSocket.hold = true;
        expect(tunnel.syncEndpointSession(41)).toBe(true);
        tunnel._waitBufferQueueMap.get(41).limitBytes = 100;
        tunnel.sendData(41, Buffer.alloc(80, 1));
        controlSocket.release();
        expect(tunnel.isSessionBackpressured(41)).toBe(true);
        let relieved = 0;
        tunnel.addSessionPressureReliefListener(41, () => { relieved++; });
        expect(relieved).toBe(0);
        tunnel.onReceiveFromCtrlHandler(control, CtrlPacket.resultOfOpenSessionAck(541, 41).toBuffer());
        expect(relieved).toBe(1);
        expect(tunnel.isSessionBackpressured(41)).toBe(false);
    });

    // #257 리뷰 — 대기 버퍼를 버릴 때(세션 중단)도 기다리던 리스너를 부르고 지운다.
    test("dropping a pressured wait buffer relieves its listeners", () => {
        const {tunnel, controlSocket} = setup();
        controlSocket.hold = true;
        expect(tunnel.syncEndpointSession(41)).toBe(true);
        tunnel._waitBufferQueueMap.get(41).limitBytes = 100;
        tunnel.sendData(41, Buffer.alloc(80, 1));
        let relieved = 0;
        tunnel.addSessionPressureReliefListener(41, () => { relieved++; });
        tunnel.terminateEndPointSession(41);
        expect(relieved).toBe(1);
        expect(tunnel._waitReliefListeners.size).toBe(0);
    });

    // #257 리뷰 — 세션 상한이 없어도 풀 상한(전체 대기 버퍼)의 높은 수위에 닿으면 배압으로 본다.
    test("the pool-wide wait buffer limit also reports backpressure", () => {
        ResourcePolicyRegistry.configure({defaultPoolQueueLimitBytes: 100});
        const {tunnel, control, controlSocket} = setup();
        controlSocket.hold = true;
        expect(tunnel.syncEndpointSession(41)).toBe(true);
        expect(tunnel._waitBufferQueueMap.get(41).limitBytes).toBeLessThanOrEqual(0);
        tunnel.sendData(41, Buffer.alloc(80, 1));
        controlSocket.release();
        expect(tunnel.isSessionBackpressured(41)).toBe(true);
        let relieved = 0;
        tunnel.addSessionPressureReliefListener(41, () => { relieved++; });
        tunnel.onReceiveFromCtrlHandler(control, CtrlPacket.resultOfOpenSessionAck(541, 41).toBuffer());
        expect(relieved).toBe(1);
    });

    // #257 리뷰 — 정상 종료를 미뤄 둔 채 Ack 없이 서버가 데이터 연결을 닫아도 대기 버퍼·핸들러·리스너가 남지 않는다.
    test("a deferred graceful end is cleaned up when the server closes the data connection without an Ack", () => {
        const {tunnel, controlSocket, data} = setup();
        controlSocket.hold = true;
        expect(tunnel.syncEndpointSession(41)).toBe(true);
        tunnel._waitBufferQueueMap.get(41).limitBytes = 100;
        tunnel.sendData(41, Buffer.alloc(80, 1));
        controlSocket.release();
        tunnel.addSessionPressureReliefListener(41, () => {});
        tunnel.terminateEndPointSession(41, "graceful");
        expect(data.endAfterFlush).toBe(true);
        tunnel.onDataHandlerTerminated(data, 41, 541);
        expect(tunnel._waitBufferQueueMap.has(41)).toBe(false);
        expect(tunnel._waitBufferBytesTotal).toBe(0);
        expect(tunnel._activatedSessionDataHandlerMap.has(41)).toBe(false);
        expect(tunnel._waitReliefListeners.size).toBe(0);
    });
});
