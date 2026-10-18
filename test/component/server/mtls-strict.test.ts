import crypto from "crypto";
import tls from "tls";
import {once} from "node:events";
import forge from "node-forge";
import {TlsOptionsFactoryRegistry} from "../../../src/util/TlsOptionsFactory";
import {TunnelServer} from "../../../src/server/TunnelServer";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(30_000);

// #159 — mtls-strict 는 검증된 TLS 클라이언트 인증서를 요구해야 한다(SRS MODE-CTRL-PROTO-001).
type Issued = {key: string; cert: string};

const keyPair = () => {
    const {privateKey, publicKey} = crypto.generateKeyPairSync("rsa", {modulusLength: 2048});
    return {privateKey: privateKey.export({type: "pkcs1", format: "pem"}).toString(), publicKey: publicKey.export({type: "spki", format: "pem"}).toString()};
};

const issue = (subject: string, signer: {key: string; cert?: forge.pki.Certificate}, options: {ca?: boolean; server?: boolean} = {}): Issued & {certificate: forge.pki.Certificate} => {
    const pair = keyPair();
    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.publicKeyFromPem(pair.publicKey);
    cert.serialNumber = crypto.randomBytes(8).toString("hex");
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    cert.validity.notAfter = new Date(Date.now() + 86_400_000);
    cert.setSubject([{name: "commonName", value: subject}]);
    cert.setIssuer(signer.cert ? signer.cert.subject.attributes : [{name: "commonName", value: subject}]);
    cert.setExtensions([
        {name: "basicConstraints", cA: options.ca === true},
        {name: "keyUsage", digitalSignature: true, keyEncipherment: true, keyCertSign: options.ca === true},
        ...(options.server ? [{name: "extKeyUsage", serverAuth: true}, {name: "subjectAltName", altNames: [{type: 2, value: "localhost"}]}] : []),
        ...(!options.ca && !options.server ? [{name: "extKeyUsage", clientAuth: true}] : [])
    ]);
    cert.sign(forge.pki.privateKeyFromPem(signer.cert ? signer.key : pair.privateKey), forge.md.sha256.create());
    return {key: pair.privateKey, cert: forge.pki.certificateToPem(cert), certificate: cert};
};

describe("mtls-strict client certificates", () => {
    let testRoot: TestRoot;
    beforeEach(async () => { testRoot = await createTestRoot("mtls-strict"); applyTestRoot(testRoot.rootDir); });
    afterEach(async () => { await cleanupTestRoot(testRoot); });

    it("server TLS options request and verify client certificates only when asked", () => {
        const factory = TlsOptionsFactoryRegistry.current();
        const strict = factory.createServerTlsOptions({port: 1, tls: true, key: "k", cert: "c", ca: "ca", requestClientCert: true} as any);
        expect({requestCert: strict.requestCert, rejectUnauthorized: strict.rejectUnauthorized}).toEqual({requestCert: true, rejectUnauthorized: true});
        const plain = factory.createServerTlsOptions({port: 1, tls: true, key: "k", cert: "c"} as any);
        expect(plain.requestCert).toBeFalsy();
    });

    it("tunnel control listener requests client certificates in mtls-strict mode only", () => {
        const ca = issue("test-ca", {key: ""}, {ca: true});
        const server = issue("localhost", {key: ca.key, cert: ca.certificate}, {server: true});
        const certInfo = {key: {name: "k", value: server.key}, cert: {name: "c", value: server.cert}, ca: {name: "ca", value: ca.cert}} as any;
        const base = {port: 1, tls: true, key: "shared", keepAlive: 0, allowLegacyControlAuth: false};
        const strict: any = TunnelServer.create({...base, controlProtocolMode: "mtls-strict"}, certInfo);
        const mixed: any = TunnelServer.create({...base, controlProtocolMode: "mixed"}, certInfo);
        expect(strict._tunnelServer._options.requestClientCert).toBe(true);
        expect(mixed._tunnelServer._options.requestClientCert).toBeFalsy();
        expect(strict._strictWithoutClientCa).toBe(false);
        const noCa: any = TunnelServer.create({...base, controlProtocolMode: "mtls-strict"}, {...certInfo, ca: {name: "", value: ""}});
        expect(noCa._strictWithoutClientCa).toBe(true);
    });

    it("strict handshake checks the verified client certificate, not just TLS", () => {
        const ca = issue("test-ca", {key: ""}, {ca: true});
        const server = issue("localhost", {key: ca.key, cert: ca.certificate}, {server: true});
        const certInfo = {key: {name: "k", value: server.key}, cert: {name: "c", value: server.cert}, ca: {name: "ca", value: ca.cert}} as any;
        const strict: any = TunnelServer.create({port: 1, tls: true, key: "shared", keepAlive: 0, allowLegacyControlAuth: false, controlProtocolMode: "mtls-strict"}, certInfo);
        const rejected: string[] = [];
        strict.rejectHandshake = (_handler: any, reason: string) => { rejected.push(reason); };
        const handler: any = {id: 7, ctrlState: 1, socket: {remoteAddress: "127.0.0.1"}, isSecure: () => true, isClientCertificateVerified: () => false};
        const packet: any = {cmd: 2, ID: 7, ackCtrlV2Meta: {clientId: "a", proof: "p"}, clientName: "a"};
        strict.onReceiveCtrlPacket(handler, packet);
        expect(rejected).toEqual(["Strict mode requires verified TLS"]);
    });

    it("a client without a certificate from the configured CA cannot complete the TLS handshake", async () => {
        const ca = issue("test-ca", {key: ""}, {ca: true});
        const caSigner = {key: ca.key, cert: ca.certificate};
        const server = issue("localhost", caSigner, {server: true});
        const client = issue("client-a", caSigner);
        const other = issue("other-ca", {key: ""}, {ca: true});
        const stranger = issue("client-x", {key: other.key, cert: other.certificate});
        const options = TlsOptionsFactoryRegistry.current().createServerTlsOptions({port: 0, tls: true, key: server.key, cert: server.cert, ca: ca.cert, requestClientCert: true} as any);
        const listener = tls.createServer(options, (socket) => { socket.end("welcome"); });
        listener.on("tlsClientError", () => {});
        listener.listen(0, "127.0.0.1");
        await once(listener, "listening");
        const port = (listener.address() as import("net").AddressInfo).port;
        const attempt = (extra: {key?: string; cert?: string}) => new Promise<string>((resolve) => {
            const socket = tls.connect({host: "127.0.0.1", port, servername: "localhost", ca: ca.cert, ...extra}, () => {});
            let data = "";
            socket.on("data", (chunk) => { data += chunk.toString(); });
            socket.on("end", () => resolve(data || "ended"));
            socket.on("error", (error: NodeJS.ErrnoException) => resolve(`error:${error.code ?? error.message}`));
        });
        try {
            expect(await attempt({})).not.toBe("welcome");
            expect(await attempt({key: stranger.key, cert: stranger.cert})).not.toBe("welcome");
            expect(await attempt({key: client.key, cert: client.cert})).toBe("welcome");
        } finally {
            await new Promise<void>((resolve) => listener.close(() => resolve()));
        }
    });
});
