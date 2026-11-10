import type {ClientStatus, SysInfo, Usage} from "../../admin/src/controller/Types";
import {translator} from "../../admin/src/i18n";
import {errorMessageOf} from "../../admin/src/i18n/serverError";

// ServerStatusCtrl 의 메서드마다 AdminServer 가 감싸 보내는 봉투가 다르다.
// 이 테스트는 각 메서드가 자기 봉투를 풀어 값을 돌려주는지 하나씩 대조해 고정한다.
// 봉투 형태의 근거: src/server/admin/AdminServer.ts 의 sendApiSuccess 호출부.

const USAGE: Usage = {
    memory: {free: 2048, total: 8192, process: 512},
    cpu: {total: 40, process: 12.5},
    uptime: 65000,
    heap: {used: 1024, total: 4096},
    totalBuffer: {used: 256, total: 1024}
};

const SYS_INFO: SysInfo = {
    osInfo: {platform: "linux", release: "6.1", type: "Linux", hostname: "server-a"},
    cpuInfo: {model: "Fixture CPU", speed: 2400, cores: 4},
    ram: 8589934592,
    network: {
        eth0: [{
            address: "10.0.0.2", netmask: "255.255.255.0", family: "IPv4",
            mac: "00:11:22:33:44:55", internal: false, cidr: "10.0.0.2/24"
        }]
    }
};

const CLIENT_STATUSES: Array<ClientStatus> = [
    {id: 1, name: "client-a", uptime: 65000, address: "127.0.0.1:50000", activeSessionCount: 0}
];

type StubResponse = {status?: number; body: unknown};

const originalFetch = globalThis.fetch;
let requested: string[] = [];

// 경로마다 응답을 고정한다. 등록하지 않은 경로를 부르면 그 자리에서 드러나게 한다.
// AdminRequest 를 거치는 메서드는 절대 주소로 부르므로 경로만 떼어 기록한다.
const stubFetch = (responses: {[path: string]: StubResponse}): void => {
    (globalThis as any).fetch = async (input: string): Promise<any> => {
        const path = new URL(input, "http://localhost:9300/").pathname;
        requested.push(path);
        const entry = responses[path];
        if(!entry) throw new Error(`Unexpected fetch: ${path}`);
        return new Response(JSON.stringify(entry.body), {status: entry.status ?? 200});
    };
};

const globals = globalThis as {window?: unknown};

// 싱글턴 캐시가 테스트 사이에 새지 않도록 모듈 그래프를 매번 새로 만든다.
// InvalidSession 도 같은 그래프에서 가져와야 instanceof 가 성립한다.
const loadModules = (): {ctrl: any; InvalidSession: any} => {
    jest.resetModules();
    return {
        ctrl: require("../../admin/src/controller/ServerStatusCtrl").default,
        InvalidSession: require("../../admin/src/controller/InvalidSession").default
    };
};

beforeEach(() => {
    requested = [];
    globals.window = {location: new URL("http://localhost:9300/")};
});
afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    delete globals.window;
});

test("getSysUsage 는 {success, sysUsage} 봉투를 풀어 cpu·memory 를 한 단계로 읽게 한다", async () => {
    stubFetch({"/api/sysUsage": {body: {success: true, sysUsage: USAGE}}});
    const {ctrl} = loadModules();

    const usage: Usage = await ctrl.instance.getSysUsage();

    expect(usage.cpu.process).toBe(12.5);
    expect(usage.cpu.total).toBe(40);
    expect(usage.memory.process).toBe(512);
    expect(usage.memory.total).toBe(8192);
    expect(usage.heap.used).toBe(1024);
    expect(usage.totalBuffer.total).toBe(1024);
    expect(usage.uptime).toBe(65000);
    expect((usage as any).success).toBeUndefined();
    expect((usage as any).sysUsage).toBeUndefined();
});

test("getSysUsage 는 시스템 정보 캐시를 채우지 않으므로 뒤이은 getSysInfo 가 실제로 요청한다", async () => {
    stubFetch({
        "/api/sysUsage": {body: {success: true, sysUsage: USAGE}},
        "/api/sysInfo": {body: {success: true, sysInfo: SYS_INFO}}
    });
    const {ctrl} = loadModules();

    await ctrl.instance.getSysUsage();
    const result = await ctrl.instance.getSysInfo();

    expect(requested).toEqual(["/api/sysUsage", "/api/sysInfo"]);
    expect(result.sysInfo.cpuInfo.model).toBe("Fixture CPU");
});

// 이슈 349 검토 H-1: 시스템 정보 두 메서드는 실패를 예외가 아니라 실패 값으로 돌려준다. 화면은 errorMessageOf 로 번역해 보인다.
test("getSysInfo 는 {success: true, sysInfo} 를 돌려주고 두 번째 호출은 캐시로 답한다", async () => {
    stubFetch({"/api/sysInfo": {body: {success: true, sysInfo: SYS_INFO}}});
    const {ctrl} = loadModules();

    const first = await ctrl.instance.getSysInfo();
    const second = await ctrl.instance.getSysInfo();

    expect(first.success).toBe(true);
    const sysInfo: SysInfo = first.sysInfo;
    expect(sysInfo.osInfo.hostname).toBe("server-a");
    expect(sysInfo.ram).toBe(8589934592);
    expect(sysInfo.network.eth0[0].address).toBe("10.0.0.2");
    expect(second).toEqual(first);
    expect(requested).toEqual(["/api/sysInfo"]);
});

