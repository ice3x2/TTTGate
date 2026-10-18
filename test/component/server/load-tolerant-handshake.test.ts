import net from "node:net";
import tls from "node:tls";
import {once} from "node:events";
import {withLegacyIds} from "./legacy-handler-id-fixture";
import {TunnelHandshakePolicyRegistry} from "../../../src/server/TunnelHandshakePolicy";
import {TCPServer} from "../../../src/util/TCPServer";
import {getFreePort} from "../../helpers/network";
import {generateSelfSignedCert} from "../../helpers/testCerts";

jest.setTimeout(60_000);

// #181 — 약한 서버(0.5코어·스왑)에서 정상 연결을 자르지 않으면서, 슬롯·fd 를 채우는 공격에는 여전히 버틴다.
const openRaw = async (port: number, sockets: net.Socket[]) => {
    const socket = net.createConnection({host: "127.0.0.1", port});
    sockets.push(socket);
    socket.on("error", () => {});
    (socket as any).closedAt = undefined;
    socket.once("close", () => { (socket as any).closedAt = Date.now(); });
    await once(socket, "connect");
    return socket;
};
const closed = (socket: net.Socket) => (socket as any).closedAt !== undefined;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("load-tolerant tunnel handshake (#181)", () => {
    afterEach(() => TunnelHandshakePolicyRegistry.reset());

    it("a silent connection is not cut at the old 5 second deadline", async () => withLegacyIds(async (f) => {
        const sockets: net.Socket[] = [];
        try {
            const socket = await openRaw(f.server.tunnelServer.port, sockets);
            await sleep(6_500);
            expect(closed(socket)).toBe(false);
        } finally { sockets.forEach((socket) => socket.destroy()); }
    }));

    it("shortens the deadline for new connections once more than half of the unauthenticated slots are taken", async () => withLegacyIds(async (f) => {
        TunnelHandshakePolicyRegistry.configure({maxUnauthenticatedConnections: 4, maxUnauthenticatedPerAddress: 100, timeoutMs: 5_000, underPressureTimeoutMs: 200});
        const sockets: net.Socket[] = [];
        try {
            for(let i = 0; i < 4; i++) { await openRaw(f.server.tunnelServer.port, sockets); await sleep(50); }
            await sleep(800);
            // 세 번째부터는 자기를 포함해 슬롯의 절반(2/4)을 넘으므로 짧은 기한을 받는다.
            expect(sockets.map(closed)).toEqual([false, false, true, true]);
        } finally { sockets.forEach((socket) => socket.destroy()); }
    }));

    it("does not apply the per-address cap to an address with an authenticated client", async () => withLegacyIds(async (f) => {
        TunnelHandshakePolicyRegistry.configure({maxUnauthenticatedPerAddress: 2, timeoutMs: 5_000});
        const sockets: net.Socket[] = [];
        try {
            for(let i = 0; i < 3; i++) await openRaw(f.server.tunnelServer.port, sockets);
            await sleep(300);
            // 인증된 클라이언트가 없으면 같은 주소의 세 번째 미인증 연결은 거절된다.
            expect(sockets.filter(closed)).toHaveLength(1);
            sockets.forEach((socket) => socket.destroy());
            sockets.length = 0;
            await sleep(100);
            await f.peer(true);
            for(let i = 0; i < 4; i++) await openRaw(f.server.tunnelServer.port, sockets);
            await sleep(300);
            expect(sockets.filter(closed)).toEqual([]);
        } finally { sockets.forEach((socket) => socket.destroy()); }
    }));
});

describe("authenticated address cap (#181)", () => {
    afterEach(() => TunnelHandshakePolicyRegistry.reset());

    it("raises but still bounds the cap for an address with an authenticated client", async () => withLegacyIds(async (f) => {
        TunnelHandshakePolicyRegistry.configure({maxUnauthenticatedConnections: 8, maxUnauthenticatedPerAddress: 1, timeoutMs: 5_000, underPressureTimeoutMs: 5_000});
        const sockets: net.Socket[] = [];
        try {
            await f.peer(true);
            // 인증 주소의 상한은 min(1 x 4, 8 / 2) = 4 다. 같은 주소의 공격자가 전체 슬롯을 차지하지 못한다.
            for(let i = 0; i < 6; i++) await openRaw(f.server.tunnelServer.port, sockets);
            await sleep(300);
            expect(sockets.map(closed)).toEqual([false, false, false, false, true, true]);
        } finally { sockets.forEach((socket) => socket.destroy()); }
    }));
});

