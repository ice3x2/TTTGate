/**
 * P3-T2 / REQ-02 — TlsOptionsFactory.createServerTlsOptions 강화 검증.
 *
 * Mock 금지: 실제 `tls.createServer` + `tls.connect` 왕복 handshake.
 * 인증서는 node-forge 1.3.1로 런타임 생성 (test/helpers/testCerts.ts).
 *
 * 검증 항목(4종):
 *  (a) TLS 1.3 handshake 성공 (authorization 제외)
 *  (b) TLS 1.2 handshake 성공 (minVersion 경계)
 *  (c) TLS 1.0/1.1 등 레거시 클라이언트는 거부됨 (maxVersion=TLSv1.1 지정 시 handshake 실패)
 *  (d) createServerTlsOptions 결과에 secureProtocol 부재 + honorCipherOrder=true + ciphers 화이트리스트 존재
 */
import * as tls from "tls";
import * as net from "net";
import { DefaultTlsOptionsFactory } from "../../src/util/TlsOptionsFactory";
import { generateSelfSignedCert } from "../helpers/testCerts";

function listenTlsOnce(opt: tls.TlsOptions): Promise<{server: tls.Server, port: number}> {
    return new Promise((resolve, reject) => {
        const server = tls.createServer(opt, (socket) => {
            socket.write("ok");
            socket.end();
        });
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if(addr && typeof addr === "object") {
                resolve({ server, port: addr.port });
            } else {
                reject(new Error("no address"));
            }
        });
    });
}

function closeServer(server: tls.Server): Promise<void> {
    return new Promise((resolve) => {
        try { server.close(() => resolve()); } catch { resolve(); }
    });
}

describe("REQ-02 TlsOptionsFactory server TLS hardening", () => {
    let cert: ReturnType<typeof generateSelfSignedCert>;
    beforeAll(() => {
        cert = generateSelfSignedCert("localhost");
    });

    it("(d) secureProtocol 부재 + honorCipherOrder + ECDHE-AEAD ciphers 화이트리스트", () => {
        const opt = DefaultTlsOptionsFactory.createServerTlsOptions({
            port: 0,
            tls: true,
            cert: cert.certPem,
            key: cert.keyPem
        }) as any;
        expect(opt.secureProtocol).toBeUndefined();
        expect(opt.minVersion).toBe("TLSv1.2");
        expect(opt.maxVersion).toBe("TLSv1.3");
        expect(opt.honorCipherOrder).toBe(true);
        expect(typeof opt.ciphers).toBe("string");
        // CBC/3DES/RC4/NULL/EXPORT 등 약한 cipher 미포함 확인.
        expect(opt.ciphers).toMatch(/ECDHE/);
        expect(opt.ciphers).toMatch(/GCM|CHACHA20/);
        expect(opt.ciphers).not.toMatch(/RC4|3DES|NULL|EXPORT|-CBC/i);
    });

    it("(a) TLS 1.3 handshake 성공", async () => {
        const opt = DefaultTlsOptionsFactory.createServerTlsOptions({
            port: 0, tls: true, cert: cert.certPem, key: cert.keyPem
        });
        const { server, port } = await listenTlsOnce(opt);
        try {
            const protocol = await new Promise<string>((resolve, reject) => {
                const s = tls.connect({
                    host: "127.0.0.1", port,
                    rejectUnauthorized: false,
                    minVersion: "TLSv1.3",
                    maxVersion: "TLSv1.3"
                });
                s.once("secureConnect", () => {
                    const p = s.getProtocol() ?? "";
                    s.destroy();
                    resolve(p);
                });
                s.once("error", reject);
            });
            expect(protocol).toBe("TLSv1.3");
        } finally {
            await closeServer(server);
        }
    });

    it("(b) TLS 1.2 handshake 성공", async () => {
        const opt = DefaultTlsOptionsFactory.createServerTlsOptions({
            port: 0, tls: true, cert: cert.certPem, key: cert.keyPem
        });
        const { server, port } = await listenTlsOnce(opt);
        try {
            const protocol = await new Promise<string>((resolve, reject) => {
                const s = tls.connect({
                    host: "127.0.0.1", port,
                    rejectUnauthorized: false,
                    minVersion: "TLSv1.2",
                    maxVersion: "TLSv1.2"
                });
                s.once("secureConnect", () => {
                    const p = s.getProtocol() ?? "";
                    s.destroy();
                    resolve(p);
                });
                s.once("error", reject);
            });
            expect(protocol).toBe("TLSv1.2");
        } finally {
            await closeServer(server);
        }
    });

    it("(c) TLS 1.1 강제 클라이언트는 handshake 거부", async () => {
        const opt = DefaultTlsOptionsFactory.createServerTlsOptions({
            port: 0, tls: true, cert: cert.certPem, key: cert.keyPem
        });
        const { server, port } = await listenTlsOnce(opt);
        try {
            await expect(new Promise<void>((resolve, reject) => {
                let s: tls.TLSSocket;
                try {
                    s = tls.connect({
                        host: "127.0.0.1", port,
                        rejectUnauthorized: false,
                        minVersion: "TLSv1.1",
                        maxVersion: "TLSv1.1"
                    });
                } catch (e) {
                    // 일부 Node 빌드는 TLS1.1 사용을 로컬 OpenSSL 정책으로 throw함.
                    reject(e);
                    return;
                }
                s.once("secureConnect", () => { s.destroy(); resolve(); });
                s.once("error", reject);
            })).rejects.toBeDefined();
        } finally {
            await closeServer(server);
        }
    });
});
