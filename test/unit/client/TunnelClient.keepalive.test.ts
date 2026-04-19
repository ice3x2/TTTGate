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
            return {handlerType: 0, packetStreamer: undefined} as any;
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

        expect(client.connect()).toBe(true);
        expect(capturedKeepAlive).toBe(43210);
    });
});
