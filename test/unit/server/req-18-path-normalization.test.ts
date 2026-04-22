/**
 * P5-T7 / REQ-18 — onGetWebResource 경로 정규화 (Windows 대소문자 + path traversal 방어).
 *
 * Mock 금지: 실 http.request + 실 AdminServer.
 *
 * 케이스:
 *  (a) 소문자 `index.html` 요청 → 200 + text/html.
 *  (b) 대문자 `INDEX.HTML` 요청 → basename 소문자 비교로 octet-stream 차단 로직을 우회하지만,
 *      실제 FS 상 파일 존재 여부에 따라 대소문자 무시 FS(Win)에서는 200, 대소문자 구분 FS 에서는 404.
 *      → 핵심 계약: "application/octet-stream + index.html basename 이면 404 로 내치지 않는다".
 *      즉, 같은 소문자 basename 으로 취급되어 octet-stream 분기에서 걸러지지 않음을 확인.
 *  (c) `/` 루트 요청 → index.html 로 기본 서빙 → 200.
 *  (d) `../secret` 등 상위 탈출 시도 → 404.
 *  (e) URL 인코딩된 `..` 탈출 시도 → 404.
 */
import fs from "fs/promises";
import Path from "path";
import AdminServer from "../../../src/server/admin/AdminServer";
import SessionStore from "../../../src/server/admin/SessionStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {httpRequest} from "../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot, writeWebFixture} from "../../helpers/runtime";

jest.setTimeout(30_000);

describe("REQ-18 onGetWebResource path normalization", () => {
    let testRoot: TestRoot;
    let adminServer: AdminServer;
    let port: number;

    beforeEach(async () => {
        testRoot = await createTestRoot("req-18-path");
        applyTestRoot(testRoot.rootDir);
        ServerOptionStore.instance;
        SessionStore.instance;
        await writeWebFixture(testRoot.rootDir, "index.html", "<html><body>OK</body></html>");
        // 탈출 방어 테스트용: web 디렉토리 밖에 시크릿 파일 생성.
        await fs.writeFile(Path.join(testRoot.rootDir, "config", "secret.txt"), "TOP_SECRET", {encoding: "utf-8"});
        adminServer = new AdminServer({} as any, false);
        port = await adminServer.listen(0, "127.0.0.1");
    });

    afterEach(async () => {
        await adminServer.close();
        await cleanupTestRoot(testRoot);
    });

    it("(a) 소문자 /index.html → 200 + text/html", async () => {
        const r = await httpRequest({port, path: "/index.html"});
        expect(r.statusCode).toBe(200);
        expect((r.headers["content-type"] ?? "").toString().toLowerCase()).toContain("text/html");
    });

    it("(b) 대문자 /INDEX.HTML → basename 소문자 비교로 octet-stream 차단 분기를 통과", async () => {
        // Windows 파일 시스템은 대소문자 무시 → 200.
        // Linux/macOS 등 대소문자 구분 FS 에서는 파일이 실제로 존재하지 않아 404.
        // 어느 쪽이든 "Content-Type 이 octet-stream 이라서 index.html 이 아니다" 로 거부당해선 안 된다.
        const r = await httpRequest({port, path: "/INDEX.HTML"});
        if(process.platform === "win32") {
            expect(r.statusCode).toBe(200);
        } else {
            // 파일 자체가 없어서 404 가 되는 것은 정상. 403/400 등 다른 코드면 회귀.
            expect([200, 404]).toContain(r.statusCode);
        }
    });

    it("(c) / 루트 → index.html 기본 서빙 → 200", async () => {
        const r = await httpRequest({port, path: "/"});
        expect(r.statusCode).toBe(200);
        expect(r.body).toContain("OK");
    });

    it("(d) /../config/secret.txt 탈출 시도 → 404", async () => {
        const r = await httpRequest({port, path: "/../config/secret.txt"});
        expect(r.statusCode).toBe(404);
        expect(r.body).not.toContain("TOP_SECRET");
    });

    it("(e) URL 인코딩된 ..%2fconfig 탈출 시도 → 404", async () => {
        const r = await httpRequest({port, path: "/%2e%2e/config/secret.txt"});
        expect(r.statusCode).toBe(404);
        expect(r.body).not.toContain("TOP_SECRET");
    });
});
