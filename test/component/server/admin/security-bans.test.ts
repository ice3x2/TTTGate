import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import {BOOTSTRAP_TOKEN_FILE_NAME, IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {AdmissionController} from "../../../../src/server/security/AdmissionController";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {createTestRoot, applyTestRoot, cleanupTestRoot} from "../../../helpers/runtime";

jest.setTimeout(30_000);

const withBansServer = async (check: (fixture: any) => Promise<void>) => {
    const root = await createTestRoot("security-bans");
    let api: AdminServer | undefined;
    const bcryptCostBackup = IdentityStore.bcryptCost;
    IdentityStore.bcryptCost = 4;
    try {
        applyTestRoot(root.rootDir);
        AdmissionController.resetForTest();
        await CertificationStore.instance.load();
        await IdentityMigration.runAtStartup();
        const token = (await fs.readFile(path.join(root.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();
        // security/bans 라우트는 터널 런타임을 쓰지 않는다.
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
            const response = await request("POST", "/api/login", {username: "admin", password: "bans-password", bootstrapToken: token});
            expect(response.status).toBe(200);
            const cookies: string[] = response.headers["set-cookie"];
            return {Cookie: cookies.map((value: string) => value.split(";")[0]).join("; "),
                "X-CSRF-Token": cookies.find((value: string) => value.startsWith("csrfToken="))!.split(";")[0].slice("csrfToken=".length)};
        };
        const authOf = (response: any) => {
            const cookies: string[] = response.headers["set-cookie"];
            return {Cookie: cookies.map((value: string) => value.split(";")[0]).join("; "),
                "X-CSRF-Token": cookies.find((value: string) => value.startsWith("csrfToken="))!.split(";")[0].slice("csrfToken=".length)};
        };
        // #120 (U5-05): 일반 유저 세션. 슈퍼유저가 그룹과 사용자를 만들고, 임시 비밀번호를 바꾼 세션을 돌려준다.
        const loginRegular = async () => {
            const superuser = await login();
            const group = await request("POST", "/api/groups", {name: "Operators"}, superuser);
            expect(group.status).toBe(201);
            const created = await request("POST", "/api/users",
                {username: "regular", role: "regular", groupId: JSON.parse(group.body).group.id}, superuser);
            expect(created.status).toBe(201);
            const temporaryPassword = JSON.parse(created.body).temporaryPassword;
            const first = await request("POST", "/api/login", {username: "regular", password: temporaryPassword});
            expect(first.status).toBe(200);
            const auth = authOf(first);
            const changed = await request("PUT", "/api/me/password",
                {currentPassword: temporaryPassword, newPassword: "regular-next-password"}, auth);
            expect(changed.status).toBe(200);
            return auth;
        };
        await check({port, request, login, loginRegular});
    } finally {
        IdentityStore.bcryptCost = bcryptCostBackup;
        try { await api?.close(); } finally { await cleanupTestRoot(root); }
    }
};

describe("AdminServer security bans routes", () => {
    it("requires a session for GET and DELETE", async () => withBansServer(async f => {
        const getResponse = await f.request("GET", "/api/security/bans");
        expect(getResponse.status).toBe(401);
        const deleteResponse = await f.request("DELETE", "/api/security/bans/1/1.1.1.1");
        expect(deleteResponse.status).toBe(401);
    }));

    it("returns an empty ban list with a serverTime to a superuser", async () => withBansServer(async f => {
        const headers = await f.login();
        const response = await f.request("GET", "/api/security/bans", {}, headers);
        expect(response.status).toBe(200);
        const json = JSON.parse(response.body);
        expect(json.bans).toEqual([]);
        expect(typeof json.serverTime).toBe("number");
    }));

    it("rejects a regular user with 403 for GET and DELETE and keeps the ban", async () => withBansServer(async f => {
        const headers = await f.loginRegular();
        AdmissionController.instance.configureTunnel({forwardPort: 20001, rateLimit: {enabled: true, windowMs: 60000, maxConnections: 1, banMs: 600000}});
        AdmissionController.instance.admit({kind: "tunnel", port: 20001, protocol: "tcp"}, "203.0.113.9");
        AdmissionController.instance.admit({kind: "tunnel", port: 20001, protocol: "tcp"}, "203.0.113.9");

        const listed = await f.request("GET", "/api/security/bans", {}, headers);
        expect(listed.status).toBe(403);
        expect(JSON.parse(listed.body)).not.toHaveProperty("bans");
        const removed = await f.request("DELETE", "/api/security/bans/20001/203.0.113.9", {}, headers);
        expect(removed.status).toBe(403);
        expect(AdmissionController.instance.rateLimiter.bans(Date.now())).toHaveLength(1);
    }));

    it("lists a ban created via the admission controller and removes it on DELETE", async () => withBansServer(async f => {
        const headers = await f.login();
        AdmissionController.instance.configureTunnel({forwardPort: 20001, rateLimit: {enabled: true, windowMs: 60000, maxConnections: 1, banMs: 600000}});
        AdmissionController.instance.admit({kind: "tunnel", port: 20001, protocol: "tcp"}, "203.0.113.9");
        AdmissionController.instance.admit({kind: "tunnel", port: 20001, protocol: "tcp"}, "203.0.113.9");

        const listed = await f.request("GET", "/api/security/bans", {}, headers);
        expect(listed.status).toBe(200);
        const listedJson = JSON.parse(listed.body);
        expect(listedJson.bans[0]).toMatchObject({port: 20001, ip: "203.0.113.9", hits: 2});
        expect(listedJson.bans[0].bannedUntil).toBeGreaterThan(listedJson.serverTime);

        const removed = await f.request("DELETE", "/api/security/bans/20001/203.0.113.9", {}, headers);
        expect(removed.status).toBe(200);
        expect(JSON.parse(removed.body).removed).toBe(true);

        const afterDelete = await f.request("GET", "/api/security/bans", {}, headers);
        expect(JSON.parse(afterDelete.body).bans).toEqual([]);

        const removedAgain = await f.request("DELETE", "/api/security/bans/20001/203.0.113.9", {}, headers);
        expect(JSON.parse(removedAgain.body).removed).toBe(false);
    }));

    it("requires CSRF for DELETE and rejects an invalid port", async () => withBansServer(async f => {
        const headers = await f.login();
        const noCsrf = await f.request("DELETE", "/api/security/bans/20001/1.1.1.1", {}, {Cookie: headers.Cookie});
        expect(noCsrf.status).toBe(403);

        const invalidPort = await f.request("DELETE", "/api/security/bans/70000/1.1.1.1", {}, headers);
        expect(invalidPort.status).toBe(400);
    }));
});
