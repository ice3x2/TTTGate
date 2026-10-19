import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import AdminServer, {AdminServerOptions} from "../../../../src/server/admin/AdminServer";
import {IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {applyTestRoot, cleanupTestRoot, createTestRoot} from "../../../helpers/runtime";
import {httpRequest} from "../../../helpers/http";

jest.setTimeout(120_000);

const PASSWORD = "authz-latency-pw-1";

type Fixture = {
    request: (method: string, target: string, body?: object, headers?: Record<string, string>) => Promise<{status: number; headers: any; body: any}>;
    cookie: string;
};

/**
 * 슈퍼유저 세션을 가진 AdminServer 를 띄우고 fixture 를 넘긴다.
 * options 는 AdminServer 생성자의 4번째 인자로 그대로 전달한다.
 */
const withAuthorizedServer = async (
    options: AdminServerOptions | undefined,
    check: (fixture: Fixture) => Promise<void>
): Promise<void> => {
    const root = await createTestRoot("authz-latency");
    let api: AdminServer | undefined;
    try {
        applyTestRoot(root.rootDir);
        await fs.writeFile(path.join(root.rootDir, "config", ".key"), await bcrypt.hash(PASSWORD, 4), "utf-8");
        await IdentityMigration.runAtStartup();
        api = options === undefined
            ? new AdminServer(undefined as any, false)
            : new AdminServer(undefined as any, false, undefined, options);
        const port = await api.listen(0, "127.0.0.1");

        const request = async (method: string, target: string, body: object = {}, headers: Record<string, string> = {}) => {
            const bytes = JSON.stringify(body);
            const response = await httpRequest({
                port, path: target, method,
                headers: {"Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bytes)), ...headers},
                body: bytes
            });
            let parsedBody: any;
            try {
                parsedBody = JSON.parse(response.body);
            } catch {
                parsedBody = response.body;
            }
            return {status: response.statusCode, headers: response.headers, body: parsedBody};
        };

        const login = await request("POST", "/api/login", {username: "admin", password: PASSWORD});
        expect(login.status).toBe(200);
        const cookies = login.headers["set-cookie"];
        if(!cookies) throw new Error("login set no cookie");
        const cookie = cookies.map((value) => value.split(";")[0]).join("; ");

        await check({request, cookie});
    } finally {
        try { await api?.close(); } finally { await cleanupTestRoot(root); }
    }
};

describe("authorize 지연 (NFR-PERF-PERMCHECK-001)", () => {
    let bcryptCostBackup: number;

    beforeAll(() => {
        bcryptCostBackup = IdentityStore.bcryptCost;
        IdentityStore.bcryptCost = 4;
    });

    afterAll(() => {
        IdentityStore.bcryptCost = bcryptCostBackup;
    });

    it("exposeAuthzTiming 을 켜면 X-Authz-Us 의 p95 가 2000µs 이하다", async () => {
        await withAuthorizedServer({exposeAuthzTiming: true}, async ({request, cookie}) => {
            const samples: number[] = [];
            for(let i = 0; i < 1_000; i++) {
                const response = await request("GET", "/api/tunnelingOption", {}, {Cookie: cookie});
                expect(response.status).toBe(200);
                const header = response.headers["x-authz-us"];
                expect(typeof header).toBe("string");
                expect(header).toMatch(/^\d+$/);
                samples.push(Number(header));
            }
            samples.sort((left, right) => left - right);
            const p95 = samples[Math.floor(samples.length * 0.95)];
            expect(p95).toBeLessThanOrEqual(2_000);
        });
    });

    it("권한이 거부된 응답에는 X-Authz-Us 를 붙이지 않는다", async () => {
        await withAuthorizedServer({exposeAuthzTiming: true}, async ({request, cookie}) => {
            const created = await IdentityStore.instance.createUser({
                username: "heidi", password: "heidi-password-1", role: "regular", mustChangePassword: false
            });
            expect(created.success).toBe(true);

            const login = await request("POST", "/api/login", {username: "heidi", password: "heidi-password-1"});
            expect(login.status).toBe(200);
            const regularCookie = (login.headers["set-cookie"] as string[]).map((value) => value.split(";")[0]).join("; ");

            const denied = await request("GET", "/api/serverOption", {}, {Cookie: regularCookie});
            expect(denied.status).toBe(403);
            expect(denied.headers["x-authz-us"]).toBeUndefined();

            const allowed = await request("GET", "/api/serverOption", {}, {Cookie: cookie});
            expect(allowed.status).toBe(200);
            expect(typeof allowed.headers["x-authz-us"]).toBe("string");
        });
    });

    it("옵션 없이 띄우면 환경변수를 무엇으로 두어도 X-Authz-Us 가 없다", async () => {
        const backup = {...process.env};
        process.env.EXPOSE_AUTHZ_TIMING = "1";
        process.env.TTTGATE_EXPOSE_AUTHZ_TIMING = "true";
        process.env.X_AUTHZ_US = "on";
        try {
            await withAuthorizedServer(undefined, async ({request, cookie}) => {
                const response = await request("GET", "/api/tunnelingOption", {}, {Cookie: cookie});
                expect(response.status).toBe(200);
                expect(response.headers["x-authz-us"]).toBeUndefined();
            });
            await withAuthorizedServer({}, async ({request, cookie}) => {
                const response = await request("GET", "/api/tunnelingOption", {}, {Cookie: cookie});
                expect(response.status).toBe(200);
                expect(response.headers["x-authz-us"]).toBeUndefined();
            });
        } finally {
            process.env = backup;
        }
    });
});
