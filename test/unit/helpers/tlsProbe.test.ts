import net from "node:net";
import tls from "node:tls";
import {once} from "node:events";
import {peerFingerprint256} from "../../helpers/tlsProbe";
import {generateSelfSignedCert} from "../../helpers/testCerts";

// #181 — 클라이언트가 없는 터널 포트는 핸드셰이크 직후 연결을 닫는다. 부하에서는 그 닫힘(RST)이 클라이언트의
// 핸드셰이크 처리보다 먼저 도착해 ECONNRESET 이 난다. 탐침은 핸드셰이크 전 리셋만 다시 시도한다.
describe("TLS identity probe", () => {
    it("retries a connection that is reset before the handshake completes", async () => {
        const bundle = generateSelfSignedCert("probe");
        const secure = tls.createServer({key: bundle.keyPem, cert: bundle.certPem}, (socket) => socket.end());
        secure.on("tlsClientError", () => {});
        let resets = 0;
        const front = net.createServer((socket) => {
            if(resets < 2) { resets++; socket.resetAndDestroy(); return; }
            secure.emit("connection", socket);
        });
        front.listen(0, "127.0.0.1");
        await once(front, "listening");
        try {
            const value = await peerFingerprint256((front.address() as net.AddressInfo).port);
            expect(value.replace(/:/g, "").toLowerCase()).toBe(bundle.fingerprintSha256);
            expect(resets).toBe(2);
        } finally {
            await new Promise<void>((resolve) => front.close(() => resolve()));
        }
    });

    it("does not retry forever", async () => {
        const front = net.createServer((socket) => socket.resetAndDestroy());
        front.listen(0, "127.0.0.1");
        await once(front, "listening");
        try {
            await expect(peerFingerprint256((front.address() as net.AddressInfo).port, {attempts: 3})).rejects.toThrow(/ECONNRESET|socket/i);
        } finally {
            await new Promise<void>((resolve) => front.close(() => resolve()));
        }
    });
});
