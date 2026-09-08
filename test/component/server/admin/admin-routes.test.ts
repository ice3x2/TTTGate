import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from "../../../../src/server/admin/SessionStore";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {createTestRoot, applyTestRoot, cleanupTestRoot} from "../../../helpers/runtime";

const withRoutes = async (check: (fixture: any) => Promise<void>) => {
    const root = await createTestRoot("admin-routes38");
    let api: AdminServer | undefined;
    try {
        applyTestRoot(root.rootDir);
        await CertificationStore.instance.load();
        SessionStore.instance;
        const token = (await fs.readFile(path.join(root.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();
        // These routes use no tunnel runtime; the actual AdminServer/HTTP guards run.
        api = new AdminServer(undefined as any, false);
        const port = await api.listen(0, "127.0.0.1");
        const seen: string[] = [];
        (api as any)._server.on("request", (req: http.IncomingMessage) => seen.push(req.url!));
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
            const response = await request("POST", "/api/login", {key: "routes-password", bootstrapToken: token});
            expect(response.status).toBe(200);
            const cookies: string[] = response.headers["set-cookie"];
            return {Cookie: cookies.map(value => value.split(";")[0]).join("; "),
                "X-CSRF-Token": cookies.find(value => value.startsWith("csrfToken="))!.split(";")[0].slice("csrfToken=".length)};
        };
        await check({port, token, request, login, seen});
    } finally {
        try { await api?.close(); } finally { await cleanupTestRoot(root); }
    }
};

test.each(["POST", "PUT", "DELETE"])("unmatched %s completes with 404 after valid security admission", async method => withRoutes(async f => {
    const headers = await f.login();
    const response = await f.request(method, "/api/absent?reason=route", {}, headers);
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body).success).toBe(false);
}), 15_000);

test("query login shares its exact pathname with the Origin/CSRF exception and keeps raw query", async () => withRoutes(async f => {
    const target = "/api/login?return=%2F&value=1+2";
    const body = {key: "routes-password", bootstrapToken: f.token};
    expect((await f.request("POST", target, body, {Origin: "https://evil.example"})).status).toBe(403);
    const result = await f.request("POST", target, body, {Origin: `http://127.0.0.1:${f.port}`});
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).success).toBe(true);
    expect(f.seen).toEqual([target, target]);
}), 15_000);

test("query-bearing known routes preserve CSRF/auth rejection and numeric prefix policy", async () => withRoutes(async f => {
    const browser = {Origin: `http://127.0.0.1:${f.port}`};
    expect((await f.request("POST", "/api/serverOption?next=/api/login", {}, browser)).status).toBe(403);
    expect((await f.request("POST", "/api/login/other?next=/api/login", {}, browser)).status).toBe(403);
    expect((await f.request("GET", "/api/serverOption?x=1")).status).toBe(401);
    const headers = await f.login();
    expect((await f.request("POST", "/api/serverOption?next=/api/login", {}, {Cookie: headers.Cookie, ...browser})).status).toBe(403);
    expect((await f.request("POST", "/api/serverOption?x=1", {}, {...headers, "X-CSRF-Token": "mismatch", ...browser})).status).toBe(403);
    expect((await f.request("POST", "/api/absent?x=1", {}, {...headers, Origin: "https://evil.example"})).status).toBe(403);
    for(const method of ["POST", "PUT", "DELETE"]) {
        const endpoint = method === "DELETE" ? "/api/tunnelingOption" : "/api/serverOption";
        expect((await f.request(method, `${endpoint}?keep=%2B+`, {}, headers)).status).toBe(400);
    }
    expect((await f.request("GET", "/api/version?value=%2B+", {}, headers)).status).toBe(200);
    for(const target of ["/api/externalCert/12?value=%2F", "/api/externalCert/12suffix?value=3"]) {
        const response = await f.request("GET", target, {}, headers);
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body).certInfo.cert.name).toBe("external.12.cert.pem");
        expect(f.seen).toContain(target);
    }
    expect((await f.request("GET", "/api/externalCert/?value=12", {}, headers)).status).toBe(400);
}), 15_000);
