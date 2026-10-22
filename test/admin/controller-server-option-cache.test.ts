// #155 — 서버 옵션 응답에는 서버 키와 신뢰 클라이언트 clientSecret 평문이 들어 있다. 세션이 끝나면 컨트롤러 캐시에서 지운다.
const originalFetch = globalThis.fetch;

afterEach(() => { (globalThis as any).fetch = originalFetch; });

test("clearCache 는 캐시한 서버 옵션의 비밀값을 지운다", async () => {
    (globalThis as any).fetch = async (input: string): Promise<any> => {
        if(input !== "/api/serverOption") throw new Error(`Unexpected fetch: ${input}`);
        return {status: 200, json: async () => ({
            success: true,
            serverOption: {key: "server-key-secret", adminPort: 9300, adminTls: false, port: 9126, tls: false, globalMemCacheLimit: 128, keepAlive: 0,
                trustedClients: [{clientId: "client-a", clientSecret: "client-secret-a"}]},
            revisionState: {currentRevision: 3}
        })};
    };
    jest.resetModules();
    const ctrl = require("../../admin/src/controller/ServerOptionCtrl").default;
    await ctrl.instance.getServerOption();
    expect(JSON.stringify(ctrl.instance.getCachedServerOption())).toContain("client-secret-a");

    ctrl.instance.clearCache();

    const cached = JSON.stringify(ctrl.instance.getCachedServerOption());
    expect(cached).not.toContain("client-secret-a");
    expect(cached).not.toContain("server-key-secret");
});
