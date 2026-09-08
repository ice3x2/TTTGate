import tls from "tls";
import {once} from "node:events";
import {TlsOptionsFactoryRegistry} from "../../../src/util/TlsOptionsFactory";
import forge from "node-forge";
import {SocketHandler} from "../../../src/util/SocketHandler";
import SocketState from "../../../src/util/SocketState";
import {waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(30000);

describe("TLS verification defaults", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("tls-verification");
        applyTestRoot(testRoot.rootDir);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    const createLocalhostCert = async (): Promise<{key: string, cert: string}> => {
        const keys = await new Promise<forge.pki.KeyPair>((resolve, reject) => {
            forge.pki.rsa.generateKeyPair({bits: 2048}, (error, pair) => {
                if(error) {
                    reject(error);
                    return;
                }
                resolve(pair);
            });
        });
        const cert = forge.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = "01";
        cert.validity.notBefore = new Date(Date.now() - 60_000);
        cert.validity.notAfter = new Date(Date.now() + 86_400_000);
        cert.setSubject([{name: "commonName", value: "localhost"}]);
        cert.setIssuer([{name: "commonName", value: "localhost"}]);
        cert.setExtensions([
            {name: "basicConstraints", cA: false},
            {name: "keyUsage", digitalSignature: true, keyEncipherment: true},
            {name: "extKeyUsage", serverAuth: true},
            {
                name: "subjectAltName",
                altNames: [{type: 2, value: "localhost"}]
            }
        ]);
        cert.sign(keys.privateKey, forge.md.sha256.create());
        return {
            key: forge.pki.privateKeyToPem(keys.privateKey),
            cert: forge.pki.certificateToPem(cert)
        };
    };

    const withPeer = async (check: (peer: {port: number; cert: string; application: Buffer[]; closeAfterSecure: () => void}) => Promise<void>) => {
        const certInfo = await createLocalhostCert();
        const sockets = new Set<tls.TLSSocket>();
        const application: Buffer[] = [];
        let closeSecure = false;
        const server = tls.createServer({key: certInfo.key, cert: certInfo.cert}, socket => {
            sockets.add(socket);
            socket.on("data", data => { application.push(Buffer.from(data)); socket.write(data); });
            if(closeSecure) socket.end("owned-insecure-welcome");
        });
        server.on("connection", socket => { sockets.add(socket as tls.TLSSocket); socket.on("error", () => {}); });
        server.on("tlsClientError", () => {});
        server.listen(0, "127.0.0.1"); await once(server, "listening");
        try { await check({port: (server.address() as import("node:net").AddressInfo).port, cert: certInfo.cert,
            application, closeAfterSecure: () => { closeSecure = true; }}); }
        finally { sockets.forEach(socket => socket.destroy()); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    };

    const observe = (port: number, ca?: string) => {
        const events: SocketState[] = [], errors: string[] = [], received: Buffer[] = [];
        let secure = 0;
        const handler = SocketHandler.connect({host: "127.0.0.1", serverName: "localhost", port, tls: true, ...(ca ? {ca} : {})},
            (_handler, state, data) => { events.push(state); if(state === SocketState.Receive) received.push(Buffer.from(data)); });
        const socket = handler.socket as tls.TLSSocket;
        // Registered synchronously before returning to the event loop.
        socket.on("secureConnect", () => { secure++; });
        socket.on("error", (error: NodeJS.ErrnoException) => errors.push(error.code ?? "unknown"));
        return {handler, socket, events, errors, received, secure: () => secure};
    };

    const trustedEcho = async (peer: {port: number; cert: string; application: Buffer[]}) => {
        const connection = observe(peer.port, peer.cert);
        try {
            await waitFor(() => { expect(connection.secure()).toBe(1); return true; }, {timeoutMs: 5000, intervalMs: 25});
            expect(connection.socket.authorized).toBe(true);
            const before = Buffer.concat(peer.application).length;
            const marker = Buffer.from("owned-trusted-TLS-echo");
            connection.handler.sendData(marker);
            await waitFor(() => { expect(Buffer.concat(connection.received)).toEqual(marker); return true; }, {timeoutMs: 5000, intervalMs: 25});
            expect(Buffer.concat(peer.application).subarray(before)).toEqual(marker);
            expect(connection.errors).toEqual([]);
            expect(connection.events).not.toContain(SocketState.Closed);
        } finally { connection.handler.destroy(); }
    };

    it("rejects untrusted native TLS establishment and leaves the same peer usable", async () => withPeer(async peer => {
        const original = TlsOptionsFactoryRegistry.current();
        const mutation = process.env.TTTGATE_TLS57_SENSITIVITY === "1";
        if(mutation) {
            peer.closeAfterSecure();
            TlsOptionsFactoryRegistry.configure({...original, createClientSocketOptions(options) {
                return {...original.createClientSocketOptions(options), rejectUnauthorized: false};
            }});
        }
        const connection = observe(peer.port);
        TlsOptionsFactoryRegistry.configure(original);
        try {
            await waitFor(() => { expect(connection.events).toContain(SocketState.Closed); return true; }, {timeoutMs: 5000, intervalMs: 25});
            // The old Closed-only contract passes even in the declared insecure run.
            expect(connection.events).toContain(SocketState.Closed);
            if(mutation) console.info(JSON.stringify({sensitivity: true, oldClosedOnly: true, nativeSecure: connection.secure(), receivedBytes: Buffer.concat(connection.received).length}));
            expect(connection.secure()).toBe(0);
            expect(connection.socket.authorized).toBe(false);
            expect(connection.errors).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
            expect(connection.socket.authorizationError).toBeTruthy();
            expect(connection.received).toHaveLength(0);
            expect(peer.application).toHaveLength(0);
        } finally { connection.handler.destroy(); TlsOptionsFactoryRegistry.configure(original); }
        await trustedEcho(peer);
    }));

    it("accepts matching trust only after native secureConnect and actual echo", async () => withPeer(trustedEcho));
});
