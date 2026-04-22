/**
 * P5-T6 / REQ-19 — AdminServer listen 에러 리스너 누적 방지.
 *
 * Mock 금지: 실 AdminServer 인스턴스, 실제 포트 listen/close 반복.
 *
 * 3 케이스:
 *  (1) 여러 번 listen() 후 close() 해도 _server.listeners('error').length <= 1 유지.
 *  (2) 영구 핸들러는 항상 1 개 보존 (>= 1).
 *  (3) 영구 핸들러의 function identity 가 생성자에서 등록된 것과 동일.
 */
import AdminServer from "../../../../src/server/admin/AdminServer";
import SessionStore from "../../../../src/server/admin/SessionStore";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

jest.setTimeout(60_000);

describe("REQ-19 AdminServer listen listener accumulation prevention", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("req-19-listen");
        applyTestRoot(testRoot.rootDir);
        ServerOptionStore.instance;
        SessionStore.instance;
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    it("(1)(2)(3) 반복 listen / close 후에도 error 리스너 <= 1 유지, 영구 핸들러 identity 보존", async () => {
        const adminServer = new AdminServer({} as any, false);
        const permanentHandler = (adminServer as any)._permanentErrorHandler as Function;
        expect(typeof permanentHandler).toBe("function");

        const srv: any = (adminServer as any)._server;
        // 최초 상태: error listener 1개 (영구 핸들러만).
        expect(srv.listeners("error").length).toBe(1);
        expect(srv.listeners("error")[0]).toBe(permanentHandler);

        // 반복 listen → close.
        for(let i = 0; i < 10; i++) {
            const port = await adminServer.listen(0, "127.0.0.1");
            expect(port).toBeGreaterThan(0);
            // listen 직후에도 영구 핸들러는 유지되고, listen 임시 리스너는 제거된 상태 (on 'listening' 콜백에서 removeListener).
            expect(srv.listeners("error").length).toBeLessThanOrEqual(1);
            expect(srv.listeners("error").length).toBeGreaterThanOrEqual(1);
            expect(srv.listeners("error")).toContain(permanentHandler);
            await adminServer.close();
            // close 후에도 영구 핸들러는 살아있어야 한다.
            expect(srv.listeners("error")).toContain(permanentHandler);
        }

        // 최종 상태 체크.
        expect(srv.listeners("error").length).toBe(1);
        expect(srv.listeners("error")[0]).toBe(permanentHandler);
    });
});
