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

    test("a missing, broken or nearly expired certificate is replaced", async () => {
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
});
