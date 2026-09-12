import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import {ADMIN_ROUTES} from "../../../../src/server/admin/routes";
import {BOOTSTRAP_TOKEN_FILE_NAME, IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {createTestRoot, applyTestRoot, cleanupTestRoot} from "../../../helpers/runtime";

jest.setTimeout(30_000);

// 이슈 #95 표(#117 의 bans 라우트 2개 포함) 그대로 옮긴 기대 목록.
const EXPECTED_ROUTES: ReadonlyArray<{method: string; pattern: string}> = [
    {method: "POST", pattern: "^/api/login$"},
    {method: "GET", pattern: "^/api/version$"},
    {method: "POST", pattern: "^/api/logout$"},
    {method: "GET", pattern: "^/api/validateSession$"},
    {method: "GET", pattern: "^/api/csrfToken$"},
    {method: "GET", pattern: "^/api/serverOption$"},
    {method: "POST", pattern: "^/api/serverOption$"},
    {method: "PUT", pattern: "^/api/serverOption$"},
    {method: "GET", pattern: "^/api/serverOptionHash$"},
    {method: "GET", pattern: "^/api/adminCert$"},
    {method: "POST", pattern: "^/api/adminCert$"},
    {method: "PUT", pattern: "^/api/adminCert$"},
    {method: "GET", pattern: "^/api/sysInfo$"},
    {method: "GET", pattern: "^/api/sysUsage$"},
    {method: "GET", pattern: "^/api/clientStatus$"},
    {method: "GET", pattern: "^/api/clientSysInfo/(?<id>[^/]*)$"},
    {method: "GET", pattern: "^/api/tunnelingOption$"},
    {method: "POST", pattern: "^/api/tunnelingOption$"},
    {method: "PUT", pattern: "^/api/tunnelingOption$"},
    {method: "DELETE", pattern: "^/api/tunnelingOption$"},
    {method: "POST", pattern: "^/api/tunneling/active/(?<port>[^/]*)$"},
    {method: "GET", pattern: "^/api/externalServerStatuses$"},
    {method: "GET", pattern: "^/api/externalCert/(?<port>[^/]*)$"},
    {method: "POST", pattern: "^/api/externalCert/(?<port>[^/]*)$"},
    {method: "PUT", pattern: "^/api/externalCert/(?<port>[^/]*)$"},
    {method: "DELETE", pattern: "^/api/externalCert/(?<port>[^/]*)$"},
    {method: "GET", pattern: "^/api/security/bans$"},
    {method: "DELETE", pattern: "^/api/security/bans/(?<port>[^/]+)/(?<ip>[^/]+)$"}
];

const withRoutesServer = async (check: (fixture: any) => Promise<void>) => {
    const root = await createTestRoot("routes95");
    let api: AdminServer | undefined;
    try {
        applyTestRoot(root.rootDir);
        await CertificationStore.instance.load();
        await IdentityMigration.runAtStartup();
        const token = (await fs.readFile(path.join(root.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();
        api = new AdminServer(undefined as any, false);
        const port = await api.listen(0, "127.0.0.1");
        const requestRaw = (method: string, target: string, bytes: string, headers: Record<string, string> = {}) => new Promise<any>((resolve, reject) => {
            const req = http.request({host: "127.0.0.1", port, method, path: target,
                headers: {"Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bytes)), ...headers}}, res => {
                const data: Buffer[] = [];
                res.on("data", chunk => data.push(Buffer.from(chunk)));
                res.once("error", reject);
                res.once("end", () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(data).toString()}));
            });
            req.once("error", reject);
            req.setTimeout(2_000, () => req.destroy(new Error("owned HTTP route did not respond")));
            req.end(bytes);
        });
        const request = (method: string, target: string, body: object = {}, headers: Record<string, string> = {}) =>
            requestRaw(method, target, JSON.stringify(body), headers);
        const login = async () => {
            const response = await request("POST", "/api/login", {key: "routes95-password", bootstrapToken: token});
            expect(response.status).toBe(200);
            const cookies: string[] = response.headers["set-cookie"];
            return {Cookie: cookies.map(value => value.split(";")[0]).join("; "),
                "X-CSRF-Token": cookies.find(value => value.startsWith("csrfToken="))!.split(";")[0].slice("csrfToken=".length)};
        };
        await check({port, token, request, requestRaw, login, api});
    } finally {
        try { await api?.close(); } finally { await cleanupTestRoot(root); }
    }
};

test("ADMIN_ROUTES matches the route table agreed in issue #95 exactly", () => {
    // RegExp#source 는 생성 방식과 무관하게 '/' 를 항상 이스케이프해 돌려주므로(JS 스펙),
    // 기대 목록도 같은 규칙(new RegExp(pattern).source)으로 변환해 비교한다.
    const actual = ADMIN_ROUTES.map(route => ({method: route.method, pattern: route.pattern.source}));
    const expected = EXPECTED_ROUTES.map(route => ({method: route.method, pattern: new RegExp(route.pattern).source}));
    expect(actual).toEqual(expected);
});

test("every ADMIN_ROUTES pattern is fully anchored", () => {
    for(const route of ADMIN_ROUTES) {
        expect(route.pattern.source.startsWith("^")).toBe(true);
        expect(route.pattern.source.endsWith("$")).toBe(true);
    }
});

test("every ADMIN_ROUTES handler name exists as a callable member on AdminServer", async () => withRoutesServer(async f => {
    for(const route of ADMIN_ROUTES) {
        expect(typeof (f.api as any)[route.handler]).toBe("function");
    }
}));

test("GET routes without a session return 401 except the public ones", async () => withRoutesServer(async f => {
    const getRoutes = ADMIN_ROUTES.filter(route => route.method === "GET");
    for(const route of getRoutes) {
        // 대표 세그먼트 값(1)을 채워 넣어 실제 요청 가능한 경로로 만든다.
        // source 는 '/' 를 항상 이스케이프해 돌려주므로(\/) 실제 경로로 쓰기 전에 되돌린다.
        const target = route.pattern.source
            .replace(/^\^/, "").replace(/\$$/, "")
            .replace(/\(\?<[a-zA-Z]+>\[\^\/\]\*\)/g, "1")
            .replace(/\(\?<[a-zA-Z]+>\[\^\/\]\+\)/g, "1")
            .replace(/\\\//g, "/");
        const response = await f.request("GET", target);
        if(route.action === "public") {
            expect(response.status).toBe(200);
        } else {
            expect(response.status).toBe(401);
            expect(JSON.parse(response.body)).toMatchObject({message: "Invalid session"});
        }
    }
}));

test("unknown /api/ GET is 404 JSON, unknown static asset is 404 text", async () => withRoutesServer(async f => {
    const apiResponse = await f.request("GET", "/api/nothing");
    expect(apiResponse.status).toBe(404);
    expect(JSON.parse(apiResponse.body).success).toBe(false);

    const staticResponse = await f.request("GET", "/nothing.txt");
    expect(staticResponse.status).toBe(404);
    expect(staticResponse.body).toContain("Not Found /nothing.txt");
}));

test("CSRF/Origin admission runs before route matching for an unknown mutating path", async () => withRoutesServer(async f => {
    const headers = await f.login();
    const knownOrigin = await f.request("POST", "/api/absent", {}, headers);
    expect(knownOrigin.status).toBe(404);

    const evilOrigin = await f.request("POST", "/api/absent", {}, {...headers, Origin: "https://evil.example"});
    expect(evilOrigin.status).toBe(403);
}));

test("body limit is enforced after session resolution: no cookie -> 401, not 413", async () => withRoutesServer(async f => {
    const bigBody = {padding: "a".repeat(1024 * 1024 + 2)};
    const response = await f.request("POST", "/api/serverOption", bigBody);
    expect(response.status).toBe(401);
}));

test("POST /api/tunneling/active/abc with a session yields 400 Invalid port from the handler, not the route table", async () => withRoutesServer(async f => {
    const headers = await f.login();
    const response = await f.request("POST", "/api/tunneling/active/abc", {}, headers);
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).message).toBe("Invalid port");
}));

test("GET /api/externalCert/12/34 no longer matches (multi-segment) -> 404 JSON", async () => withRoutesServer(async f => {
    const headers = await f.login();
    const response = await f.request("GET", "/api/externalCert/12/34", {}, headers);
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body).success).toBe(false);
}));

