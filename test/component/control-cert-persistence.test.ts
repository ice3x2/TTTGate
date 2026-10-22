import * as fs from "fs";
import * as path from "path";
import tls from "tls";
import net from "net";
import {once} from "events";
import {X509Certificate} from "crypto";
import {CertificationStore, CONTROL_CERT_SERVER_NAME} from "../../src/server/CertificationStore";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../helpers/runtime";
import Environment from "../../src/Environment";
import {generateSelfSignedCert} from "../helpers/testCerts";
import forge from "node-forge";

/** 고정 서버 이름을 담고 만료 시점을 정한 제어 인증서(#224). */
const controlCert = (daysLeft: number) => {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01" + Date.now().toString(16);
    cert.validity.notBefore = new Date(Date.now() - 24 * 3600_000);
    cert.validity.notAfter = new Date(Date.now() + daysLeft * 24 * 3600_000);
    const attrs = [{name: "commonName", value: CONTROL_CERT_SERVER_NAME}];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([{name: "basicConstraints", cA: true}, {name: "subjectAltName", altNames: [{type: 2, value: CONTROL_CERT_SERVER_NAME}]}]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    return {certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey)};
};

jest.setTimeout(60_000);

// #212: 등록으로 받아 간 CA 가 서버를 다시 시작해도 맞도록 제어 포트 인증서를 저장해 다시 쓴다.
describe("persistent control certificate", () => {
    let root: TestRoot;
    beforeEach(async () => {
        root = await createTestRoot("control-cert");
        applyTestRoot(root.rootDir);
    });
    afterEach(async () => cleanupTestRoot(root));

    const certFile = () => path.join(Environment.path.certDir, "control.cert.pem");
    const keyFile = () => path.join(Environment.path.certDir, "control.key.pem");

    test("load keeps the same certificate across restarts and names it for the fixed server name", async () => {
        await CertificationStore.instance.load();
        const first = CertificationStore.instance.getTempCert().cert.value;
        expect(fs.readFileSync(certFile(), "utf-8")).toBe(first);
        if(process.platform !== "win32") expect(fs.statSync(keyFile()).mode & 0o777).toBe(0o600);

        CertificationStore.resetForTest();
        await CertificationStore.instance.load();
        expect(CertificationStore.instance.getTempCert().cert.value).toBe(first);
        expect(new X509Certificate(first).subjectAltName).toBe(`DNS:${CONTROL_CERT_SERVER_NAME}`);
    });

    test("a missing, broken or differently named certificate is replaced", async () => {
        await CertificationStore.instance.load();
        const first = CertificationStore.instance.getTempCert().cert.value;

        fs.writeFileSync(certFile(), "broken");
        CertificationStore.resetForTest();
        await CertificationStore.instance.load();
        const second = CertificationStore.instance.getTempCert().cert.value;
        expect(second).not.toBe(first);

        // 다른 이름의 인증서(=예전 형식)도 새로 만든다.
        const other = generateSelfSignedCert("localhost");
        fs.writeFileSync(certFile(), other.certPem);
        fs.writeFileSync(keyFile(), other.keyPem);
        CertificationStore.resetForTest();
        await CertificationStore.instance.load();
        expect(CertificationStore.instance.getTempCert().cert.value).not.toBe(other.certPem);
    });

    test("a client that pins the certificate verifies it with the fixed server name only", async () => {
        await CertificationStore.instance.load();
        const certificate = CertificationStore.instance.getTempCert();
        const server = tls.createServer({key: certificate.key.value, cert: certificate.cert.value}, socket => socket.end("ok"));
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const port = (server.address() as net.AddressInfo).port;
        const connect = (servername: string) => new Promise<string>((resolve, reject) => {
            const client = tls.connect({host: "127.0.0.1", port, ca: certificate.cert.value, servername, rejectUnauthorized: true});
            client.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "error"));
            client.once("secureConnect", () => { client.end(); resolve("authorized"); });
            setTimeout(() => reject(new Error("tls timeout")), 10_000).unref();
        });
        try {
            expect(await connect(CONTROL_CERT_SERVER_NAME)).toBe("authorized");
            expect(await connect("localhost")).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
        } finally {
            server.close();
        }
    });

    // #224 갱신 조건
    const store = (cert: {certPem: string, keyPem: string}) => {
        fs.mkdirSync(Environment.path.certDir, {recursive: true});
        fs.writeFileSync(certFile(), cert.certPem);
        fs.writeFileSync(keyFile(), cert.keyPem);
    };
    const reload = async () => {
        CertificationStore.resetForTest();
        await CertificationStore.instance.load();
        return CertificationStore.instance.getTempCert().cert.value;
    };

    test("#224 REQ-4 a stored certificate with more than 30 days left is kept", async () => {
        const fresh = controlCert(45);
        store(fresh);
        expect(await reload()).toBe(fresh.certPem);
    });

    test("#224 REQ-1 a stored certificate with 30 days or less left is replaced and the new one is stored", async () => {
        const expiring = controlCert(20);
        store(expiring);
        const loaded = await reload();
        expect(loaded).not.toBe(expiring.certPem);
        expect(fs.readFileSync(certFile(), "utf-8")).toBe(loaded);
        expect(Date.parse(new X509Certificate(loaded).validTo) - Date.now()).toBeGreaterThan(300 * 24 * 3600_000);
    });

    test("#224 REQ-2 a key that does not match the certificate makes a new pair", async () => {
        const one = controlCert(45);
        const other = controlCert(45);
        store({certPem: one.certPem, keyPem: other.keyPem});
        const loaded = await reload();
        expect(loaded).not.toBe(one.certPem);
        expect(new X509Certificate(loaded).checkPrivateKey(require("crypto").createPrivateKey(fs.readFileSync(keyFile(), "utf-8")))).toBe(true);
    });

    test("#224 REQ-3 reset() creates and stores a new certificate", async () => {
        await CertificationStore.instance.load();
        const before = CertificationStore.instance.getTempCert().cert.value;
        await CertificationStore.instance.reset();
        const after = CertificationStore.instance.getTempCert().cert.value;
        expect(after).not.toBe(before);
        expect(fs.readFileSync(certFile(), "utf-8")).toBe(after);
    });
});
