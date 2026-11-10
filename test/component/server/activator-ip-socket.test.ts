import crypto from "crypto";
import net from "net";
import tls from "tls";
import forge from "node-forge";
import {ExternalPortServerPool} from "../../../src/server/ExternalPortServerPool";
import {AdmissionController} from "../../../src/server/security/AdmissionController";
import {isActivatorIpAllowed} from "../../../src/server/security/ActivatorIps";
import {getFreePort, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

// 이슈 348 — 실제 소켓으로 켠 사람의 IP 만 받는 판정을 본다. 루프백의 서로 다른 주소 127.0.0.1(A)·127.0.0.2(B)를 쓴다.
// 리눅스는 127.0.0.0/8 전체가 루프백이라 localAddress 로 원격 주소를 고를 수 있다.
jest.setTimeout(30_000);

const IP_A = "127.0.0.1";
const IP_B = "127.0.0.2";

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

/** from 주소에서 연결하고, 닫히면 받은 바이트를 돌려준다. 기한 안에 닫히지 않으면 실패한다. */
const untilClose = (port: number, from: string, send?: string, timeoutMs = 3_000): Promise<Buffer> => new Promise((resolve, reject) => {
    const socket = net.connect({host: "127.0.0.1", port, localAddress: from});
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`connection from ${from} was not closed within ${timeoutMs}ms`)); }, timeoutMs);
    if(send !== undefined) socket.once("connect", () => socket.write(send));
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("error", () => {});
    socket.once("close", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
});

