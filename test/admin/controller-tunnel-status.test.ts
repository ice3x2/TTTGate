// 이슈 348 FR-14 — 상태 API 의 최상위 requesterIp 를 컨트롤러가 화면에 넘긴다. 옛 서버 응답에는 없으므로 null 로 준다.

// 모듈로 둔다. 다른 테스트 파일의 같은 이름 전역 변수와 겹치지 않게 한다.
export {};

const originalFetch = globalThis.fetch;

const stubStatuses = (body: unknown): void => {
    (globalThis as any).fetch = async (input: string): Promise<any> => {
        if(input !== "/api/externalServerStatuses") throw new Error(`Unexpected fetch: ${input}`);
        return {status: 200, json: async () => body};
    };
};

const loadCtrl = (): any => {
    jest.resetModules();
    return require("../../admin/src/controller/ServerOptionCtrl").default;
};

afterEach(() => { (globalThis as any).fetch = originalFetch; });

test("loadTunnelingStatus 는 requesterIp 를 함께 돌려준다", async () => {
    const statuses = [{port: 2222, activatorIpOnly: true, myAllowedIp: "203.0.113.5", allowedIpCount: 1}];
    stubStatuses({success: true, serverTime: 10, requesterIp: "198.51.100.1", statuses});
    const result = await loadCtrl().instance.loadTunnelingStatus();
    expect(result).toEqual({serverTime: 10, requesterIp: "198.51.100.1", statuses});
});

test("옛 서버 응답에 requesterIp 가 없으면 null 이다", async () => {
    stubStatuses({success: true, serverTime: 10, statuses: []});
    expect((await loadCtrl().instance.loadTunnelingStatus()).requesterIp).toBeNull();
});
