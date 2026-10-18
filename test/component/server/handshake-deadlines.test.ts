import crypto from "crypto";
import net from "net";
import {EventEmitter} from "events";
import forge from "node-forge";
import {CtrlCmd, CtrlPacket} from "../../../src/commons/CtrlPacket";
import {ClientHandlerPool} from "../../../src/server/ClientHandlerPool";
import {TunnelHandshakePolicyRegistry} from "../../../src/server/TunnelHandshakePolicy";
import {TunnelServer} from "../../../src/server/TunnelServer";
import {SocketHandler} from "../../../src/util/SocketHandler";
import {TCPServer} from "../../../src/util/TCPServer";
import {getFreePort} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(30_000);

// #174 — TLS 핸드셰이크 중인 연결과 열리는 중인 세션에도 기한을 둔다.
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

const parsed = (packet: CtrlPacket): CtrlPacket => {
    const result = CtrlPacket.fromBuffer(packet.toBuffer());
    if(!result.packet) throw new Error(`fixture packet did not parse: ${result.error}`);
    return result.packet;
};

const sentCommands = (writes: Buffer[]): CtrlCmd[] => writes.flatMap((buffer) => {
    const result = CtrlPacket.fromBuffer(buffer);
    return result.packet ? [result.packet.cmd] : [];
});

class FastWritableSocket extends EventEmitter {
    public remoteAddress = "127.0.0.1";
    public remotePort = 5001;
    public localAddress = "127.0.0.1";
    public writes: Buffer[] = [];
    public setNoDelay(): this { return this; }
    public setKeepAlive(): this { return this; }
    public setTimeout(): this { return this; }
    public pause(): this { return this; }
    public resume(): this { return this; }
    public write(buffer: Buffer, callback?: (error?: Error | null) => void): boolean { this.writes.push(buffer); callback?.(null); return true; }
    public end(): this { this.emit("end"); this.emit("close"); return this; }
    public destroy(): this { this.emit("close"); return this; }
}

