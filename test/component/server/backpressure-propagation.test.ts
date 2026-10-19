import {EventEmitter} from "events";
import TTTServer from "../../../src/server/TTTServer";
import {ClientHandlerPool} from "../../../src/server/ClientHandlerPool";
import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {DEFAULT_KEY, ServerOption} from "../../../src/types/TunnelingOption";
import {DataHandlerState} from "../../../src/types/TunnelHandler";
import {SocketHandler} from "../../../src/util/SocketHandler";
import SocketState from "../../../src/util/SocketState";
import {getFreePort} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(30_000);

// 이슈 #129: 세션 다운스트림(ExternalPortServerPool 핸들러)이 배압 상태가 되어도
// 터널 소스(ClientHandlerPool 의 세션 데이터 핸들러)로 신호가 전파되지 않아
// 대용량 전송 중 파일 캐시 한도 초과 → destroy() 로 연결이 끊기는 결함을 재현/검증한다.
// 실제 net.Socket 대신, write() 완료 여부와 pause()/resume() 호출만 통제 가능한
// 소켓을 SocketHandler.bound() 에 주입해 SocketHandler/ExternalPortServerPool/
// ClientHandlerPool/TunnelServer/TTTServer 는 모두 실물을 그대로 사용한다.
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

    // 보류해 둔 write 콜백을 한번에 흘려보내 다운스트림 소비 재개를 모사한다.
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

describe("session downstream backpressure propagates to the tunnel source", () => {
    let testRoot: TestRoot;
    let server: TTTServer;
    let serverPort: number;

    beforeEach(async () => {
        testRoot = await createTestRoot("backpressure-propagation");
        applyTestRoot(testRoot.rootDir);
        await CertificationStore.instance.load();
        serverPort = await getFreePort();
        const serverOption: ServerOption = {
            key: DEFAULT_KEY,
            adminPort: 9300,
            adminBindHost: "127.0.0.1",
            adminTls: true,
            port: serverPort,
            tls: false,
            tunnelingOptions: [],
            keepAlive: 0,
            globalMemCacheLimit: 128
        };
        ServerOptionStore.instance.updateServerOption(serverOption);
        server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();
    });

    afterEach(async () => {
        await server?.close();
        await cleanupTestRoot(testRoot);
    });

    // 세션마다: 소스(터널 데이터 핸들러) + 다운스트림(외부 포트 핸들러)을 등록하고
    // 필요한 내부 맵에 직접 연결한다(실제 핸드셰이크는 이 결함과 무관하므로 생략).
    const registerSession = (sessionID: number, ctrlID: number) => {
        const tunnelServer: any = server.tunnelServer;
        const controlHandler = createBoundHandler(new ControllableSocket(), 6000 + ctrlID);
        const pool = ClientHandlerPool.create(ctrlID, controlHandler);
        tunnelServer._clientHandlerPoolMap.set(ctrlID, pool);
        tunnelServer._sessionIDAndCtrlIDMap.set(sessionID, ctrlID);

        const sourceSocket = new ControllableSocket();
        const sourceHandler: any = createBoundHandler(sourceSocket, 7000 + sessionID);
        sourceHandler.sessionID = sessionID;
        sourceHandler.dataHandlerState = DataHandlerState.OnlineSession;
        (pool as any)._activatedSessionHandlerMap_.set(sessionID, sourceHandler);

        const downstreamSocket = new ControllableSocket();
        const downstreamHandler = createBoundHandler(downstreamSocket, 8000 + sessionID);
        downstreamHandler.setBufferSizeLimit(1024);
        (server as any)._externalPortServerPool._handlerMap.set(sessionID, downstreamHandler);

        return {sourceSocket, downstreamSocket};
    };

    const deliverSessionData = (sessionID: number, length: number): void => {
        (server as any).onSessionDataReceived(sessionID, Buffer.alloc(length, 1));
    };

    it("pauses the session's tunnel source socket once its downstream handler becomes backpressured", () => {
        const {sourceSocket, downstreamSocket} = registerSession(1, 1);
        downstreamSocket.stuck = true;

        deliverSessionData(1, 2000);

        expect(sourceSocket.paused).toBe(true);
    });

    it("resumes the session's tunnel source socket once the downstream handler drains and relieves pressure", () => {
        const {sourceSocket, downstreamSocket} = registerSession(2, 2);
        downstreamSocket.stuck = true;

        deliverSessionData(2, 2000);
        expect(sourceSocket.paused).toBe(true);

        downstreamSocket.stuck = false;
        downstreamSocket.flushPending();

        expect(sourceSocket.paused).toBe(false);
    });

    it("does not pause an unrelated session's source when only one session is backpressured", () => {
        const session1 = registerSession(3, 3);
        const session2 = registerSession(4, 4);
        session1.downstreamSocket.stuck = true;

        deliverSessionData(3, 2000);

        expect(session1.sourceSocket.paused).toBe(true);
        expect(session2.sourceSocket.paused).toBe(false);
    });

    // #163 — 업로드 방향(외부 → 터널)도 같은 배압이 필요하다. 터널 데이터 소켓이 밀리면 외부 소켓 읽기를 멈춘다.
    const deliverExternalData = (sessionID: number, length: number): void => {
        (server as any).onHandlerEventOnExternalPortServer(sessionID, SocketState.Receive, {data: Buffer.alloc(length, 2), receiveLength: length});
    };

    it("pauses the external socket when the tunnel data socket for the session is backpressured, and resumes on relief", () => {
        const {sourceSocket, downstreamSocket} = registerSession(5, 5);
        const tunnelHandler: any = (server.tunnelServer as any)._clientHandlerPoolMap.get(5)._activatedSessionHandlerMap_.get(5);
        tunnelHandler.setBufferSizeLimit(1024);
        sourceSocket.stuck = true;

        deliverExternalData(5, 2000);
        expect(downstreamSocket.paused).toBe(true);

        sourceSocket.stuck = false;
        sourceSocket.flushPending();
        expect(downstreamSocket.paused).toBe(false);
    });

    // #163 — 세션이 열리기 전에 들어온 업로드는 대기 큐에 쌓인다. 한도에 가까우면 외부 소켓을 멈추고, 큐가 비면 다시 읽는다.
    it("pauses the external socket while the session-opening wait queue is near its limit", () => {
        const tunnelServer: any = server.tunnelServer;
        const pool = ClientHandlerPool.create(9, createBoundHandler(new ControllableSocket(), 6009));
        tunnelServer._clientHandlerPoolMap.set(9, pool);
        tunnelServer._sessionIDAndCtrlIDMap.set(10, 9);
        pool.sendConnectEndPoint(10, {host: "127.0.0.1", port: 9, tls: false, bufferLimit: 4096} as any);
        const downstreamSocket = new ControllableSocket();
        (server as any)._externalPortServerPool._handlerMap.set(10, createBoundHandler(downstreamSocket, 8010));

        deliverExternalData(10, 3500);
        expect(downstreamSocket.paused).toBe(true);

        pool.terminateSession(10);
        expect(downstreamSocket.paused).toBe(false);
    });

    it("does not pause the external socket while the tunnel data socket keeps up", () => {
        const {downstreamSocket} = registerSession(6, 6);
        deliverExternalData(6, 2000);
        expect(downstreamSocket.paused).toBe(false);
    });

    it("does not throw when pausing or resuming a session id that has no registered source", () => {
        const tunnelServer = server.tunnelServer;

        expect(() => tunnelServer.pauseSessionSource(999_999)).not.toThrow();
        expect(() => tunnelServer.resumeSessionSource(999_999)).not.toThrow();
    });
});