describe("activator-ip 실제 소켓 (이슈 348)", () => {
    let testRoot: TestRoot;
    let pool: ExternalPortServerPool;
    let forwardPort: number;
    /** 테스트가 바꾸는 허용 IP. undefined 면 IP 제한이 꺼져 있다. */
    let allowed: Set<string> | undefined;
    const kept: net.Socket[] = [];

    const sessions = (): number => pool.getServerStatus(forwardPort).sessions;
    const hold = (from: string): net.Socket => {
        const socket = net.connect({host: "127.0.0.1", port: forwardPort, localAddress: from});
        socket.on("error", () => {});
        kept.push(socket);
        return socket;
    };
    const waitSessions = (count: number) =>
        waitFor(() => { if(sessions() !== count) throw new Error(`waiting for ${count} sessions, got ${sessions()}`); }, {timeoutMs: 3000});
    const activatorDenials = (): number => AdmissionController.instance.snapshot().ports[String(forwardPort)]?.rejectedActivatorIp ?? 0;
    const base = {destinationAddress: "127.0.0.1", destinationPort: 18080, keepAlive: 0};

    beforeEach(async () => {
        testRoot = await createTestRoot("activator-ip-socket");
        applyTestRoot(testRoot.rootDir);
        AdmissionController.resetForTest();
        pool = ExternalPortServerPool.create([]);
        forwardPort = await getFreePort();
        allowed = new Set([IP_A]);
        AdmissionController.instance.attachActivatorIps((port) => port === forwardPort ? allowed : undefined);
    });

    afterEach(async () => {
        kept.splice(0).forEach((socket) => socket.destroy());
        await pool.stopAll();
        AdmissionController.resetForTest();
        await cleanupTestRoot(testRoot);
    });

    it("TCP 터널은 A 의 연결을 받고 B 의 연결은 바로 닫으며, 거부 사유는 activator-ip 다 (AC-2)", async () => {
        await expect(pool.startServer({...base, forwardPort, protocol: "tcp" as const})).resolves.toBe(true);
        hold(IP_A);
        await waitSessions(1);
        expect((await untilClose(forwardPort, IP_B)).length).toBe(0);
        expect(sessions()).toBe(1);
        expect(activatorDenials()).toBe(1);
        expect(AdmissionController.instance.recentDenials()[0]).toMatchObject({ip: IP_B, scope: forwardPort, reason: "activator-ip"});
    });

    it("HTTP 터널에 B 가 X-Forwarded-For: A 를 붙여도 거부한다 (AC-2a)", async () => {
        await expect(pool.startServer({...base, forwardPort, protocol: "http" as const})).resolves.toBe(true);
        const received = await untilClose(forwardPort, IP_B, `GET / HTTP/1.1\r\nHost: x\r\nX-Forwarded-For: ${IP_A}\r\n\r\n`);
        expect(received.length).toBe(0);
        expect(sessions()).toBe(0);
        expect(activatorDenials()).toBe(1);
    });

    it("TLS 터널에 B 가 연결하면 핸드셰이크 전에 닫히고, A 는 핸드셰이크를 마친다 (AC-2b)", async () => {
        const {key, cert} = selfSigned();
        const certInfo = {key: {value: key}, cert: {value: cert}, ca: {value: ""}} as any;
        await expect(pool.startServer({...base, forwardPort, protocol: "tcp" as const, tls: true}, certInfo)).resolves.toBe(true);
        // ClientHello 를 보내지 않아도 닫힌다. 받은 바이트가 없으니 ServerHello 를 보내지 않았다.
        expect((await untilClose(forwardPort, IP_B)).length).toBe(0);
        expect(activatorDenials()).toBe(1);
        await new Promise<void>((resolve, reject) => {
            // tls.connect 의 타입에는 localAddress 가 없으므로 A 에서 연 TCP 소켓 위에서 핸드셰이크한다.
            const raw = net.connect({host: "127.0.0.1", port: forwardPort, localAddress: IP_A});
            raw.on("error", () => {});
            const socket = tls.connect({socket: raw, rejectUnauthorized: false});
            const timer = setTimeout(() => { socket.destroy(); reject(new Error("TLS handshake from A did not finish")); }, 5_000);
            socket.once("secureConnect", () => { clearTimeout(timer); socket.destroy(); resolve(); });
            socket.once("error", (error) => { clearTimeout(timer); reject(error); });
        });
    });

    it("갱신으로 허용 IP 가 A 에서 C 로 바뀌면 C 는 남고 A 의 기존 연결은 끊긴다 (AC-3)", async () => {
        await expect(pool.startServer({...base, forwardPort, protocol: "tcp" as const})).resolves.toBe(true);
        allowed = new Set([IP_A, IP_B]);
        const fromA = hold(IP_A);
        hold(IP_B);
        await waitSessions(2);
        const closedA = new Promise<void>((resolve) => fromA.once("close", () => resolve()));
        // 같은 사용자가 B(=C)에서 갱신했다. A 는 더 이상 허용 IP 가 아니다.
        allowed = new Set([IP_B]);
        const restriction = allowed;
        await expect(pool.closeSessionsWhere(forwardPort, (address) => !isActivatorIpAllowed(restriction, address))).resolves.toBe(1);
        await closedA;
        await waitSessions(1);
        expect((await untilClose(forwardPort, IP_A)).length).toBe(0);
    });

    it("IP 제한을 끄면 리스너를 다시 시작하지 않고 모든 IP 의 연결을 받는다 (AC-6)", async () => {
        await expect(pool.startServer({...base, forwardPort, protocol: "tcp" as const})).resolves.toBe(true);
        const uptime = pool.getServerStatus(forwardPort).uptime;
        expect((await untilClose(forwardPort, IP_B)).length).toBe(0);
        allowed = undefined;
        hold(IP_B);
        await waitSessions(1);
        expect(pool.getServerStatus(forwardPort).uptime).toBe(uptime);
    });

    it("국가 필터에 막힐 IP 라도 허용 IP 가 아니면 사유가 activator-ip 다 (AC-16)", async () => {
        // 루프백은 국가를 모르는 주소다. unknownPolicy=deny 면 국가 필터에 막힌다.
        AdmissionController.instance.configureGeo({mode: "allow", countries: ["KR"], applyToAdmin: false, unknownPolicy: "deny"});
        await expect(pool.startServer({...base, forwardPort, protocol: "tcp" as const})).resolves.toBe(true);
        expect((await untilClose(forwardPort, IP_B)).length).toBe(0);
        const reasons = AdmissionController.instance.recentDenials().filter((denial) => denial.ip === IP_B).map((denial) => denial.reason);
        expect(reasons).toEqual(["activator-ip"]);
        expect(AdmissionController.instance.snapshot().ports[String(forwardPort)]).toMatchObject({rejectedActivatorIp: 1, rejectedGeo: 0});
    });
});