// 본문 파싱이 route() 로 중앙화되어, onLogin 전용 catch(구 400 'Invalid login body')가 사라지고
// 다른 모든 POST/PUT/DELETE 와 같은 공용 400 'Invalid JSON body' 를 받는다 (#95, 의도된 변경).
test("POST /api/login with syntactically broken JSON gets the shared 'Invalid JSON body' message, not a login-specific one", async () => withRoutesServer(async f => {
    const response = await f.requestRaw("POST", "/api/login", "{not valid json");
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).message).toBe("Invalid JSON body");
}));

// 세그먼트 수가 (?<port>[^/]+)/(?<ip>[^/]+) 와 맞지 않으면 앵커 정규식이 매칭하지 않아
// 핸들러(400 'invalid port')에 도달하기 전에 404 가 된다 — 존재하지 않는 경로는 인자 오류가 아니다 (#95, 의도된 변경).
test("DELETE /api/security/bans with a wrong segment count is 404, not the handler's 400", async () => withRoutesServer(async f => {
    const headers = await f.login();
    const oneSegment = await f.request("DELETE", "/api/security/bans/12", {}, headers);
    expect(oneSegment.status).toBe(404);
    const threeSegments = await f.request("DELETE", "/api/security/bans/12/1.1.1.1/extra", {}, headers);
    expect(threeSegments.status).toBe(404);
}));
