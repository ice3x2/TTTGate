/**
 * P5-T3 / REQ-11 — JSON 본문 크기 / 타임아웃 제한.
 *
 * Mock 금지: 실 http.request / 실 net.Socket / 실 AdminServer.
 *
 * 2 케이스:
 *  (1) 1MiB + 1 본문 → 413 Payload Too Large (소켓 파괴).
 *  (2) 헤더만 보내고 아이들 10s 유지 → 408 Request Timeout 또는 소켓 종료.
 *  (+) 런타임 스냅샷: server.headersTimeout, requestTimeout 값 확인.
 */
import http from "http";
import net from "net";
import AdminServer from "../../../../src/server/admin/AdminServer";
import SessionStore from "../../../../src/server/admin/SessionStore";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

jest.setTimeout(60_000);

describe("REQ-11 JSON body size / timeout", () => {
    let testRoot: TestRoot;
    let adminServer: AdminServer;
    let port: number;

    beforeEach(async () => {
        testRoot = await createTestRoot("req-11-body");
        applyTestRoot(testRoot.rootDir);
        ServerOptionStore.instance;
        SessionStore.instance;
        adminServer = new AdminServer({} as any, false);
        port = await adminServer.listen(0, "127.0.0.1");
    });

    afterEach(async () => {
        await adminServer.close();
        await cleanupTestRoot(testRoot);
    });

    it("(1) 1MiB + 1 바이트 본문 → 413", async () => {
        const bigBody = '"' + "a".repeat(1024 * 1024) + '"'; // 1 MiB + 2 bytes
        const response = await new Promise<{ status: number | undefined, body: string }>((resolve) => {
            const req = http.request({
                host: "127.0.0.1", port,
                path: "/api/login",
                method: "POST",
                headers: {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(bigBody)}
            }, (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                res.on("end", () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString("utf8")}));
            });
            req.on("error", () => resolve({status: undefined, body: "socket-error"}));
            req.write(bigBody);
            req.end();
        });
        // 413 응답이 오거나(서버가 응답 후 destroy), 소켓이 중간에 파괴될 수 있음.
        if(response.status !== undefined) {
            expect(response.status).toBe(413);
        } else {
            expect(response.body).toBe("socket-error");
        }
    });

    it("(+) headersTimeout / requestTimeout 런타임 스냅샷", () => {
        const srv: any = (adminServer as any)._server;
        expect(srv.headersTimeout).toBe(15_000);
        expect(srv.requestTimeout).toBe(30_000);
    });

    it("(2) 헤더 완성 후 body idle 10s → 408 or socket closed", async () => {
        // raw net.Socket 으로 POST 헤더만 보내고 body 대기.
        const result = await new Promise<{ status?: number, closed: boolean }>((resolve) => {
            const socket = net.connect({host: "127.0.0.1", port});
            let buf = Buffer.alloc(0);
            socket.on("data", (c) => { buf = Buffer.concat([buf, c]); });
            const finish = (closed: boolean) => {
                const firstLine = buf.toString("utf8").split("\r\n")[0] ?? "";
                const m = /^HTTP\/\d\.\d\s+(\d+)/.exec(firstLine);
                resolve({status: m ? parseInt(m[1], 10) : undefined, closed});
            };
            socket.on("close", () => finish(true));
            socket.on("error", () => finish(true));
            socket.on("connect", () => {
                // Content-Length 50 선언하지만 body 전송하지 않음.
                socket.write(
                    "POST /api/login HTTP/1.1\r\n" +
                    "Host: 127.0.0.1\r\n" +
                    "Content-Type: application/json\r\n" +
                    "Content-Length: 50\r\n" +
                    "\r\n"
                );
            });
        });
        // idle 10s 초과 시 408 (서버가 응답) 또는 서버가 소켓을 닫음.
        if(result.status !== undefined) {
            expect([408, 400, 413]).toContain(result.status);
        } else {
            expect(result.closed).toBe(true);
        }
    }, 40_000);
});
