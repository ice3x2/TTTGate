// #303 — 역방향 프록시로 연 관리 화면은 저장 뒤 확인과 이동을 페이지와 같은 출처에서 한다.
// 관리 포트(adminPort)로 바로 가면 프록시가 듣지 않는 포트이고, 다른 출처라 쿠키도 실리지 않는다.
import {adminBaseUrl} from "../../admin/src/controller/adminAddress";

const direct = {protocol: "https:", hostname: "127.0.0.1", port: "9300", origin: "https://127.0.0.1:9300"};
const proxied = {protocol: "https:", hostname: "admin.example.com", port: "", origin: "https://admin.example.com"};

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as any).window;
afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    (globalThis as any).window = originalWindow;
});

test("a page opened on the admin port follows a new admin port and scheme", () => {
    expect(adminBaseUrl(direct, {adminTls: true, adminPort: 9400}, 9300)).toBe("https://127.0.0.1:9400/");
    expect(adminBaseUrl(direct, {adminTls: false, adminPort: 9300}, 9300)).toBe("http://127.0.0.1:9300/");
});

test("a page served through a proxy stays on the proxy origin", () => {
    expect(adminBaseUrl(proxied, {adminTls: true, adminPort: 9400}, 9300)).toBe("https://admin.example.com/");
    expect(adminBaseUrl({...proxied, port: "8443", origin: "https://admin.example.com:8443"}, {adminTls: true, adminPort: 9300}, 9300))
        .toBe("https://admin.example.com:8443/");
});

test("after a save, a proxied page checks the server option hash on the proxy origin", async () => {
    (globalThis as any).window = {location: proxied};
    const urls: string[] = [];
    (globalThis as any).fetch = async (input: string): Promise<any> => {
        urls.push(input);
        return {status: 200, json: async () => ({success: true, hash: "new-hash"})};
    };
    jest.resetModules();
    const ctrl = require("../../admin/src/controller/ServerOptionCtrl").default;
    (ctrl.instance as any)._severOptionHash = "old-hash";
    const changed = await ctrl.instance.checkChangeServerOption({adminTls: true, adminPort: 9300}, {adminTls: true, adminPort: 9300});
    expect(changed).toBe(true);
    expect(urls.length).toBeGreaterThan(0);
    for(const url of urls) expect(url).toBe("https://admin.example.com/api/serverOptionHash");
}, 10_000);
