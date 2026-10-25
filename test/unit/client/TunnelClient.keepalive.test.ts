import {TunnelClient} from "../../../src/client/TunnelClient";
import {SocketHandler} from "../../../src/util/SocketHandler";

describe("TunnelClient keepAlive propagation", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("passes the configured keepAlive interval to the control connection", () => {
        let capturedKeepAlive = -1;
        jest.spyOn(SocketHandler, "connect").mockImplementation((options: any) => {
            capturedKeepAlive = options.keepalive;
            return {handlerType: 0, packetStreamer: undefined, destroy: () => {}} as any;
        });

        const client = TunnelClient.create({
            key: "shared-key",
            host: "127.0.0.1",
            port: 9126,
            tls: false,
            name: "client-a",
            globalMemCacheLimit: 128,
            keepAlive: 43210
        });

        // connect() 는 30초 핸드셰이크 기한(#255)을 건다. 남기면 같은 워커의 뒤 테스트 중에 터져 가짜 연결을 닫으려다
        // 워커를 죽인다(#274). 끝나면 클라이언트를 정리하고 타이머가 남지 않았는지 본다.
        try {
            expect(client.connect()).toBe(true);
            expect(capturedKeepAlive).toBe(43210);
            client.destroy();
            expect((client as any)._handshakeTimer).toBeUndefined();
        } finally {
            client.destroy();
        }
    });
});
