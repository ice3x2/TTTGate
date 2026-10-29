import crypto from "crypto";
import net from "net";
import tls from "tls";
import forge from "node-forge";
import {ExternalPortServerPool} from "../../../src/server/ExternalPortServerPool";
import {AdmissionController} from "../../../src/server/security/AdmissionController";
import {TCPServer} from "../../../src/util/TCPServer";
import {getFreePort} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(30_000);

// #287 — TLS 외부 포트는 이미 거절하기로 정해진 주소의 연결을 TLS 핸드셰이크 전에 닫는다.
const selfSigned = () => {
    const {privateKey, publicKey} = crypto.generateKeyPairSync("rsa", {modulusLength: 2048});
    const key = privateKey.export({type: "pkcs1", format: "pem"}).toString();
    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({type: "spki", format: "pem"}).toString());
    cert.serialNumber = crypto.randomBytes(8).toString("hex");
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    cert.validity.notAfter = new Date(Date.now() + 86_400_000);
    cert.setSubject([{name: "commonName", value: "localhost"}]);
    cert.setIssuer([{name: "commonName", value: "localhost"}]);
    cert.sign(forge.pki.privateKeyFromPem(key), forge.md.sha256.create());
    return {key, cert: forge.pki.certificateToPem(cert)};
};
const {key, cert} = selfSigned();

/** ClientHello 를 보내지 않는 TCP 연결을 열고, 닫히면 받은 바이트를 돌려준다. 기한 안에 닫히지 않으면 실패한다. */
const rawUntilClose = (port: number, timeoutMs = 1_000): Promise<Buffer> => new Promise((resolve, reject) => {
    const socket = net.connect({host: "127.0.0.1", port});
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`connection was not closed within ${timeoutMs}ms`)); }, timeoutMs);
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("error", () => {});
    socket.once("close", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
});

const handshake = (port: number): Promise<void> => new Promise((resolve, reject) => {
    const socket = tls.connect({host: "127.0.0.1", port, rejectUnauthorized: false});
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("TLS handshake did not finish")); }, 5_000);
    socket.once("secureConnect", () => { clearTimeout(timer); socket.destroy(); resolve(); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
});

const startTls = async (options: Partial<Parameters<typeof TCPServer.create>[0]>): Promise<{server: TCPServer; port: number}> => {
    const port = await getFreePort();
    const server = TCPServer.create({port, tls: true, key, cert, handshakeTimeoutMs: 10_000, ...options});
    await new Promise<void>((resolve, reject) => server.start((err) => err ? reject(err) : resolve()));
    return {server, port};
};
const stop = (server: TCPServer) => new Promise<void>((resolve) => server.stop(() => resolve()));

describe("TCPServer admitBeforeHandshake (#287)", () => {
    it("거절된 주소는 TLS 응답 없이 바로 닫히고, 핸드셰이크 뒤 판정(admit)까지 가지 않는다 (AC-1)", async () => {
        const admit = jest.fn(() => ({allowed: true as const}));
        const {server, port} = await startTls({admitBeforeHandshake: () => ({allowed: false, reason: "ip-blocklist"}), admit});
        try {
            expect((await rawUntilClose(port)).length).toBe(0);
            expect(admit).not.toHaveBeenCalled();
        } finally {
            await stop(server);
        }
    });

    it("거절된 연결은 핸드셰이크 대기 칸을 차지하지 않는다 (AC-3)", async () => {
        let calls = 0;
        const {server, port} = await startTls({
            admitBeforeHandshake: () => (++calls <= 3 ? {allowed: false, reason: "ip-blocklist"} : {allowed: true}),
            maxPendingTlsHandshakes: 1
        });
        try {
            for(let i = 0; i < 3; i++) expect((await rawUntilClose(port)).length).toBe(0);
            await expect(handshake(port)).resolves.toBeUndefined();
        } finally {
            await stop(server);
        }
    });

    it("허용된 주소는 지금처럼 핸드셰이크를 마치고 admit 을 거친다 (AC-5)", async () => {
        const admit = jest.fn(() => ({allowed: true as const}));
        const {server, port} = await startTls({admitBeforeHandshake: () => ({allowed: true}), admit});
        // 서버의 secureConnection 은 클라이언트의 Finished 를 받은 뒤에 온다. admit 이 불릴 때까지 연결을 열어 둔다.
        const socket = tls.connect({host: "127.0.0.1", port, rejectUnauthorized: false});
        socket.on("error", () => {});
        try {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("admit was not called after the handshake")), 5_000);
                const poll = setInterval(() => {
                    if(admit.mock.calls.length === 0) return;
                    clearInterval(poll);
                    clearTimeout(timer);
                    resolve();
                }, 20);
            });
            expect(admit).toHaveBeenCalledTimes(1);
        } finally {
            socket.destroy();
            await stop(server);
        }
    });
});

describe("ExternalPortServerPool TLS pre-handshake wiring (#287)", () => {
    let testRoot: TestRoot;
    let pool: ExternalPortServerPool;
    const certInfo = {key: {value: key}, cert: {value: cert}, ca: {value: ""}} as any;
    const tlsTunnel = (forwardPort: number) => ({
        forwardPort, protocol: "tcp" as const, tls: true, destinationAddress: "127.0.0.1", destinationPort: 18080, keepAlive: 0,
        rateLimit: {enabled: true, windowMs: 60_000, maxConnections: 1, banMs: 60_000, customized: false}
    });

    beforeEach(async () => {
        testRoot = await createTestRoot("tls-pre-handshake-admission");
        applyTestRoot(testRoot.rootDir);
        AdmissionController.resetForTest();
        pool = ExternalPortServerPool.create([]);
    });

    afterEach(async () => {
        await pool.stopAll();
        AdmissionController.resetForTest();
        await cleanupTestRoot(testRoot);
    });

    it("차단 목록의 주소는 TLS 터널 포트에서 핸드셰이크 전에 닫힌다 (AC-1)", async () => {
        AdmissionController.instance.configureConnectionSecurity({
            geo: {mode: "off", countries: [], applyToAdmin: true, unknownPolicy: "allow"},
            blocklist: [{address: "127.0.0.1", port: null, note: "", createdAt: 1, createdBy: "admin"}]
        });
        const forwardPort = await getFreePort();
        await expect(pool.startServer(tlsTunnel(forwardPort), certInfo)).resolves.toBe(true);
        expect((await rawUntilClose(forwardPort)).length).toBe(0);
    });

    it("레이트 리밋으로 차단 중인 주소도 핸드셰이크 전에 닫힌다 (AC-2)", async () => {
        const forwardPort = await getFreePort();
        await expect(pool.startServer(tlsTunnel(forwardPort), certInfo)).resolves.toBe(true);
        const scope = {kind: "tunnel", port: forwardPort, protocol: "tcp"} as const;
        AdmissionController.instance.admit(scope, "127.0.0.1");
        AdmissionController.instance.admit(scope, "127.0.0.1");
        expect((await rawUntilClose(forwardPort)).length).toBe(0);
    });
});
