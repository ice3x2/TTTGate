/**
 * P5-T1 / REQ-03 — /api/serverOptionHash 인증·Origin·cloneDeep 검증.
 *
 * Mock 금지: 실 http.request + 실 AdminServer + 실 ServerOptionStore.
 *
 * 3 + 1 케이스:
 *  (a) 세션 쿠키 없이 GET → 401.
 *  (b) 외부 Origin 요청 시 Access-Control-Allow-Origin 응답 헤더 미노출 + Vary: Origin 항상 존재.
 *  (c) /api/serverOption + /api/serverOptionHash 연속 호출 후
 *      ServerOptionStore.instance.serverOption.tunnelingOptions 가 보존 (cloneDeep 증거).
 *  (+) 자기 호스트 Origin (127.0.0.1) 요청 시에만 Access-Control-Allow-Origin 노출.
 */
import fs from "fs/promises";
import Path from "path";
import AdminServer from "../../src/server/admin/AdminServer";
import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from "../../src/server/admin/SessionStore";
import ServerOptionStore from "../../src/server/ServerOptionStore";
import {httpRequest} from "../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../helpers/runtime";

jest.setTimeout(30_000);

describe("REQ-03 /api/serverOptionHash auth + CORS + cloneDeep", () => {
    let testRoot: TestRoot;
    let adminServer: AdminServer;
    let port: number;
    let bootstrapToken: string;

    beforeEach(async () => {
        testRoot = await createTestRoot("req-03-hash");
        applyTestRoot(testRoot.rootDir);
        ServerOptionStore.instance;
        SessionStore.instance;
        adminServer = new AdminServer({} as any, false);
        port = await adminServer.listen(0, "127.0.0.1");
        bootstrapToken = (await fs.readFile(
            Path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME),
            {encoding: "utf-8"}
        )).trim();
    });

    afterEach(async () => {
        await adminServer.close();
        await cleanupTestRoot(testRoot);
    });

    async function loginCookie(): Promise<string> {
        const r = await httpRequest({
            port, path: "/api/login", method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({key: "supersecret1", bootstrapToken})
        });
        expect(r.statusCode).toBe(200);
        const sc = r.headers["set-cookie"] as string[];
        return sc.map((c) => c.split(";")[0]).join("; ");
    }

    it("(a) 세션 쿠키 없이 → 401", async () => {
        const r = await httpRequest({port, path: "/api/serverOptionHash"});
        expect(r.statusCode).toBe(401);
    });

    it("(b) 외부 Origin → CORS 헤더 미노출, Vary: Origin 은 여전히 존재", async () => {
        const cookie = await loginCookie();
        const r = await httpRequest({
            port, path: "/api/serverOptionHash",
            headers: {cookie, "Origin": "http://evil.example.com"}
        });
        expect(r.statusCode).toBe(200);
        expect(r.headers["access-control-allow-origin"]).toBeUndefined();
        expect((r.headers["vary"] ?? "").toString().toLowerCase()).toContain("origin");
    });

    it("(+) 자기 호스트 Origin → Access-Control-Allow-Origin 노출", async () => {
        const cookie = await loginCookie();
        const selfOrigin = `http://127.0.0.1:${port}`;
        const r = await httpRequest({
            port, path: "/api/serverOptionHash",
            headers: {cookie, "Origin": selfOrigin}
        });
        expect(r.statusCode).toBe(200);
        expect(r.headers["access-control-allow-origin"]).toBe(selfOrigin);
    });

    it("(++) Origin 포트가 다르면 CORS 허용 아님 (hostname 만 일치하는 우회 차단)", async () => {
        const cookie = await loginCookie();
        // hostname 은 127.0.0.1 로 같지만 포트가 다름.
        const otherPort = port === 65535 ? 65534 : port + 1;
        const spoofedOrigin = `http://127.0.0.1:${otherPort}`;
        const r = await httpRequest({
            port, path: "/api/serverOptionHash",
            headers: {cookie, "Origin": spoofedOrigin}
        });
        expect(r.statusCode).toBe(200);
        // 포트 불일치 → Access-Control-Allow-Origin 미노출.
        expect(r.headers["access-control-allow-origin"]).toBeUndefined();
        expect((r.headers["vary"] ?? "").toString().toLowerCase()).toContain("origin");
    });

    it("(c) serverOption + serverOptionHash 연속 호출 후 tunnelingOptions 보존 (cloneDeep 증거)", async () => {
        // 사전: tunnelingOption 하나 주입.
        const store = ServerOptionStore.instance;
        const before = store.serverOption;
        const originalTunnels = Array.isArray(before.tunnelingOptions) ? before.tunnelingOptions.slice() : [];

        const cookie = await loginCookie();
        const r1 = await httpRequest({port, path: "/api/serverOption", headers: {cookie}});
        expect(r1.statusCode).toBe(200);
        const r2 = await httpRequest({port, path: "/api/serverOptionHash", headers: {cookie}});
        expect(r2.statusCode).toBe(200);

        // tunnelingOptions 가 store 원본에서 삭제되어서는 안 됨 — cloneDeep 이후 외부 객체에 대한 delete 만 일어나야.
        const after = store.serverOption;
        expect(Array.isArray(after.tunnelingOptions)).toBe(true);
        expect(after.tunnelingOptions.length).toBe(originalTunnels.length);
    });
});
