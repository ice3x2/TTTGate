import {EventEmitter} from "events";
import {ClientHandlerPool} from "../../../src/server/ClientHandlerPool";
import {SocketHandler} from "../../../src/util/SocketHandler";
import {CtrlPacket} from "../../../src/commons/CtrlPacket";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

class FastWritableSocket extends EventEmitter {
    public remoteAddress = "127.0.0.1";
    public remotePort = 5001;
    public localAddress = "127.0.0.1";

    public setNoDelay(): this {
        return this;
    }

    public setKeepAlive(): this {
        return this;
    }

    public setTimeout(): this {
        return this;
    }

    public pause(): this {
        return this;
    }

    public resume(): this {
        return this;
    }

    public write(_buffer: Buffer, callback?: (error?: Error | null) => void): boolean {
        callback?.(null);
        return true;
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

// #158 — 인증된 클라이언트는 자기 pool 의 세션만 닫거나 결과를 알릴 수 있다. 남의 sessionID 로 보낸 제어 패킷은
// 외부 연결까지 내려가는 종료 콜백을 부르지 않는다.
const parsed = (packet: CtrlPacket): CtrlPacket => {
    const result = CtrlPacket.fromBuffer(packet.toBuffer());
    if(!result.packet) throw new Error(`fixture packet did not parse: ${result.error}`);
    return result.packet;
};

describe("ClientHandlerPool session ownership", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("client-handler-pool-ownership");
        applyTestRoot(testRoot.rootDir);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    const poolWithSession = (id: number, sessionID: number) => {
        const controlHandler = SocketHandler.bound({
            socket: new FastWritableSocket() as any, port: 9126 + id, addr: "127.0.0.1", tls: false, keepAlive: 0
        }, () => {});
        const pool = ClientHandlerPool.create(id, controlHandler);
        const onSessionClose = jest.fn();
        pool.onSessionCloseCallback = onSessionClose;
        // TunnelServer 가 넣는 판정과 같다: 서버 매핑상 이 pool 에 배정된 세션만 소유로 본다.
        pool.isSessionOwned = (candidate: number) => candidate === sessionID;
        pool.sendConnectEndPoint(sessionID, {host: "127.0.0.1", port: 8080, tls: false, bufferLimit: 1024});
        return {pool, controlHandler, onSessionClose};
    };

    it("남의 sessionID 로 온 CloseSession·FailOfOpenSession·SuccessOfOpenSession 은 종료 콜백을 부르지 않는다", () => {
        const a = poolWithSession(1, 100);
        const foreign = 200;
        a.pool.delegateReceivePacketOfControlHandler(a.controlHandler as any, parsed(CtrlPacket.closeSession(7, foreign, 0)));
        a.pool.delegateReceivePacketOfControlHandler(a.controlHandler as any, parsed(CtrlPacket.resultOfOpenSession(7, foreign, false)));
        a.pool.delegateReceivePacketOfControlHandler(a.controlHandler as any, parsed(CtrlPacket.resultOfOpenSession(7, foreign, true)));
        expect(a.onSessionClose.mock.calls.map((call) => call[0])).not.toContain(foreign);
    });

    it("데이터 소켓이 먼저 끊겨 pool 맵이 비어도 소유자의 CloseSession·FailOfOpenSession 은 종료 콜백을 부른다", () => {
        const closed = poolWithSession(3, 102);
        closed.pool.terminateSession(102);
        closed.pool.delegateReceivePacketOfControlHandler(closed.controlHandler as any, parsed(CtrlPacket.closeSession(7, 102, 0)));
        expect(closed.onSessionClose.mock.calls.map((call) => call[0])).toContain(102);

        const failed = poolWithSession(4, 103);
        failed.pool.terminateSession(103);
        failed.pool.delegateReceivePacketOfControlHandler(failed.controlHandler as any, parsed(CtrlPacket.resultOfOpenSession(7, 103, false)));
        expect(failed.onSessionClose.mock.calls.map((call) => call[0])).toContain(103);
    });

    it("자기 세션의 CloseSession 은 지금처럼 종료 콜백을 부른다", () => {
        const a = poolWithSession(2, 101);
        a.pool.delegateReceivePacketOfControlHandler(a.controlHandler as any, parsed(CtrlPacket.closeSession(7, 101, 0)));
        expect(a.onSessionClose.mock.calls.map((call) => call[0])).toContain(101);
    });
});
