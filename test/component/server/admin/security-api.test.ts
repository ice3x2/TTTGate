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
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

jest.setTimeout(30_000);

const ADMIN_PASSWORD = "security-api-admin-password";
const TUNNEL_PORT = 20001;
const BANNED_IP = "203.0.113.9";

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

/** 여섯 라우트 전부. 권한 판정 케이스가 이 표 하나를 순회한다. */
const SECURITY_ROUTES: ReadonlyArray<{method: string; target: string; body?: object}> = [
    {method: "GET", target: "/api/security/geo"},
    {method: "PUT", target: "/api/security/geo", body: {mode: "off"}},
    {method: "GET", target: "/api/security/countries"},
    {method: "GET", target: "/api/security/bans"},
    {method: "DELETE", target: `/api/security/bans/${TUNNEL_PORT}/${BANNED_IP}`},
    {method: "GET", target: "/api/security/stats"}
];

const banTwice = (ip: string): void => {
    const controller = AdmissionController.instance;
    controller.configureTunnel({forwardPort: TUNNEL_PORT, rateLimit: {enabled: true, windowMs: 60000, maxConnections: 1, banMs: 600000}});
    controller.admit({kind: "tunnel", port: TUNNEL_PORT, protocol: "tcp"}, ip);
    controller.admit({kind: "tunnel", port: TUNNEL_PORT, protocol: "tcp"}, ip);
};

