import fs from "node:fs/promises";
import nodeFs from "node:fs";
import path from "node:path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import SessionStore from "../../../../src/server/admin/SessionStore";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import TTTServer from "../../../../src/server/TTTServer";
import Environment from "../../../../src/Environment";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {BOOTSTRAP_TOKEN_FILE_NAME, IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {FileAuditSink} from "../../../../src/server/audit/FileAuditSink";
import {getFreePort} from "../../../helpers/network";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot} from "../../../helpers/runtime";

jest.setTimeout(120_000);

const ADMIN_PASSWORD = "audit-file-password";

type ApiResponse = {status: number; headers: any; body: any};
type Auth = {Cookie: string; "X-CSRF-Token": string};
type LoginResult = ApiResponse & {auth?: Auth; sessionKey?: string};

type Fixture = {
    auditDir: string;
    sink: FileAuditSink;
    admin: {auth: Auth; sessionKey: string; userId: string};
    request: (method: string, target: string, body?: object, headers?: Record<string, string>) => Promise<ApiResponse>;
    login: (body: object) => Promise<LoginResult>;
    /** 기록된 모든 감사 파일의 줄을 날짜순으로 이어 붙여 읽는다(자정 경계에서도 순서가 보존된다). */
    readLines: () => any[];
};

const authOf = (response: ApiResponse): {auth: Auth; sessionKey: string} => {
    const cookies: string[] = response.headers["set-cookie"];
    const pairs = cookies.map((value: string) => value.split(";")[0]);
    return {
        auth: {
            Cookie: pairs.join("; "),
            "X-CSRF-Token": pairs.find((value: string) => value.startsWith("csrfToken="))!.slice("csrfToken=".length)
        },
        sessionKey: pairs.find((value: string) => value.startsWith("sessionKey="))!.slice("sessionKey=".length)
    };
};

