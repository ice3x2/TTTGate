import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from "../../../../src/server/admin/SessionStore";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {AdmissionController} from "../../../../src/server/security/AdmissionController";
import {createTestRoot, applyTestRoot, cleanupTestRoot} from "../../../helpers/runtime";

jest.setTimeout(30_000);

const withBansServer = async (check: (fixture: any) => Promise<void>) => {
    const root = await createTestRoot("security-bans");
    let api: AdminServer | undefined;
    try {
        applyTestRoot(root.rootDir);
        AdmissionController.resetForTest();
        await CertificationStore.instance.load();
        SessionStore.instance;
        const token = (await fs.readFile(path.join(root.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();
        // security/bans 라우트는 세션 검사만 하고 터널 런타임을 쓰지 않는다.
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
            const response = await request("POST", "/api/login", {key: "bans-password", bootstrapToken: token});
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

describe("AdminServer security bans routes", () => {
    it("requires a session for GET and DELETE", async () => withBansServer(async f => {
        const getResponse = await f.request("GET", "/api/security/bans");
        expect(getResponse.status).toBe(401);
        const deleteResponse = await f.request("DELETE", "/api/security/bans/1/1.1.1.1");
        expect(deleteResponse.status).toBe(401);
    }));

    it("returns an empty ban list with a serverTime once authenticated", async () => withBansServer(async f => {
        const headers = await f.login();
        const response = await f.request("GET", "/api/security/bans", {}, headers);
        expect(response.status).toBe(200);
        const json = JSON.parse(response.body);
        expect(json.bans).toEqual([]);
        expect(typeof json.serverTime).toBe("number");
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
