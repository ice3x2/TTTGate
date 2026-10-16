import fs from "node:fs/promises";
import nodeFs from "node:fs";
import path from "node:path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import Environment from "../../../../src/Environment";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {BOOTSTRAP_TOKEN_FILE_NAME, IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {FileAuditSink} from "../../../../src/server/audit/FileAuditSink";
import {AUDIT_EVENT_TYPE_LIST} from "../../../../src/server/audit/AuditEventTypes";
import {getFreePort} from "../../../helpers/network";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

// U4-02 / #110 — 실제 AdminServer + 실제 FileAuditSink 로 감사 조회 API 를 확인한다.
jest.setTimeout(60_000);

const ADMIN_PASSWORD = "audit-api-admin-password";

type ApiResponse = {status: number; headers: any; body: any};
type Auth = {Cookie: string; "X-CSRF-Token": string};

const authOf = (response: ApiResponse): Auth => {
    const pairs = (response.headers["set-cookie"] as string[]).map((value) => value.split(";")[0]);
    return {
        Cookie: pairs.join("; "),
        "X-CSRF-Token": pairs.find((value) => value.startsWith("csrfToken="))!.slice("csrfToken=".length)
    };
};

describe("audit-api", () => {
    let testRoot: TestRoot;
    let api: AdminServer | undefined;
    let sink: FileAuditSink;
    let auditDir: string;
    let bcryptCostBackup: number;
    let request: (method: string, target: string, body?: object, auth?: Partial<Auth>) => Promise<ApiResponse>;
    let admin: {auth: Auth; id: string};
    let alice: {auth: Auth; id: string};

    const flushed = async (): Promise<void> => {
        await (AuditSinkRegistry.current() as FileAuditSink).flush();
    };

    const lineCount = (): number => nodeFs.readdirSync(auditDir)
        .filter((name) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
        .reduce((sum, name) => sum + nodeFs.readFileSync(path.join(auditDir, name), "utf8").split("\n").filter((line) => line.length > 0).length, 0);

    beforeAll(async () => {
        bcryptCostBackup = IdentityStore.bcryptCost;
        IdentityStore.bcryptCost = 4;
        testRoot = await createTestRoot("audit-api");
        applyTestRoot(testRoot.rootDir);
        await CertificationStore.instance.load();
        const store = ServerOptionStore.instance;
        if(!store.updateServerOption({...store.serverOption, port: await getFreePort(),
            adminBindHost: "127.0.0.1", adminTls: false, tls: false, keepAlive: 0, tunnelingOptions: []})) {
            throw new Error("audit-api fixture: invalid server option");
        }
        api = new AdminServer(undefined as any, false);
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

        auditDir = path.join(Environment.path.logDir, "audit");
        sink = new FileAuditSink({dir: auditDir, queueSize: 1000, retentionDays: 0});
        AuditSinkRegistry.set(sink);

        await IdentityMigration.runAtStartup();
        const token = (await fs.readFile(path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();
        const bootstrap = await request("POST", "/api/login", {username: "admin", password: ADMIN_PASSWORD, bootstrapToken: token});
        expect(bootstrap.status).toBe(200);
        admin = {auth: authOf(bootstrap), id: bootstrap.body.user.id};

        // 그룹 생성·수정·삭제, 사용자 alice 생성.
        const created = await request("POST", "/api/groups", {name: "Audit team"}, admin.auth);
        expect(created.status).toBe(201);
        const groupId = created.body.group.id;
        expect((await request("PUT", `/api/groups/${groupId}`, {name: "Audit team 2"}, admin.auth)).status).toBe(200);
        expect((await request("DELETE", `/api/groups/${groupId}`, {}, admin.auth)).status).toBe(200);
        const user = await request("POST", "/api/users", {username: "alice", role: "regular"}, admin.auth);
        expect(user.status).toBe(201);

        const first = await request("POST", "/api/login", {username: "alice", password: user.body.temporaryPassword});
        expect(first.status).toBe(200);
        alice = {auth: authOf(first), id: user.body.user.id};
        const changed = await request("PUT", "/api/me/password",
            {currentPassword: user.body.temporaryPassword, newPassword: "alice-next-password"}, alice.auth);
        expect(changed.status).toBe(200);
        await flushed();
    });

    afterAll(async () => {
        IdentityStore.bcryptCost = bcryptCostBackup;
        try { if(AuditSinkRegistry.current() === sink) await sink.close(); }
        finally {
            AuditSinkRegistry.reset();
            try { await api?.close(); } finally { await cleanupTestRoot(testRoot); }
        }
    });

    it("슈퍼유저는 모든 이벤트를 최신순으로 받는다", async () => {
        const response = await request("GET", "/api/audit?limit=100", {}, admin.auth);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({success: true, partial: false, failedScopes: [], warnings: [], message: ""});
        const adminTypes = (response.body.events as any[])
            .filter((event) => event.actor.userId === admin.id)
            .map((event) => event.type)
            .filter((type) => type !== "temp_password_issued");
        expect(adminTypes).toEqual(["user_created", "group_deleted", "group_updated", "group_created", "login_success"]);
        const ats = (response.body.events as any[]).map((event) => event.at);
        expect(ats).toEqual([...ats].sort((a, b) => b - a));
        expect((response.body.events as any[]).some((event) => event.actor.userId === alice.id)).toBe(true);
        expect(response.body).not.toHaveProperty("nextCursor");
    });

    it("type 필터는 그 타입만 돌려준다", async () => {
        const response = await request("GET", "/api/audit?type=group_created", {}, admin.auth);
        expect(response.status).toBe(200);
        expect(response.body.events).toHaveLength(1);
        expect(response.body.events[0]).toMatchObject({type: "group_created", outcome: "success"});
    });

    it("limit 과 cursor 로 페이지를 넘긴다", async () => {
        const all = (await request("GET", "/api/audit?limit=100", {}, admin.auth)).body.events as any[];
        const first = await request("GET", "/api/audit?limit=2", {}, admin.auth);
        expect(first.body.events).toEqual(all.slice(0, 2));
        expect(typeof first.body.nextCursor).toBe("string");
        const second = await request("GET", `/api/audit?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`, {}, admin.auth);
        expect(second.body.events).toEqual(all.slice(2, 4));
    });

    it("일반 유저는 자기 이벤트만 받고 userId 쿼리는 무시된다", async () => {
        const own = await request("GET", "/api/audit", {}, alice.auth);
        expect(own.status).toBe(200);
        const events = own.body.events as any[];
        expect(events.length).toBeGreaterThan(0);
        expect(events.every((event) => event.actor.userId === alice.id)).toBe(true);
        expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["password_changed", "login_success"]));

        const spoofed = await request("GET", `/api/audit?userId=${admin.id}`, {}, alice.auth);
        expect(spoofed.status).toBe(200);
        expect(spoofed.body.events).toEqual(events);

        const types = await request("GET", "/api/audit/types", {}, alice.auth);
        expect(types.status).toBe(200);
    });

    it("password_changed 의 detail 에 비밀번호 평문이 없다", async () => {
        const response = await request("GET", "/api/audit?type=password_changed", {}, admin.auth);
        expect(response.body.events).toHaveLength(1);
        const detail = response.body.events[0].detail ?? {};
        for(const key of ["currentPassword", "newPassword"]) {
            if(key in detail) expect(detail[key]).toBe("[REDACTED]");
        }
        expect(JSON.stringify(response.body.events[0])).not.toContain("alice-next-password");
    });

    it.each([
        ["limit=501", "limit must be an integer within 1..500"],
        ["limit=0", "limit must be an integer within 1..500"],
        ["limit=1.5", "limit must be an integer within 1..500"],
        ["from=abc", "from and to must be epoch milliseconds"],
        ["to=1e3x", "from and to must be epoch milliseconds"],
        ["to=9000000000000000", "from and to must be epoch milliseconds"],
        ["from=2000&to=1000", "from must not exceed to"],
        ["type=nope", "unknown audit type"],
        ["outcome=maybe", "outcome must be success or failure"],
        ["targetKind=planet", "unknown target kind"],
        ["cursor=zzz", "invalid cursor"],
    ])("?%s 는 422 '%s' 다", async (query, message) => {
        const response = await request("GET", `/api/audit?${query}`, {}, admin.auth);
        expect(response.status).toBe(422);
        expect(response.body).toMatchObject({success: false, status: 422, message});
    });

    it("GET /api/audit/types 는 AUDIT_EVENT_TYPE_LIST 를 돌려준다", async () => {
        const response = await request("GET", "/api/audit/types", {}, admin.auth);
        expect(response.status).toBe(200);
        expect(response.body.types).toEqual([...AUDIT_EVENT_TYPE_LIST]);
    });

    it("세션이 없으면 401 이다", async () => {
        expect((await request("GET", "/api/audit")).status).toBe(401);
        expect((await request("GET", "/api/audit/types")).status).toBe(401);
    });

    it("조회는 감사하지 않는다", async () => {
        await flushed();
        const before = lineCount();
        for(let i = 0; i < 10; i++) {
            expect((await request("GET", "/api/audit?limit=5", {}, admin.auth)).status).toBe(200);
        }
        await flushed();
        expect(lineCount()).toBe(before);
    });
});