/** 실제 AdminServer + 실제 FileAuditSink. 싱크는 부트스트랩 로그인보다 먼저 등록해 login_success 도 파일에 남게 한다. */
const withAuditFileServer = async (check: (fixture: Fixture) => Promise<void>): Promise<void> => {
    const root = await createTestRoot("audit-file");
    let api: AdminServer | undefined;
    let tunnel: TTTServer | undefined;
    let sink: FileAuditSink | undefined;
    try {
        applyTestRoot(root.rootDir);
        await CertificationStore.instance.load();
        const store = ServerOptionStore.instance;
        if(!store.updateServerOption({...store.serverOption, port: await getFreePort(),
            adminBindHost: "127.0.0.1", adminTls: false, tls: false, keepAlive: 0, tunnelingOptions: []})) {
            throw new Error("audit-file fixture: invalid server option");
        }
        tunnel = TTTServer.create(store.serverOption);
        await tunnel.start();
        api = new AdminServer(tunnel, false);
        const port = await api.listen(0, "127.0.0.1");
        await IdentityMigration.runAtStartup();
        const bootstrapToken = (await fs.readFile(path.join(root.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();

        const request = async (method: string, target: string, body: object = {}, headers: Record<string, string> = {}): Promise<ApiResponse> => {
            const bytes = JSON.stringify(body);
            const response = await httpRequest({
                port, path: target, method,
                headers: {"Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bytes)), ...headers},
                body: bytes
            });
            let parsed: any;
            try { parsed = JSON.parse(response.body); } catch { parsed = response.body; }
            return {status: response.statusCode, headers: response.headers, body: parsed};
        };

        const login = async (body: object): Promise<LoginResult> => {
            const response = await request("POST", "/api/login", body);
            if(response.status !== 200) return response;
            return {...response, ...authOf(response)};
        };

        const auditDir = path.join(Environment.path.logDir, "audit");
        sink = new FileAuditSink({dir: auditDir, queueSize: 1000, retentionDays: 0});
        AuditSinkRegistry.set(sink);

        const readLines = (): any[] => nodeFs.readdirSync(auditDir)
            .filter((name) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
            .sort()
            .flatMap((name) => nodeFs.readFileSync(path.join(auditDir, name), "utf8")
                .split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line)));

        const bootstrap = await login({username: "admin", password: ADMIN_PASSWORD, bootstrapToken});
        if(bootstrap.status !== 200) throw new Error(`audit-file fixture bootstrap failed: ${JSON.stringify(bootstrap.body)}`);

        await check({
            auditDir, sink,
            admin: {auth: bootstrap.auth!, sessionKey: bootstrap.sessionKey!, userId: bootstrap.body.user.id},
            request, login, readLines
        });
    } finally {
        // 배압 스텁으로 바꿔 둔 싱크는 flush 가 끝나지 않으므로 닫지 않는다(타이머도 걸지 않았다).
        try { if(AuditSinkRegistry.current() === sink) await sink?.close(); }
        finally {
            try { await api?.close(); }
            finally {
                try { await tunnel?.close(); }
                finally { await cleanupTestRoot(root); }
            }
        }
    }
};

describe("audit-file: 실제 FileAuditSink 가 관리 API 호출을 파일에 남긴다", () => {
    let bcryptCostBackup: number;
    beforeAll(() => { bcryptCostBackup = IdentityStore.bcryptCost; IdentityStore.bcryptCost = 4; });
    afterAll(() => { IdentityStore.bcryptCost = bcryptCostBackup; });

    it("로그인·그룹 생성·그룹 삭제가 기록 순서대로 한 줄씩 남는다", async () => withAuditFileServer(async (f) => {
        const created = await f.request("POST", "/api/groups", {name: "audit-file-team"}, f.admin.auth);
        expect(created.status).toBe(201);
        const groupId = created.body.group.id;

        const deleted = await f.request("DELETE", `/api/groups/${groupId}`, {}, f.admin.auth);
        expect(deleted.status).toBe(200);

        await f.sink.flush();
        const lines = f.readLines();
        expect(lines.map((line) => line.type)).toEqual(["login_success", "group_created", "group_deleted"]);

        const sessionIdHash = SessionStore.sessionIdOf(f.admin.sessionKey);
        lines.forEach((line) => {
            expect(line.actor.username).toBe("admin");
            expect(["127.0.0.1", "::1"]).toContain(line.ip);
            expect(line.sessionIdHash).toBe(sessionIdHash);
        });
    }));

    it("로그인 실패가 입력한 username 만 남기고 비밀번호는 남기지 않는다", async () => withAuditFileServer(async (f) => {
        const failed = await f.login({username: "admin", password: "definitely-wrong-password"});
        expect(failed.status).toBe(401);

        await f.sink.flush();
        const failure = f.readLines().find((line) => line.type === "login_failure");
        expect(failure).toBeDefined();
        expect(failure.detail.username).toBe("admin");
        expect(failure.detail).not.toHaveProperty("password");
        expect(failure.actor).toEqual({userId: "system"});
    }));

    it("큐가 가득 차면 101 번째 CUD 가 503 audit_unavailable 로 실패하고 그룹을 만들지 않는다", async () => withAuditFileServer(async (f) => {
        // 쓰기가 끝나지 않는 스트림 스텁 — 100 건 전부가 큐에 남아 경계가 정확히 101 번째에 걸린다.
        const stalled = {
            write: (): boolean => false,
            once: (): any => stalled,
            on: (): any => stalled,
            end: (cb?: () => void): any => { cb?.(); return stalled; }
        };
        const blocked = new FileAuditSink({
            dir: path.join(f.auditDir, "blocked"), queueSize: 100, retentionDays: 0, openStream: () => stalled as any
        });
        AuditSinkRegistry.set(blocked);

        for(let index = 0; index < 100; index += 1) {
            const response = await f.request("POST", "/api/groups", {name: `audit-file-full-${index}`}, f.admin.auth);
            expect([200, 201, 409]).toContain(response.status);
        }
        expect(blocked.queueLength).toBe(100);

        const before = await f.request("GET", "/api/groups", {}, f.admin.auth);
        const rejected = await f.request("POST", "/api/groups", {name: "audit-file-full-overflow"}, f.admin.auth);
        expect(rejected.status).toBe(503);
        expect(rejected.body).toMatchObject({success: false, code: "audit_unavailable"});

        const after = await f.request("GET", "/api/groups", {}, f.admin.auth);
        expect(after.body.groups.length).toBe(before.body.groups.length);
        expect(after.body.groups.some((group: any) => group.name === "audit-file-full-overflow")).toBe(false);
    }));
});
