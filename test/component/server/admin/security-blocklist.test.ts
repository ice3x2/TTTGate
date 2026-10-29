import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import AdminServer from "../../../../src/server/admin/AdminServer";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {BOOTSTRAP_TOKEN_FILE_NAME, IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {AuditEvent, AuditSink, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {AdmissionController} from "../../../../src/server/security/AdmissionController";
import {MAX_BLOCKLIST_ENTRIES} from "../../../../src/server/security/IpBlocklist";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

jest.setTimeout(30_000);

// #286 — 관리자 차단 목록 API.
const ADMIN_PASSWORD = "security-blocklist-admin-password";
const TUNNEL_PORT = 20002;

type ApiResponse = {status: number; headers: any; body: any};
type Auth = {Cookie: string; "X-CSRF-Token": string};
type StubSink = AuditSink & {events: AuditEvent[]};

const createStubSink = (): StubSink => ({
    events: [],
    reserve(): boolean { return true; },
    record(event: AuditEvent): Promise<void> { this.events.push(event); return Promise.resolve(); }
});

const authOf = (response: ApiResponse): Auth => {
    const pairs = (response.headers["set-cookie"] as string[]).map((value) => value.split(";")[0]);
    return {
        Cookie: pairs.join("; "),
        "X-CSRF-Token": pairs.find((value) => value.startsWith("csrfToken="))!.slice("csrfToken=".length)
    };
};

const ROUTES: ReadonlyArray<{method: string; target: string; body?: object}> = [
    {method: "GET", target: "/api/security/blocklist"},
    {method: "POST", target: "/api/security/blocklist", body: {address: "203.0.113.50"}},
    {method: "DELETE", target: `/api/security/blocklist/${encodeURIComponent("203.0.113.50")}`}
];

const banTwice = (ip: string): void => {
    const controller = AdmissionController.instance;
    controller.configureTunnel({forwardPort: TUNNEL_PORT, rateLimit: {enabled: true, windowMs: 60000, maxConnections: 1, banMs: 600000}});
    controller.admit({kind: "tunnel", port: TUNNEL_PORT, protocol: "tcp"}, ip);
    controller.admit({kind: "tunnel", port: TUNNEL_PORT, protocol: "tcp"}, ip);
};

describe("security-blocklist", () => {
    let testRoot: TestRoot;
    let api: AdminServer | undefined;
    let sink: StubSink;
    let bcryptCostBackup: number;
    let request: (method: string, target: string, body?: object, auth?: Partial<Auth>) => Promise<ApiResponse>;
    let su: Auth;
    let ru: Auth;
    const applied: any[] = [];

    const eventsOf = (type: string): AuditEvent[] => sink.events.filter((event) => event.type === type);
    const storedBlocklist = async (): Promise<any[]> => {
        const raw = await fs.readFile(path.join(testRoot.rootDir, "config", "server.yaml"), "utf8");
        return YAML.parse(raw).connectionSecurity?.blocklist ?? [];
    };
    const addresses = async (): Promise<string[]> =>
        (await request("GET", "/api/security/blocklist", {}, su)).body.entries.map((entry: any) => entry.address);
    const storeBlocklist = async (entries: object[]): Promise<void> => {
        const store = ServerOptionStore.instance;
        await store.runConfigurationMutation(async () => {
            const read = store.readServerOption();
            if(!read.success) throw new Error("server option not ready");
            read.serverOption.connectionSecurity = {...read.serverOption.connectionSecurity!, blocklist: entries as any};
            expect(store.commitPreparedServerOption(read.serverOption).success).toBe(true);
        });
    };
    const clear = async (): Promise<void> => {
        for(const address of await addresses()) {
            expect((await request("DELETE", `/api/security/blocklist/${encodeURIComponent(address)}`, {}, su)).status).toBe(200);
        }
    };

    beforeAll(async () => {
        bcryptCostBackup = IdentityStore.bcryptCost;
        IdentityStore.bcryptCost = 4;
        testRoot = await createTestRoot("security-blocklist");
        applyTestRoot(testRoot.rootDir);
        await CertificationStore.instance.load();

        const runtime = {applyConnectionSecurity: jest.fn((next: unknown) => { applied.push(next); })};
        api = new AdminServer(runtime as any, false);
        const port = await api.listen(0, "127.0.0.1");
        request = async (method, target, body = {}, auth = {}) => {
            const bytes = JSON.stringify(body);
            const response = await httpRequest({
                port, path: target, method,
                headers: {"Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bytes)), ...auth} as Record<string, string>,
                body: bytes
            });
            let parsed: any;
            try { parsed = JSON.parse(response.body); } catch { parsed = response.body; }
            return {status: response.statusCode, headers: response.headers, body: parsed};
        };

        await IdentityMigration.runAtStartup();
        const token = (await fs.readFile(path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();
        const bootstrap = await request("POST", "/api/login", {username: "admin", password: ADMIN_PASSWORD, bootstrapToken: token});
        expect(bootstrap.status).toBe(200);
        su = authOf(bootstrap);

        const group = await request("POST", "/api/groups", {name: "Operators"}, su);
        expect(group.status).toBe(201);
        const created = await request("POST", "/api/users", {username: "regular", role: "regular", groupId: group.body.group.id}, su);
        expect(created.status).toBe(201);
        const first = await request("POST", "/api/login", {username: "regular", password: created.body.temporaryPassword});
        expect(first.status).toBe(200);
        ru = authOf(first);
        const changed = await request("PUT", "/api/me/password",
            {currentPassword: created.body.temporaryPassword, newPassword: "regular-next-password"}, ru);
        expect(changed.status).toBe(200);

        sink = createStubSink();
        AuditSinkRegistry.set(sink);
    });

    beforeEach(async () => {
        AdmissionController.resetForTest();
        await clear();
        applied.length = 0;
    });

    afterAll(async () => {
        IdentityStore.bcryptCost = bcryptCostBackup;
        AuditSinkRegistry.reset();
        AdmissionController.resetForTest();
        try { await api?.close(); } finally { await cleanupTestRoot(testRoot); }
    });

    it("세션이 없으면 401, 일반 유저는 403 이고 상태가 바뀌지 않는다 (REQ-4 AC-5)", async () => {
        const anonymous = [];
        const regular = [];
        for(const route of ROUTES) {
            anonymous.push((await request(route.method, route.target, route.body)).status);
            regular.push((await request(route.method, route.target, route.body, ru)).status);
        }
        expect(anonymous).toEqual([401, 401, 401]);
        expect(regular).toEqual([403, 403, 403]);
        expect(applied).toEqual([]);
        expect(await storedBlocklist()).toEqual([]);
        expect(eventsOf("security_block_added")).toEqual([]);
    });

    it("빈 목록과 상한을 돌려준다", async () => {
        const response = await request("GET", "/api/security/blocklist", {}, su);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({entries: [], limit: MAX_BLOCKLIST_ENTRIES});
    });

    it("넣으면 정규화해 server.yaml 에 저장하고 바로 적용하며 감사를 남긴다 (REQ-2 AC-1, REQ-4 AC-4, REQ-6 AC-1)", async () => {
        const before = Date.now();
        const response = await request("POST", "/api/security/blocklist", {address: "198.51.100.9/24", port: 18080, note: " scanner "}, su);
        expect(response.status).toBe(201);
        const entry = response.body.entry;
        expect(entry).toMatchObject({address: "198.51.100.0/24", port: 18080, note: "scanner", createdBy: "admin"});
        expect(entry.createdAt).toBeGreaterThanOrEqual(before);

        expect(await storedBlocklist()).toEqual([entry]);
        expect(applied).toHaveLength(1);
        expect(applied[0].blocklist).toEqual([entry]);
        expect(applied[0].geo).toEqual({mode: "off", countries: [], applyToAdmin: true, unknownPolicy: "allow"});

        const events = eventsOf("security_block_added");
        expect(events[events.length - 1]).toMatchObject({
            outcome: "success",
            // 대상 id 는 정규화한 주소다. 풀 때와 같은 id 로 이어서 찾을 수 있다.
            target: {kind: "security", id: "198.51.100.0/24"},
            detail: {address: "198.51.100.0/24", port: 18080, note: "scanner"}
        });
        expect((await request("GET", "/api/security/blocklist", {}, su)).body.entries).toEqual([entry]);
    });

    it("잘못된 입력은 422 이고 저장·적용하지 않으며 실패 감사를 남긴다 (REQ-4 AC-2)", async () => {
        const before = eventsOf("security_block_added").length;
        const response = await request("POST", "/api/security/blocklist", {address: "0.0.0.0/0"}, su);
        expect(response.status).toBe(422);
        expect(response.body).toMatchObject({success: false, message: "a range that covers every address cannot be blocked"});
        expect(applied).toEqual([]);
        expect(await storedBlocklist()).toEqual([]);
        const events = eventsOf("security_block_added");
        expect(events).toHaveLength(before + 1);
        expect(events[events.length - 1].outcome).toBe("failure");
    });

    it("같은 주소는 409 already blocked 다 (REQ-4 AC-2, REQ-5 AC-3)", async () => {
        expect((await request("POST", "/api/security/blocklist", {address: "203.0.113.7", port: 18080}, su)).status).toBe(201);
        const response = await request("POST", "/api/security/blocklist", {address: "::ffff:203.0.113.7"}, su);
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({success: false, code: "duplicate", message: "203.0.113.7 is already blocked on port 18080"});
        expect(await addresses()).toEqual(["203.0.113.7"]);
    });

    it("상한에 이르면 409 full 이다 (REQ-4 AC-3)", async () => {
        const full = Array.from({length: MAX_BLOCKLIST_ENTRIES}, (_, i) =>
            ({address: `10.1.${Math.floor(i / 256)}.${i % 256}`, port: null, note: "", createdAt: 1, createdBy: "admin"}));
        await storeBlocklist(full);
        try {
            const response = await request("POST", "/api/security/blocklist", {address: "203.0.113.7"}, su);
            expect(response.status).toBe(409);
            expect(response.body.code).toBe("full");
        } finally {
            // 다음 테스트의 beforeEach 가 1,000개를 하나씩 지우지 않도록 여기서 한 번에 비운다.
            await storeBlocklist([]);
        }
    });

    it("fromBan 이 있으면 넣고 그 일시 차단을 함께 푼다 (REQ-5 AC-1·AC-2)", async () => {
        banTwice("203.0.113.9");
        expect(AdmissionController.instance.rateLimiter.bans(Date.now())).toHaveLength(1);
        const response = await request("POST", "/api/security/blocklist",
            {address: "203.0.113.9", note: `From rate-limit ban on ${TUNNEL_PORT}`, fromBan: {port: TUNNEL_PORT, ip: "203.0.113.9"}}, su);
        expect(response.status).toBe(201);
        expect(response.body.entry).toMatchObject({address: "203.0.113.9", port: null, note: `From rate-limit ban on ${TUNNEL_PORT}`});
        expect(response.body.unbanned).toBe(true);
        expect(AdmissionController.instance.rateLimiter.bans(Date.now())).toEqual([]);
    });

    it("IPv6 일시 차단의 /64 대역을 그대로 옮긴다", async () => {
        banTwice("2001:db8:7:3::1");
        const [ban] = AdmissionController.instance.rateLimiter.bans(Date.now());
        const response = await request("POST", "/api/security/blocklist", {address: ban.ip, fromBan: {port: ban.port, ip: ban.ip}}, su);
        expect(response.status).toBe(201);
        expect(response.body.entry.address).toBe("2001:db8:7:3::/64");
        expect(AdmissionController.instance.rateLimiter.bans(Date.now())).toEqual([]);
    });

    it("다른 포트에만 걸린 주소를 옮기면 그 항목을 All tunnels 로 넓히고 일시 차단을 푼다 (REQ-5 AC-1)", async () => {
        expect((await request("POST", "/api/security/blocklist", {address: "203.0.113.9", port: 9000, note: "scanner"}, su)).status).toBe(201);
        banTwice("203.0.113.9");
        const response = await request("POST", "/api/security/blocklist",
            {address: "203.0.113.9", note: "moved", fromBan: {port: TUNNEL_PORT, ip: "203.0.113.9"}}, su);
        expect(response.status).toBe(201);
        // 적용 범위만 넓히고 원래 메모는 지킨다.
        expect(response.body.entry).toMatchObject({address: "203.0.113.9", port: null, note: "scanner"});
        expect((await request("GET", "/api/security/blocklist", {}, su)).body.entries).toEqual([response.body.entry]);
        expect(AdmissionController.instance.rateLimiter.bans(Date.now())).toEqual([]);
    });

    it("fromBan 이 있으면 주소는 fromBan.ip 이고 적용 범위는 All tunnels 로 고정한다 (REQ-5 AC-1)", async () => {
        banTwice("203.0.113.9");
        const response = await request("POST", "/api/security/blocklist",
            {address: "198.51.100.1", port: 8080, fromBan: {port: TUNNEL_PORT, ip: "203.0.113.9"}}, su);
        expect(response.status).toBe(201);
        expect(response.body.entry).toMatchObject({address: "203.0.113.9", port: null});
        expect(await addresses()).toEqual(["203.0.113.9"]);
    });

    it("fromBan 만 보내도 감사 대상은 그 주소이고, 메모가 비면 출처 포트를 쓴다 (REQ-5 AC-1, REQ-6 AC-1)", async () => {
        banTwice("203.0.113.9");
        const response = await request("POST", "/api/security/blocklist", {fromBan: {port: TUNNEL_PORT, ip: "203.0.113.9"}}, su);
        expect(response.status).toBe(201);
        expect(response.body.entry).toMatchObject({address: "203.0.113.9", port: null, note: `From rate-limit ban on ${TUNNEL_PORT}`});
        const events = eventsOf("security_block_added");
        expect(events[events.length - 1].target).toEqual({kind: "security", id: "203.0.113.9"});
    });

    it("fromBan.ip 의 앞뒤 공백은 지우고 옮긴다", async () => {
        banTwice("203.0.113.9");
        const response = await request("POST", "/api/security/blocklist", {fromBan: {port: TUNNEL_PORT, ip: "  203.0.113.9  "}}, su);
        expect(response.status).toBe(201);
        expect(response.body.unbanned).toBe(true);
        const events = eventsOf("security_block_added");
        expect(events[events.length - 1].detail).toMatchObject({fromBan: {port: TUNNEL_PORT, ip: "203.0.113.9"}});
    });

    it("차단 목록이 거절한 연결은 감사 로그에 남지 않는다 (REQ-6 AC-2)", async () => {
        expect((await request("POST", "/api/security/blocklist", {address: "203.0.113.7"}, su)).status).toBe(201);
        AdmissionController.instance.configureConnectionSecurity(applied[applied.length - 1]);
        const before = sink.events.length;
        for(let i = 0; i < 5; i++) {
            expect(AdmissionController.instance.admit({kind: "tunnel", port: TUNNEL_PORT, protocol: "tcp"}, "203.0.113.7"))
                .toMatchObject({reason: "ip-blocklist"});
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(sink.events.length).toBe(before);
    });

    it("넣기가 실패하면 일시 차단을 풀지 않는다", async () => {
        expect((await request("POST", "/api/security/blocklist", {address: "203.0.113.9"}, su)).status).toBe(201);
        banTwice("203.0.113.9");
        const response = await request("POST", "/api/security/blocklist", {address: "203.0.113.9", fromBan: {port: TUNNEL_PORT, ip: "203.0.113.9"}}, su);
        expect(response.status).toBe(409);
        expect(AdmissionController.instance.rateLimiter.bans(Date.now())).toHaveLength(1);
    });

    it("fromBan 의 형식이 틀리면 422 다", async () => {
        const response = await request("POST", "/api/security/blocklist", {address: "203.0.113.9", fromBan: {port: "x", ip: 3}}, su);
        expect(response.status).toBe(422);
        expect(await storedBlocklist()).toEqual([]);
    });

    it("DELETE 는 다른 표기로도 항목을 풀고 감사를 남기며, 없으면 removed:false 다 (REQ-6 AC-1)", async () => {
        expect((await request("POST", "/api/security/blocklist", {address: "2001:db8:1::/48"}, su)).status).toBe(201);
        applied.length = 0;
        const removed = await request("DELETE", `/api/security/blocklist/${encodeURIComponent("2001:DB8:1:0::/48")}`, {}, su);
        expect(removed.status).toBe(200);
        expect(removed.body.removed).toBe(true);
        expect(await storedBlocklist()).toEqual([]);
        expect(applied).toHaveLength(1);
        expect(applied[0].blocklist).toEqual([]);
        const events = eventsOf("security_block_removed");
        expect(events[events.length - 1]).toMatchObject({
            outcome: "success",
            target: {kind: "security", id: "2001:db8:1::/48"},
            detail: {address: "2001:db8:1::/48", port: null, note: "", removed: true}
        });

        const again = await request("DELETE", `/api/security/blocklist/${encodeURIComponent("2001:db8:1::/48")}`, {}, su);
        expect(again.status).toBe(200);
        expect(again.body.removed).toBe(false);
        const missed = eventsOf("security_block_removed");
        expect(missed[missed.length - 1]).toMatchObject({outcome: "success", detail: {address: "2001:db8:1::/48", removed: false}});
        expect(applied).toHaveLength(1);
    });

    it("국가 필터를 저장해도 차단 목록은 남는다 (REQ-2 AC-4)", async () => {
        const added = await request("POST", "/api/security/blocklist", {address: "203.0.113.7"}, su);
        applied.length = 0;
        const response = await request("PUT", "/api/security/geo", {mode: "deny", countries: ["KP"]}, su);
        expect(response.status).toBe(200);
        expect(await storedBlocklist()).toEqual([added.body.entry]);
        expect(applied[0].blocklist).toEqual([added.body.entry]);
        expect((await request("PUT", "/api/security/geo", {mode: "off"}, su)).status).toBe(200);
    });

    it("서버 설정 저장은 요청의 차단 목록을 무시하고 지금 목록을 지킨다", async () => {
        const added = await request("POST", "/api/security/blocklist", {address: "203.0.113.7"}, su);
        const read = await request("GET", "/api/serverOption", {}, su);
        expect(read.status).toBe(200);
        const serverOption = read.body.serverOption;
        const saved = await request("PUT", "/api/serverOption", {
            ...serverOption,
            connectionSecurity: {...serverOption.connectionSecurity, blocklist: []},
            expectedRevision: read.body.revisionState.currentRevision
        }, su);
        expect(saved.status).toBe(200);
        expect(await storedBlocklist()).toEqual([added.body.entry]);
    });

    it("서버 설정 저장 요청에 connectionSecurity 가 없어도 차단 목록은 남는다", async () => {
        const added = await request("POST", "/api/security/blocklist", {address: "203.0.113.7"}, su);
        const read = await request("GET", "/api/serverOption", {}, su);
        const {connectionSecurity: _omit, ...serverOption} = read.body.serverOption;
        void _omit;
        const saved = await request("PUT", "/api/serverOption", {...serverOption, expectedRevision: read.body.revisionState.currentRevision}, su);
        expect(saved.status).toBe(200);
        expect(await storedBlocklist()).toEqual([added.body.entry]);
    });

    it("설정 커밋이 실패하면 500 이고 적용하지 않는다", async () => {
        const commit = jest.spyOn(ServerOptionStore.instance, "commitPreparedServerOption")
            .mockReturnValueOnce({success: false, message: "disk full"});
        try {
            const response = await request("POST", "/api/security/blocklist", {address: "203.0.113.7"}, su);
            expect(response.status).toBe(500);
        } finally {
            commit.mockRestore();
        }
        expect(applied).toEqual([]);
        expect(await storedBlocklist()).toEqual([]);
    });
});