test("getClientSysInfo 는 {success: true, sysInfo} 를 돌려주고 id 별로 캐시한다", async () => {
    stubFetch({"/api/clientSysInfo/1": {body: {success: true, sysInfo: SYS_INFO}}});
    const {ctrl} = loadModules();

    const first = await ctrl.instance.getClientSysInfo(1);
    const second = await ctrl.instance.getClientSysInfo(1);

    expect(first.success).toBe(true);
    expect(first.sysInfo.cpuInfo.cores).toBe(4);
    expect(first.sysInfo.osInfo.type).toBe("Linux");
    expect(second.sysInfo).toBe(first.sysInfo);
    expect(requested).toEqual(["/api/clientSysInfo/1"]);
});

test("getClientSysInfo 는 서버가 거절하면 code 를 담은 실패 값을 돌려주고 캐시하지 않는다", async () => {
    stubFetch({"/api/clientSysInfo/2": {status: 400, body: {success: false, code: "invalid_client_id", message: "Invalid client ID"}}});
    const {ctrl} = loadModules();

    const result = await ctrl.instance.getClientSysInfo(2);
    await ctrl.instance.getClientSysInfo(2);

    expect(result).toMatchObject({success: false, status: 400, code: "invalid_client_id"});
    expect(errorMessageOf(result, "fallback", translator("ko"))).toBe("클라이언트 ID가 올바르지 않습니다.");
    expect(errorMessageOf(result, "fallback", translator("en"))).toBe("Invalid client ID");
    expect(requested).toEqual(["/api/clientSysInfo/2", "/api/clientSysInfo/2"]);
});

test("getSysInfo 는 서버가 거절하면 실패 값을 돌려주고 캐시하지 않는다", async () => {
    stubFetch({"/api/sysInfo": {status: 403, body: {success: false, code: "forbidden", message: "Forbidden"}}});
    const {ctrl} = loadModules();

    const result = await ctrl.instance.getSysInfo();
    await ctrl.instance.getSysInfo();

    expect(result).toMatchObject({success: false, status: 403, code: "forbidden"});
    expect(requested).toEqual(["/api/sysInfo", "/api/sysInfo"]);
});

test("시스템 정보 요청이 서버에 닿지 못하면 실패 값이 되고, 화면 문구는 원문 대신 대체 문구다", async () => {
    (globalThis as any).fetch = async (): Promise<any> => { throw new TypeError("Failed to fetch"); };
    const {ctrl} = loadModules();

    const server = await ctrl.instance.getSysInfo();
    const client = await ctrl.instance.getClientSysInfo(1);

    expect(server.success).toBe(false);
    expect(client.success).toBe(false);
    expect(errorMessageOf(server, "연결 실패", translator("ko"))).toBe("연결 실패");
    expect(errorMessageOf(client, "연결 실패", translator("ko"))).toBe("연결 실패");
});

test("getClientStatus 는 {success, statuses} 봉투를 풀어 배열을 돌려준다", async () => {
    stubFetch({"/api/clientStatus": {body: {success: true, statuses: CLIENT_STATUSES}}});
    const {ctrl} = loadModules();

    const statuses: Array<ClientStatus> = await ctrl.instance.getClientStatus();

    expect(Array.isArray(statuses)).toBe(true);
    expect(statuses).toHaveLength(1);
    expect(statuses[0].id).toBe(1);
    expect(statuses[0].name).toBe("client-a");
    expect(statuses[0].address).toBe("127.0.0.1:50000");
});

test("getVersion 은 봉투와 값이 같은 층이므로 응답을 그대로 돌려준다", async () => {
    stubFetch({"/api/version": {body: {success: true, name: "TTTGate", build: "1.2.3"}}});
    const {ctrl} = loadModules();

    const version = await ctrl.getVersion();

    expect(version.name).toBe("TTTGate");
    expect(version.build).toBe("1.2.3");
});

test("401 응답은 메서드마다 InvalidSession 으로 드러난다", async () => {
    stubFetch({
        "/api/sysUsage": {status: 401, body: {success: false}},
        "/api/sysInfo": {status: 401, body: {success: false}},
        "/api/clientStatus": {status: 401, body: {success: false}},
        "/api/clientSysInfo/1": {status: 401, body: {success: false}}
    });
    const {ctrl, InvalidSession} = loadModules();

    await expect(ctrl.instance.getSysUsage()).rejects.toBeInstanceOf(InvalidSession);
    await expect(ctrl.instance.getSysInfo()).rejects.toBeInstanceOf(InvalidSession);
    await expect(ctrl.instance.getClientStatus()).rejects.toBeInstanceOf(InvalidSession);
    await expect(ctrl.instance.getClientSysInfo(1)).rejects.toBeInstanceOf(InvalidSession);
});
