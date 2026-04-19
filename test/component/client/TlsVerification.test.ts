import tls from "tls";
import forge from "node-forge";
import {SocketHandler} from "../../../src/util/SocketHandler";
import SocketState from "../../../src/util/SocketState";
import {getFreePort, waitFor} from "../../helpers/network";
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

    it("rejects a TLS server that is not anchored in the configured trust store", async () => {
        const certInfo = await createLocalhostCert();
        const port = await getFreePort();
        const server = tls.createServer({
            key: certInfo.key,
            cert: certInfo.cert
        });
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(port, "127.0.0.1", () => resolve());
        });

        const events: SocketState[] = [];
        let handlerRef: SocketHandler | undefined;
        SocketHandler.connect({
            host: "localhost",
            port,
            tls: true
        }, (_handler, state) => {
            handlerRef = _handler;
            events.push(state);
        });

        await waitFor(() => {
            if(!events.includes(SocketState.Closed)) {
                throw new Error("TLS client did not reject the untrusted server");
            }
            return true;
        }, {timeoutMs: 5000, intervalMs: 25});

        handlerRef?.destroy();
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    });

    it("accepts the TLS server when the matching CA is configured", async () => {
        const certInfo = await createLocalhostCert();
        const port = await getFreePort();
        const server = tls.createServer({
            key: certInfo.key,
            cert: certInfo.cert
        });
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(port, "127.0.0.1", () => resolve());
        });

        const events: SocketState[] = [];
        let handlerRef: SocketHandler | undefined;
        SocketHandler.connect({
            host: "localhost",
            port,
            tls: true,
            ca: certInfo.cert,
            serverName: "localhost"
        }, (_handler, state) => {
            handlerRef = _handler;
            events.push(state);
        });

        await waitFor(() => {
            if(!events.includes(SocketState.Connected)) {
                throw new Error("TLS client did not connect with the configured CA");
            }
            if(events.includes(SocketState.Closed)) {
                throw new Error("TLS client connected and then closed unexpectedly");
            }
            return true;
        }, {timeoutMs: 5000, intervalMs: 25});

        handlerRef?.destroy();
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    });
});
