import {EventEmitter} from "events";
import {SocketHandler} from "../../../src/util/SocketHandler";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

// #169 — 출력이 비면 updateInputPressure 가 resumeRead 를 불러, 다른 주체(대역폭 제한·하류 배압)가 건 일시정지까지 풀었다.
class PausableSocket extends EventEmitter {
    public remoteAddress = "127.0.0.1"; public remotePort = 5100; public localAddress = "127.0.0.1";
    public paused = false;
    public setNoDelay(): this { return this; }
    public setKeepAlive(): this { return this; }
    public setTimeout(): this { return this; }
    public pause(): this { this.paused = true; return this; }
    public resume(): this { this.paused = false; return this; }
    public stuck = false;
    public write(_buffer: Buffer, callback?: (error?: Error | null) => void): boolean { if(!this.stuck) callback?.(null); return true; }
    public end(): this { this.emit("end"); this.emit("close"); return this; }
    public destroy(): this { this.emit("close"); return this; }
}

describe("SocketHandler pause reasons", () => {
    let testRoot: TestRoot;
    beforeEach(async () => { testRoot = await createTestRoot("socket-pause-reasons"); applyTestRoot(testRoot.rootDir); });
    afterEach(async () => { await cleanupTestRoot(testRoot); });

    const bound = () => {
        const socket = new PausableSocket();
        const handler = SocketHandler.bound({socket: socket as any, port: 9200, addr: "127.0.0.1", tls: false, keepAlive: 0}, () => {});
        handler.setBufferSizeLimit(1024);
        return {socket, handler};
    };

    it("does not resume a read paused by another owner when its own output drains", () => {
        const {socket, handler} = bound();
        handler.pauseRead("bandwidth");
        handler.sendData(Buffer.alloc(16, 1));
        expect(socket.paused).toBe(true);
        handler.resumeRead("bandwidth");
        expect(socket.paused).toBe(false);
    });

    // #169 B — 자기 출력이 밀린다고 반대 방향(자기 읽기)을 멈추면, 업로드가 끝나야 응답을 읽는 클라이언트와 응답을 먼저 흘리는
    // 백엔드 사이에서 양쪽이 서로 기다린다. 배압은 상대 소켓으로 전파(#129·#163·#130)하고 자기 읽기는 멈추지 않는다.
    it("does not pause its own read because its own output is backpressured", () => {
        const {socket, handler} = bound();
        socket.stuck = true;
        handler.sendData(Buffer.alloc(4096, 1));
        expect(handler.isBackpressured).toBe(true);
        expect(socket.paused).toBe(false);
    });

    it("resumes only after every owner released its pause", () => {
        const {socket, handler} = bound();
        handler.pauseRead("bandwidth");
        handler.pauseRead("downstream");
        handler.resumeRead("bandwidth");
        expect(socket.paused).toBe(true);
        handler.resumeRead("downstream");
        expect(socket.paused).toBe(false);
    });
});