describe("handshake and pending-session deadlines (#174)", () => {
    let testRoot: TestRoot;
    beforeEach(async () => { testRoot = await createTestRoot("handshake-deadlines"); applyTestRoot(testRoot.rootDir); });
    afterEach(async () => { TunnelHandshakePolicyRegistry.reset(); jest.useRealTimers(); await cleanupTestRoot(testRoot); });

    it("the tunnel TLS listener uses the handshake deadline as its TLS handshake timeout", () => {
        const {key, cert} = selfSigned();
        const certInfo = {key: {name: "k", value: key}, cert: {name: "c", value: cert}, ca: {name: "", value: ""}} as any;
        TunnelHandshakePolicyRegistry.configure({timeoutMs: 1234});
        const server: any = TunnelServer.create({port: 1, tls: true, key: "shared", keepAlive: 0, allowLegacyControlAuth: false, controlProtocolMode: "mixed"}, certInfo);
        expect(server._tunnelServer._options.handshakeTimeoutMs).toBe(1234);
    });

    it("a TCP connection that never starts the TLS handshake is closed at the handshake timeout", async () => {
        const {key, cert} = selfSigned();
        const port = await getFreePort();
        const server = TCPServer.create({port, tls: true, key, cert, handshakeTimeoutMs: 300});
        await new Promise<void>((resolve, reject) => server.start((err) => err ? reject(err) : resolve()));
        const socket = net.connect(port, "127.0.0.1");
        socket.on("error", () => {});
        try {
            const started = Date.now();
            const closedAfter = await new Promise<number>((resolve, reject) => {
                const guard = setTimeout(() => reject(new Error("TLS listener kept a silent TCP connection open")), 5_000);
                socket.on("close", () => { clearTimeout(guard); resolve(Date.now() - started); });
            });
            expect(closedAfter).toBeLessThan(5_000);
        } finally {
            socket.destroy();
            await new Promise<void>((resolve) => server.stop(() => resolve()));
        }
    });

    it("a pending session whose data connection never arrives is closed at the open deadline", () => {
        jest.useFakeTimers();
        TunnelHandshakePolicyRegistry.configure({pendingSessionOpenTimeoutMs: 2_000});
        const control = new FastWritableSocket();
        const controlHandler = SocketHandler.bound({socket: control as any, port: 9126, addr: "127.0.0.1", tls: false, keepAlive: 0}, () => {});
        const pool = ClientHandlerPool.create(1, controlHandler);
        const onSessionClose = jest.fn();
        pool.onSessionCloseCallback = onSessionClose;
        pool.sendConnectEndPoint(100, {host: "127.0.0.1", port: 8080, tls: false, bufferLimit: 1024});
        expect(pool.pendingSessionCount).toBe(1);
        const writesBefore = control.writes.length;
        jest.advanceTimersByTime(1_999);
        expect(onSessionClose).not.toHaveBeenCalled();
        jest.advanceTimersByTime(2);
        expect(onSessionClose).toHaveBeenCalledWith(100, 0);
        expect(pool.pendingSessionCount).toBe(0);
        // 클라이언트에도 세션 종료를 알린다.
        expect(sentCommands(control.writes.slice(writesBefore))).toContain(CtrlCmd.CloseSession);
    });

    const pendingPool = () => {
        TunnelHandshakePolicyRegistry.configure({pendingSessionOpenTimeoutMs: 2_000});
        const control = new FastWritableSocket();
        const controlHandler = SocketHandler.bound({socket: control as any, port: 9126, addr: "127.0.0.1", tls: false, keepAlive: 0}, () => {});
        const pool = ClientHandlerPool.create(1, controlHandler);
        const onSessionClose = jest.fn();
        pool.onSessionCloseCallback = onSessionClose;
        pool.sendConnectEndPoint(100, {host: "127.0.0.1", port: 8080, tls: false, bufferLimit: 1024});
        const pending = (pool as any)._pendingSessionIDMap.get(100);
        const dataHandler: any = {sessionID: 100, handlerID: pending.handlerID, bindingToken: pending.bindingToken,
            setBufferSizeLimit: () => {}, destroy: jest.fn(), endImmediate: jest.fn()};
        pool.putNewDataHandler(dataHandler);
        return {pool, control, controlHandler, onSessionClose, pending, dataHandler};
    };

    it("a session that opened before the deadline is not closed when the deadline passes", () => {
        jest.useFakeTimers();
        const {pool, controlHandler, onSessionClose, pending, dataHandler} = pendingPool();
        pool.delegateReceivePacketOfControlHandler(controlHandler as any, parsed(CtrlPacket.resultOfOpenSession(pending.handlerID, 100, true)));
        expect(pool.pendingSessionCount).toBe(0);
        jest.advanceTimersByTime(10_000);
        expect(onSessionClose).not.toHaveBeenCalled();
        expect(dataHandler.destroy).not.toHaveBeenCalled();
    });

    it("a session whose data connection arrived but whose endpoint never answered closes and drops the data connection", () => {
        jest.useFakeTimers();
        const {pool, control, onSessionClose, dataHandler} = pendingPool();
        const writesBefore = control.writes.length;
        jest.advanceTimersByTime(2_001);
        expect(onSessionClose).toHaveBeenCalledWith(100, 0);
        expect(dataHandler.destroy).toHaveBeenCalled();
        expect(pool.pendingSessionCount).toBe(0);
        expect(sentCommands(control.writes.slice(writesBefore))).toContain(CtrlCmd.CloseSession);
    });

    it("an expired timer leaves a session reopened under the same ID alone", () => {
        jest.useFakeTimers();
        const {pool, onSessionClose, pending} = pendingPool();
        const replaced = {...pending};
        (pool as any)._pendingSessionIDMap.set(100, replaced);
        jest.advanceTimersByTime(2_001);
        expect(onSessionClose).not.toHaveBeenCalled();
        expect((pool as any)._pendingSessionIDMap.get(100)).toBe(replaced);
    });
});