describe("pending TLS handshake cap (#181)", () => {
    it("closes new TCP connections beyond the cap while handshakes are pending", async () => {
        const {keyPem, certPem} = generateSelfSignedCert("pending");
        const port = await getFreePort();
        const server = TCPServer.create({port, tls: true, key: keyPem, cert: certPem, handshakeTimeoutMs: 10_000, maxPendingTlsHandshakes: 2});
        await new Promise<void>((resolve, reject) => server.start((error) => error ? reject(error) : resolve()));
        const sockets: net.Socket[] = [];
        try {
            for(let i = 0; i < 3; i++) await openRaw(port, sockets);
            await sleep(500);
            expect(sockets.map(closed)).toEqual([false, false, true]);
            // 대기 연결이 닫히면 자리가 난다.
            sockets[0].destroy();
            await sleep(200);
            const later = await openRaw(port, sockets);
            await sleep(300);
            expect(closed(later)).toBe(false);
        } finally {
            sockets.forEach((socket) => socket.destroy());
            await new Promise<void>((resolve) => server.stop(() => resolve()));
        }
    });
    it("bounds pending handshakes per address bucket", async () => {
        const {keyPem, certPem} = generateSelfSignedCert("pending-bucket");
        const port = await getFreePort();
        const server = TCPServer.create({port, tls: true, key: keyPem, cert: certPem, handshakeTimeoutMs: 10_000,
            maxPendingTlsHandshakes: 100, maxPendingTlsHandshakesPerAddress: 2, addressBucketOf: () => "same"});
        await new Promise<void>((resolve, reject) => server.start((error) => error ? reject(error) : resolve()));
        const sockets: net.Socket[] = [];
        try {
            for(let i = 0; i < 3; i++) await openRaw(port, sockets);
            await sleep(500);
            expect(sockets.map(closed)).toEqual([false, false, true]);
        } finally {
            sockets.forEach((socket) => socket.destroy());
            await new Promise<void>((resolve) => server.stop(() => resolve()));
        }
    });

    it("frees the slot when a handshake completes or fails", async () => {
        const {keyPem, certPem} = generateSelfSignedCert("pending-release");
        const port = await getFreePort();
        const server = TCPServer.create({port, tls: true, key: keyPem, cert: certPem, handshakeTimeoutMs: 10_000, maxPendingTlsHandshakes: 1});
        await new Promise<void>((resolve, reject) => server.start((error) => error ? reject(error) : resolve()));
        const sockets: net.Socket[] = [];
        try {
            // 핸드셰이크를 마친 연결은 대기에서 빠진다.
            const secure = tls.connect({host: "127.0.0.1", port, rejectUnauthorized: false});
            secure.on("error", () => {});
            await once(secure, "secureConnect");
            // 클라이언트의 secureConnect 가 서버의 secureConnection 보다 먼저 올 수 있다. 서버가 연결을 넘겨받을 때까지 기다린다.
            for(let i = 0; i < 100 && server.handlerCount === 0; i++) await sleep(20);
            expect(server.handlerCount).toBe(1);
            const afterSecure = await openRaw(port, sockets);
            await sleep(300);
            expect(closed(afterSecure)).toBe(false);
            // 잘못된 바이트로 핸드셰이크가 실패한 연결도 빠진다.
            afterSecure.write(Buffer.from("not a tls client hello\r\n"));
            await sleep(500);
            expect(closed(afterSecure)).toBe(true);
            const afterFailure = await openRaw(port, sockets);
            await sleep(300);
            expect(closed(afterFailure)).toBe(false);
            secure.destroy();
        } finally {
            sockets.forEach((socket) => socket.destroy());
            await new Promise<void>((resolve) => server.stop(() => resolve()));
        }
    });
});