describe("security-api", () => {
    let testRoot: TestRoot;
    let api: AdminServer | undefined;
    let sink: StubSink;
    let bcryptCostBackup: number;
    let request: (method: string, target: string, body?: object, auth?: Partial<Auth>) => Promise<ApiResponse>;
    let su: Auth;
    let ru: Auth;
    const applied: unknown[] = [];

    const eventsOf = (type: string): AuditEvent[] => sink.events.filter((event) => event.type === type);

    beforeAll(async () => {
        bcryptCostBackup = IdentityStore.bcryptCost;
        IdentityStore.bcryptCost = 4;
        testRoot = await createTestRoot("security-api");
        applyTestRoot(testRoot.rootDir);
        await CertificationStore.instance.load();

        // 이 라우트들이 쓰는 런타임은 applyConnectionSecurity 하나다. 호출 인자를 기록한다.
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

    beforeEach(() => {
        AdmissionController.resetForTest();
    });

    afterAll(async () => {
        IdentityStore.bcryptCost = bcryptCostBackup;
        AuditSinkRegistry.reset();
        AdmissionController.resetForTest();
        try { await api?.close(); } finally { await cleanupTestRoot(testRoot); }
    });

    it("세션이 없으면 여섯 라우트가 모두 401 이다", async () => {
        const statuses = [];
        for(const route of SECURITY_ROUTES) {
            statuses.push((await request(route.method, route.target, route.body)).status);
        }
        expect(statuses).toEqual([401, 401, 401, 401, 401, 401]);
    });

    it("일반 유저는 여섯 라우트가 모두 403 이고 상태가 바뀌지 않는다", async () => {
        banTwice(BANNED_IP);
        const statuses = [];
        for(const route of SECURITY_ROUTES) {
            statuses.push((await request(route.method, route.target, route.body, ru)).status);
        }
        expect(statuses).toEqual([403, 403, 403, 403, 403, 403]);
        expect(applied).toEqual([]);
        expect(AdmissionController.instance.rateLimiter.bans(Date.now())).toHaveLength(1);
        expect(eventsOf("security_geo_updated")).toEqual([]);
        expect(eventsOf("security_ban_removed")).toEqual([]);
    });

    it("슈퍼유저 GET /api/security/geo 는 기본값을 돌려준다", async () => {
        const response = await request("GET", "/api/security/geo", {}, su);
        expect(response.status).toBe(200);
        expect(response.body.geo).toEqual({mode: "off", countries: [], applyToAdmin: true, unknownPolicy: "allow"});
    });

    it("PUT /api/security/geo 는 CSRF 헤더가 없으면 403 이다", async () => {
        const response = await request("PUT", "/api/security/geo", {mode: "allow", countries: ["KR"]}, {Cookie: su.Cookie});
        expect(response.status).toBe(403);
        expect(response.body.message).toBe("Missing CSRF token");
        expect(applied).toEqual([]);
    });

    it("PUT /api/security/geo 가 국가 코드를 정규화해 저장하고 감사를 남긴다", async () => {
        const response = await request("PUT", "/api/security/geo",
            {mode: "allow", countries: ["kr", "us"], unknownPolicy: "deny"}, su);
        expect(response.status).toBe(200);
        expect(response.body.geo).toEqual({mode: "allow", countries: ["KR", "US"], applyToAdmin: true, unknownPolicy: "deny"});
        expect(response.body.warnings).toHaveLength(1);

        expect(applied).toEqual([{geo: {mode: "allow", countries: ["KR", "US"], applyToAdmin: true, unknownPolicy: "deny"}}]);

        const raw = await fs.readFile(path.join(testRoot.rootDir, "config", "server.yaml"), "utf8");
        expect(raw).toContain("connectionSecurity:");
        expect(raw).toContain("mode: allow");
        expect(YAML.parse(raw).connectionSecurity.geo).toEqual({mode: "allow", countries: ["KR", "US"], applyToAdmin: true, unknownPolicy: "deny"});

        const events = eventsOf("security_geo_updated");
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            type: "security_geo_updated", outcome: "success",
            target: {kind: "security", id: "geo"}, summary: "security_geo_updated geo"
        });
        expect(events[0].detail).toEqual({mode: "allow", countries: ["KR", "US"], applyToAdmin: true, unknownPolicy: "deny"});

        const reread = await request("GET", "/api/security/geo", {}, su);
        expect(reread.body.geo).toEqual(response.body.geo);
    });

    it("allow 모드에 국가가 비면 422 이고 실패 감사가 남으며 저장값이 그대로다", async () => {
        const before = eventsOf("security_geo_updated").length;
        const appliedBefore = applied.length;
        const response = await request("PUT", "/api/security/geo", {mode: "allow", countries: []}, su);
        expect(response.status).toBe(422);
        expect(response.body).toMatchObject({success: false, message: "allow mode requires at least one country"});
        expect(response.body).not.toHaveProperty("status");

        const events = eventsOf("security_geo_updated");
        expect(events).toHaveLength(before + 1);
        expect(events[events.length - 1]).toMatchObject({outcome: "failure", summary: "security_geo_updated geo"});
        expect(applied).toHaveLength(appliedBefore);
        expect((await request("GET", "/api/security/geo", {}, su)).body.geo.countries).toEqual(["KR", "US"]);
    });

    it("GET /api/security/countries 는 249개를 name 오름차순으로 돌려준다", async () => {
        const response = await request("GET", "/api/security/countries", {}, su);
        expect(response.status).toBe(200);
        const countries: Array<{code: string; name: string}> = response.body.countries;
        expect(countries).toHaveLength(249);
        expect(new Set(countries.map((country) => country.code)).size).toBe(249);
        expect(countries[0]).toEqual({code: "AF", name: "Afghanistan"});
        expect(countries.find((country) => country.code === "KR")).toEqual({code: "KR", name: "South Korea"});
        for(let i = 1; i < countries.length; i++) {
            expect(countries[i - 1].name.localeCompare(countries[i].name, "en")).toBeLessThanOrEqual(0);
        }
    });

    it("GET /api/security/bans 는 차단 항목을 싣고 DB 미로드면 country 키가 없다", async () => {
        banTwice(BANNED_IP);
        const response = await request("GET", "/api/security/bans", {}, su);
        expect(response.status).toBe(200);
        expect(response.body.bans).toHaveLength(1);
        expect(response.body.bans[0]).toMatchObject({port: TUNNEL_PORT, ip: BANNED_IP, hits: 2});
        expect(response.body.bans[0].bannedUntil).toBeGreaterThan(response.body.serverTime);
        expect(Object.keys(response.body.bans[0])).not.toContain("country");
        expect(AdmissionController.instance.geo.isDatabaseLoaded()).toBe(false);
    });

    it("GET /api/security/bans 는 DB 가 로드되어 있으면 차단 IP 의 국가를 싣는다", async () => {
        const ip = "8.8.8.8";
        AdmissionController.instance.configureGeo({mode: "deny", countries: ["KP"], applyToAdmin: false, unknownPolicy: "allow"});
        banTwice(ip);
        const geoip = require("geoip-lite") as {lookup(ip: string): {country?: string} | null};
        const expected = geoip.lookup(ip)?.country;
        expect(expected).toMatch(/^[A-Z]{2}$/);

        const response = await request("GET", "/api/security/bans", {}, su);
        expect(response.status).toBe(200);
        expect(response.body.bans).toEqual([expect.objectContaining({port: TUNNEL_PORT, ip, country: expected})]);
    });

    it("DELETE /api/security/bans/:port/:ip 가 차단을 지우고 감사를 남긴다", async () => {
        banTwice(BANNED_IP);
        const before = eventsOf("security_ban_removed").length;
        const removed = await request("DELETE", `/api/security/bans/${TUNNEL_PORT}/${BANNED_IP}`, {}, su);
        expect(removed.status).toBe(200);
        expect(removed.body.removed).toBe(true);

        const events = eventsOf("security_ban_removed");
        expect(events).toHaveLength(before + 1);
        expect(events[events.length - 1]).toMatchObject({
            outcome: "success",
            target: {kind: "security", id: `${TUNNEL_PORT}/${BANNED_IP}`},
            summary: `security_ban_removed ${TUNNEL_PORT}/${BANNED_IP}`,
            detail: {port: TUNNEL_PORT, ip: BANNED_IP, removed: true}
        });

        expect((await request("GET", "/api/security/bans", {}, su)).body.bans).toEqual([]);

        const again = await request("DELETE", `/api/security/bans/${TUNNEL_PORT}/${BANNED_IP}`, {}, su);
        expect(again.status).toBe(200);
        expect(again.body.removed).toBe(false);
        expect(eventsOf("security_ban_removed")[before + 1].detail).toEqual({port: TUNNEL_PORT, ip: BANNED_IP, removed: false});
    });

    it("정규화되지 않은 IPv4-mapped 주소로는 차단이 지워지지 않는다", async () => {
        banTwice("::ffff:1.2.3.4");
        const response = await request("DELETE", `/api/security/bans/${TUNNEL_PORT}/%3A%3Affff%3A1.2.3.4`, {}, su);
        expect(response.status).toBe(200);
        expect(response.body.removed).toBe(false);
        expect(AdmissionController.instance.rateLimiter.bans(Date.now()).map((ban) => ban.ip)).toEqual(["1.2.3.4"]);
    });

    it("퍼센트 인코딩된 IPv6 주소는 디코딩해 차단을 지운다", async () => {
        const ip = "2001:db8::1";
        banTwice(ip);
        expect(AdmissionController.instance.rateLimiter.bans(Date.now()).map((ban) => ban.ip)).toEqual([ip]);
        const response = await request("DELETE", `/api/security/bans/${TUNNEL_PORT}/${encodeURIComponent(ip)}`, {}, su);
        expect(response.status).toBe(200);
        expect(response.body.removed).toBe(true);
        expect(AdmissionController.instance.rateLimiter.bans(Date.now())).toEqual([]);
    });

    it("잘못된 퍼센트 인코딩은 500 이 아니라 400 'invalid ip' 다", async () => {
        const response = await request("DELETE", `/api/security/bans/${TUNNEL_PORT}/%E0%A4%A`, {}, su);
        expect(response.status).toBe(400);
        expect(response.body.message).toBe("invalid ip");
    });

    it("설정 커밋이 실패하면 500 이고 런타임에 반영하지 않으며 실패 감사가 남는다", async () => {
        const before = eventsOf("security_geo_updated").length;
        const appliedBefore = applied.length;
        const commit = jest.spyOn(ServerOptionStore.instance, "commitPreparedServerOption")
            .mockReturnValueOnce({success: false, message: "disk full"});
        try {
            const response = await request("PUT", "/api/security/geo", {mode: "deny", countries: ["KP"]}, su);
            expect(response.status).toBe(500);
            expect(response.body).toMatchObject({success: false, message: "Unable to commit server option."});
            expect(commit).toHaveBeenCalledTimes(1);
        } finally {
            commit.mockRestore();
        }
        expect(applied).toHaveLength(appliedBefore);
        const events = eventsOf("security_geo_updated");
        expect(events).toHaveLength(before + 1);
        expect(events[events.length - 1].outcome).toBe("failure");
        expect((await request("GET", "/api/security/geo", {}, su)).body.geo).toEqual(
            {mode: "allow", countries: ["KR", "US"], applyToAdmin: true, unknownPolicy: "deny"});
    });

    it("GET /api/security/stats 가 현재 GeoConfig 와 포트별 집계를 함께 돌려준다", async () => {
        banTwice(BANNED_IP);
        const response = await request("GET", "/api/security/stats", {}, su);
        expect(response.status).toBe(200);
        expect(typeof response.body.serverTime).toBe("number");
        expect(response.body.stats.geo).toEqual({mode: "allow", countries: ["KR", "US"], applyToAdmin: true, unknownPolicy: "deny"});
        expect(response.body.stats.ports[String(TUNNEL_PORT)]).toMatchObject({rejectedExceeded: 1});
        expect(response.body.stats.admin.rejectedGeo).toBe(0);
    });
});
