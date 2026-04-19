import {TlsOptionsFactoryRegistry} from "../../../src/util/TlsOptionsFactory";

describe("TlsOptionsFactory baseline seam", () => {
    afterEach(() => {
        TlsOptionsFactoryRegistry.reset();
    });

    it("builds client TLS options with verified TLS enabled by default", () => {
        const options = TlsOptionsFactoryRegistry.current().createClientSocketOptions({
            host: "127.0.0.1",
            port: 9126,
            tls: true,
            keepalive: 1000,
            ca: "ca",
            cert: "cert",
            key: "key",
            serverName: "example.test"
        }) as any;

        expect(options).toMatchObject({
            host: "127.0.0.1",
            port: 9126,
            rejectUnauthorized: true,
            ca: "ca",
            cert: "cert",
            key: "key",
            servername: "example.test"
        });
    });

    it("still allows explicit insecure TLS override for legacy fallback", () => {
        const options = TlsOptionsFactoryRegistry.current().createClientSocketOptions({
            host: "127.0.0.1",
            port: 9126,
            tls: true,
            rejectUnauthorized: false
        }) as any;

        expect(options.rejectUnauthorized).toBe(false);
    });

    it("allows test code to override TLS option creation", () => {
        TlsOptionsFactoryRegistry.configure({
            createClientSocketOptions() {
                return {host: "override", port: 1} as any;
            },
            createServerTlsOptions() {
                return {key: "override"} as any;
            }
        });

        const options = TlsOptionsFactoryRegistry.current().createClientSocketOptions({
            host: "127.0.0.1",
            port: 9126
        }) as any;

        expect(options).toEqual({host: "override", port: 1});
    });
});
