// #303 — 역방향 프록시로 연 관리 화면은 저장 뒤 확인과 이동을 페이지와 같은 출처에서 한다.
// 관리 포트(adminPort)로 바로 가면 프록시가 듣지 않는 포트이고, 다른 출처라 쿠키도 실리지 않는다.
import {adminAddressAfterSave, adminBaseUrl} from "../../admin/src/controller/adminAddress";
import {translator} from "../../admin/src/i18n";

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

test("a page opened directly on admin port 443 or 80 is not mistaken for a proxied page", () => {
    expect(adminBaseUrl({protocol: "https:", hostname: "h", port: "", origin: "https://h"}, {adminTls: true, adminPort: 9400}, 443)).toBe("https://h:9400/");
    expect(adminBaseUrl({protocol: "http:", hostname: "h", port: "", origin: "http://h"}, {adminTls: false, adminPort: 9400}, 80)).toBe("http://h:9400/");
    expect(adminBaseUrl({protocol: "http:", hostname: "[::1]", port: "9300", origin: "http://[::1]:9300"}, {adminTls: false, adminPort: 9400}, 9300)).toBe("http://[::1]:9400/");
});

test("a page served through a proxy stays on the proxy origin", () => {
    expect(adminBaseUrl(proxied, {adminTls: true, adminPort: 9400}, 9300)).toBe("https://admin.example.com/");
    expect(adminBaseUrl({...proxied, port: "8443", origin: "https://admin.example.com:8443"}, {adminTls: true, adminPort: 9300}, 9300))
        .toBe("https://admin.example.com:8443/");
});

// 이슈 370 C-1·AC-4 — 관리 화면 포트·TLS 는 서버 프로그램을 다시 시작해야 바뀐다. 저장 뒤에는 지금 주소에 머물고,
// 바뀌었으면 다시 시작해야 한다고(restartRequired) 알린다. 새 주소(restartTo)는 지금 주소와 다를 때만 준다.
// 프록시로 연 화면은 새 주소도 프록시 주소라 알려 줄 주소가 없다. 다시 시작한 뒤에는 프록시가 넘기는 포트를 바꿔야 한다(PR 373 리뷰 M-1).
describe("adminAddressAfterSave", () => {
    test("관리 포트를 바꾸면 지금 주소에 머물고, 다시 시작한 뒤 열 새 주소를 돌려준다", () => {
        expect(adminAddressAfterSave(direct, {adminTls: true, adminPort: 9300}, {adminTls: true, adminPort: 9400}, 9300))
            .toEqual({stay: "https://127.0.0.1:9300/", restartRequired: true, restartTo: "https://127.0.0.1:9400/"});
    });

    test("관리 화면 TLS 만 바꿔도 지금 주소에 머문다", () => {
        expect(adminAddressAfterSave(direct, {adminTls: true, adminPort: 9300}, {adminTls: false, adminPort: 9300}, 9300))
            .toEqual({stay: "https://127.0.0.1:9300/", restartRequired: true, restartTo: "http://127.0.0.1:9300/"});
    });

    test("관리 화면 설정을 바꾸지 않았으면 새 주소가 없다", () => {
        expect(adminAddressAfterSave(direct, {adminTls: true, adminPort: 9300}, {adminTls: true, adminPort: 9300}, 9300))
            .toEqual({stay: "https://127.0.0.1:9300/"});
    });

    test("프록시로 연 화면은 프록시 주소에 머물고, 다시 시작해야 한다고만 알린다(새 주소가 없다)", () => {
        expect(adminAddressAfterSave(proxied, {adminTls: true, adminPort: 9300}, {adminTls: true, adminPort: 9400}, 9300))
            .toEqual({stay: "https://admin.example.com/", restartRequired: true});
        expect(adminAddressAfterSave(proxied, {adminTls: true, adminPort: 9300}, {adminTls: false, adminPort: 9300}, 9300))
            .toEqual({stay: "https://admin.example.com/", restartRequired: true});
    });

    test("주소 없는 안내는 다시 시작하고 프록시가 넘기는 포트도 바꾸라고 말한다", () => {
        expect(translator("ko").t("server.restartRequired"))
            .toBe("관리 화면 포트·TLS 변경은 TTTGate 서버를 다시 시작해야 반영됩니다. 프록시를 쓰면 프록시가 넘기는 포트도 바꾸세요.");
        expect(translator("en").t("server.restartRequired"))
            .toBe("Admin port and TLS changes take effect after you restart TTTGate. If you use a proxy, also change the port it forwards to.");
    });

    test("새 주소 안내는 다시 시작한 뒤 그 주소로 접속하라고 말한다", () => {
        expect(translator("ko").t("server.restartToOpen", {address: "https://h:9400/"}))
            .toBe("서버 설정을 적용했습니다. 새 관리 화면 주소는 TTTGate 서버를 다시 시작해야 열립니다. 다시 시작한 뒤 이 주소로 접속하세요: https://h:9400/");
        expect(translator("en").t("server.restartToOpen", {address: "https://h:9400/"}))
            .toBe("Server settings applied. The new admin address opens only after you restart TTTGate. Restart it, then open: https://h:9400/");
    });
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

test("a proxied page keeps asking the proxy origin when the admin port changes and the first check fails", async () => {
    (globalThis as any).window = {location: proxied};
    const urls: string[] = [];
    (globalThis as any).fetch = async (input: string): Promise<any> => {
        urls.push(input);
        if(urls.length === 1) throw new Error("restarting");
        return {status: 200, json: async () => ({success: true, hash: "new-hash"})};
    };
    jest.resetModules();
    const ctrl = require("../../admin/src/controller/ServerOptionCtrl").default;
    (ctrl.instance as any)._severOptionHash = "old-hash";
    expect(await ctrl.instance.checkChangeServerOption({adminTls: true, adminPort: 9300}, {adminTls: true, adminPort: 9400})).toBe(true);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for(const url of urls) expect(url).toBe("https://admin.example.com/api/serverOptionHash");
}, 10_000);
