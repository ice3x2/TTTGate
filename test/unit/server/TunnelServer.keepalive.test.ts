import {TunnelServer} from "../../../src/server/TunnelServer";
import {TCPServer} from "../../../src/util/TCPServer";

describe("TunnelServer keepAlive propagation", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("passes the configured keepAlive interval to the control listener", () => {
        const createSpy = jest.spyOn(TCPServer, "create").mockReturnValue({} as any);

        TunnelServer.create({
            port: 9126,
            tls: false,
            key: "shared-key",
            keepAlive: 54321,
            controlProtocolMode: "mixed",
            allowLegacyControlAuth: false,
            trustedClients: []
        }, {
            cert: {name: "", value: ""},
            key: {name: "", value: ""},
            ca: {name: "", value: ""}
        });

        expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
            keepAlive: 54321
        }));
    });
});
