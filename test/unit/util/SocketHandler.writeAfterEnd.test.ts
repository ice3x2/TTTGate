import net from "net";
import {once} from "events";
import {SocketHandler} from "../../../src/util/SocketHandler";
import LoggerFactory from "../../../src/util/logger/LoggerFactory";

// #260 — end_() 뒤의 쓰기와, 리스너를 지운 뒤 늦게 오는 'error' 가 프로세스를 끝내지 않는다.
describe("SocketHandler after end_() / release (#260)", () => {
    let server: net.Server;
    let client: net.Socket;
    let serverSide: net.Socket;

    beforeEach(async () => {
        server = net.createServer();
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
        client.on("error", () => {});
        [serverSide] = await once(server, "connection") as [net.Socket];
    });
    afterEach(async () => {
        client.destroy();
        serverSide.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const bind = () => SocketHandler.bound({socket: serverSide, port: 0, addr: "127.0.0.1", tls: false, keepAlive: 0}, () => {});

    // REQ-2 / AC-2
    test("sendData after end_() on a drained handler fails without writing to the socket", () => {
        const handler = bind();
        handler.end_();
        // 출력이 비어 있으므로 바로 FIN 을 보낸다(REQ-3).
        expect(serverSide.writableEnded).toBe(true);
        const write = jest.spyOn(serverSide, "write");
        let result: boolean | undefined;
        handler.sendData(Buffer.from("late"), (_handler, success) => { result = success; });
        expect(result).toBe(false);
        expect(write).not.toHaveBeenCalled();
    });

    // REQ-1 / AC-3
    test.each([
        ["destroy()", (handler: SocketHandler) => handler.destroy()],
        // 소켓 오류는 procError → release() 를 거친다.
        ["release() after a socket error", () => serverSide.emit("error", new Error("boom"))],
    ])("an 'error' emitted on the socket after %s does not throw", (_label, close) => {
        // procError 가 남기는 오류 로그는 이 테스트의 관심사가 아니다.
        const error = jest.spyOn(LoggerFactory.getLogger("socket", "SocketHandler"), "error").mockImplementation(() => undefined as any);
        // 소켓 'error' 리스너는 procError 전에 console.error 로도 남긴다.
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const handler = bind();
            close(handler);
            expect(() => serverSide.emit("error", new Error("late error"))).not.toThrow();
        } finally { error.mockRestore(); consoleError.mockRestore(); }
    });
});
