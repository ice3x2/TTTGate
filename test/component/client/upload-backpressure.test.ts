jest.setTimeout(30_000);
import {EventEmitter} from "events";
import TTTClient from "../../../src/client/TTTClient";
import {TunnelClient} from "../../../src/client/TunnelClient";
import EndPointClientPool from "../../../src/client/EndPointClientPool";
import {ClientOption} from "../../../src/types/TunnelingOption";
import {DataHandlerState, TunnelDataHandler} from "../../../src/types/TunnelHandler";
import {EndpointHandler} from "../../../src/types/EndpointHandler";
import SocketState from "../../../src/util/SocketState";
import {SocketHandler} from "../../../src/util/SocketHandler";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";



// 이슈 #129 후속: 서버 쪽(ExternalPortServerPool -> ClientHandlerPool)의 배압 전파는
// test/component/server/backpressure-propagation.test.ts 가 검증하지만, 대칭이어야 할
// 클라이언트 쪽(TunnelClient의 터널 데이터 소켓 -> EndPointClientPool의 목적지 소켓)에는
// 직접 검증이 없었다. 그 결과 클라이언트 쪽 전파 로직이 통째로 누락된 채(#129 자체의
// 미완성) large-transfer 브라우저 E2E(재현율 ~33%)로만 간접 검증되어 놓쳤다.
// 실제 net.Socket 대신, write() 완료 여부와 pause()/resume() 호출만 통제 가능한 소켓을
// SocketHandler.bound() 에 주입해 SocketHandler/TunnelClient/EndPointClientPool/TTTClient는
// 모두 실물을 그대로 사용한다.
class ControllableSocket extends EventEmitter {
    public remoteAddress = "127.0.0.1";
    public remotePort = 4000;
    public localAddress = "127.0.0.1";
    public paused = false;
    // true 인 동안은 write() 콜백을 보류해 대기 큐를 계속 채운다(느린 소비자 모사).
    public stuck = false;
    private pendingFlush: Array<() => void> = [];

    public setNoDelay(): this { return this; }
    public setKeepAlive(): this { return this; }
    public setTimeout(): this { return this; }

    public pause(): this {
        this.paused = true;
        return this;
    }

    public resume(): this {
        this.paused = false;
        return this;
    }

    public write(_buffer: Buffer, callback?: (error?: Error | null) => void): boolean {
        if(this.stuck) {
            this.pendingFlush.push(() => callback?.());
        } else {
            callback?.();
        }
        return true;
    }

    // 보류해 둔 write 콜백을 한번에 흘려보내 서버 쪽 소비 재개를 모사한다.
    public flushPending(): void {
        const items = this.pendingFlush;
        this.pendingFlush = [];
        items.forEach(flush => flush());
    }

    public end(): this {
        this.emit("end");
        this.emit("close");
        return this;
    }

    public destroy(): this {
        this.emit("close");
        return this;
    }
}

const createBoundHandler = (socket: ControllableSocket, port: number): SocketHandler => {
    return SocketHandler.bound({socket: socket as any, port, addr: "127.0.0.1", tls: false, keepAlive: 0}, () => {});
};

const CLIENT_OPTION: ClientOption = {
    key: "hello-TTTGate",
    host: "127.0.0.1",
    port: 0, // connect()를 호출하지 않으므로 실제로 쓰이지 않는다.
    tls: false,
    name: "backpressure-test-client",
    globalMemCacheLimit: 128,
    keepAlive: 0
};

// #130 — 업로드 방향(브라우저 → 내부 서버). 목적지가 느리면 그 세션의 터널 데이터 소켓 읽기를 멈춘다(#129 와 대칭).
describe("endpoint (destination) backpressure propagates to the tunnel data socket", () => {
    let testRoot: TestRoot;
    let client: TTTClient;
    let tunnelClient: TunnelClient;
    let endPointClientPool: EndPointClientPool;

    beforeEach(async () => {
        testRoot = await createTestRoot("client-upload-backpressure");
        applyTestRoot(testRoot.rootDir);
        client = TTTClient.create(CLIENT_OPTION);
        tunnelClient = TunnelClient.create(CLIENT_OPTION);
        endPointClientPool = new EndPointClientPool();
        (client as any)._tunnelClient = tunnelClient;
        (client as any)._endPointClientPool = endPointClientPool;
    });

    afterEach(async () => {
        endPointClientPool.dispose();
        await cleanupTestRoot(testRoot);
    });

    const registerSession = (sessionID: number) => {
        const destinationSocket = new ControllableSocket();
        const destinationHandler = createBoundHandler(destinationSocket, 5000 + sessionID) as EndpointHandler;
        destinationHandler.setBufferSizeLimit(1024);
        (endPointClientPool as any)._endPointClientMap.set(sessionID, destinationHandler);

        const tunnelDataSocket = new ControllableSocket();
        const tunnelDataHandler = createBoundHandler(tunnelDataSocket, 6000 + sessionID) as TunnelDataHandler;
        tunnelDataHandler.sessionID = sessionID;
        tunnelDataHandler.dataHandlerState = DataHandlerState.OnlineSession;
        (tunnelClient as any)._activatedSessionDataHandlerMap.set(sessionID, tunnelDataHandler);
        return {destinationSocket, tunnelDataSocket};
    };

    // 서버에서 온 세션 데이터를 목적지로 보내는 실제 경로(TTTClient.onSessionSendCallback)를 직접 부른다.
    const deliverTunnelData = (sessionID: number, length: number): void => {
        (client as any).onSessionSendCallback(sessionID, Buffer.alloc(length, 3));
    };

    it("목적지 핸들러가 배압 상태가 되면 그 세션의 터널 데이터 소켓을 pause() 한다", () => {
        const {destinationSocket, tunnelDataSocket} = registerSession(1);
        destinationSocket.stuck = true;
        deliverTunnelData(1, 2000);
        expect(tunnelDataSocket.paused).toBe(true);
    });

    it("배압이 풀리면 터널 데이터 소켓을 resume() 한다", () => {
        const {destinationSocket, tunnelDataSocket} = registerSession(2);
        destinationSocket.stuck = true;
        deliverTunnelData(2, 2000);
        expect(tunnelDataSocket.paused).toBe(true);
        destinationSocket.stuck = false;
        destinationSocket.flushPending();
        expect(tunnelDataSocket.paused).toBe(false);
    });

    it("한 세션만 멈춰도 다른 세션의 터널 데이터 소켓은 pause() 되지 않는다", () => {
        const session1 = registerSession(3);
        const session2 = registerSession(4);
        session1.destinationSocket.stuck = true;
        deliverTunnelData(3, 2000);
        expect(session1.tunnelDataSocket.paused).toBe(true);
        expect(session2.tunnelDataSocket.paused).toBe(false);
    });

    it("존재하지 않는 세션 id 로 불러도 예외가 나지 않는다", () => {
        expect(() => deliverTunnelData(999_999, 10)).not.toThrow();
        expect(() => tunnelClient.pauseSessionSource(999_999)).not.toThrow();
        expect(() => tunnelClient.resumeSessionSource(999_999)).not.toThrow();
    });
});
