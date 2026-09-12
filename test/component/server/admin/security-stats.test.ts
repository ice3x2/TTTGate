import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import {BOOTSTRAP_TOKEN_FILE_NAME, IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {AdmissionController} from "../../../../src/server/security/AdmissionController";
import {createTestRoot, applyTestRoot, cleanupTestRoot} from "../../../helpers/runtime";

jest.setTimeout(30_000);

const withStatsServer = async (check: (fixture: any) => Promise<void>) => {
    const root = await createTestRoot("security-stats");
    let api: AdminServer | undefined;
    try {
        applyTestRoot(root.rootDir);
        AdmissionController.resetForTest();
        await CertificationStore.instance.load();
        await IdentityMigration.runAtStartup();
        const token = (await fs.readFile(path.join(root.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();
        // security/stats 라우트는 세션 검사만 하고 터널 런타임을 쓰지 않는다.
        api = new AdminServer(undefined as any, false);
        const port = await api.listen(0, "127.0.0.1");
        const request = (method: string, target: string, body: object = {}, headers: Record<string, string> = {}) => new Promise<any>((resolve, reject) => {
            const bytes = JSON.stringify(body);
            const req = http.request({host: "127.0.0.1", port, method, path: target,
                headers: {"Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bytes)), ...headers}}, res => {
                const data: Buffer[] = [];
                res.on("data", chunk => data.push(Buffer.from(chunk)));
                res.once("error", reject);
                res.once("end", () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(data).toString()}));
            });
            req.once("error", reject);
            req.setTimeout(700, () => req.destroy(new Error("owned HTTP route did not respond")));
            req.end(bytes);
        });
        const login = async () => {
            const response = await request("POST", "/api/login", {key: "stats-password", bootstrapToken: token});
            expect(response.status).toBe(200);
            const cookies: string[] = response.headers["set-cookie"];
            return {Cookie: cookies.map((value: string) => value.split(";")[0]).join("; "),
                "X-CSRF-Token": cookies.find((value: string) => value.startsWith("csrfToken="))!.split(";")[0].slice("csrfToken=".length)};
        };
        await check({port, request, login});
    } finally {
        try { await api?.close(); } finally { await cleanupTestRoot(root); }
    }
};

describe("AdminServer security stats route", () => {
    it("requires a session", async () => withStatsServer(async f => {
        const response = await f.request("GET", "/api/security/stats");
        expect(response.status).toBe(401);
    }));

    it("returns an empty tally with a serverTime once authenticated", async () => withStatsServer(async f => {
        const headers = await f.login();
        const response = await f.request("GET", "/api/security/stats", {}, headers);
        expect(response.status).toBe(200);
        const json = JSON.parse(response.body);
        expect(json).toMatchObject({success: true, stats: {ports: {}, admin: {rejectedGeo: 0}}});
        expect(typeof json.serverTime).toBe("number");
    }));

    it("reports a rate limit rejection raised through the admission controller", async () => withStatsServer(async f => {
        const headers = await f.login();
        AdmissionController.instance.configureTunnel({forwardPort: 20001, rateLimit: {enabled: true, windowMs: 1000, maxConnections: 1, banMs: 1000}});
        AdmissionController.instance.admit({kind: "tunnel", port: 20001, protocol: "tcp"}, "203.0.113.9");
        AdmissionController.instance.admit({kind: "tunnel", port: 20001, protocol: "tcp"}, "203.0.113.9");

        const response = await f.request("GET", "/api/security/stats", {}, headers);
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body).stats.ports["20001"].rejectedExceeded).toBe(1);
    }));

    it("is not cacheable", async () => withStatsServer(async f => {
        const headers = await f.login();
        const response = await f.request("GET", "/api/security/stats", {}, headers);
        expect(response.headers["cache-control"]).toBe("no-cache, no-store, must-revalidate");
    }));
});
