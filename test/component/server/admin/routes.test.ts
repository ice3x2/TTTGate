import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import {ADMIN_ROUTES, RouteAction, RouteContext} from "../../../../src/server/admin/routes";
import {rbacRouteHandlers} from "../../../../src/server/admin/rbacRoutes";
import {auditRouteHandlers} from "../../../../src/server/admin/auditRoutes";
import {AuditQuery} from "../../../../src/server/audit/AuditQuery";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {BOOTSTRAP_TOKEN_FILE_NAME, IdentityMigration} from "../../../../src/server/rbac/IdentityMigration";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {createTestRoot, applyTestRoot, cleanupTestRoot} from "../../../helpers/runtime";

jest.setTimeout(30_000);

// 이슈 #95 표(#117 의 bans 2개, #119 의 stats 1개, #96 의 /api/me 3개 포함) 그대로 옮긴 기대 목록.
// method 와 pattern 뿐 아니라 권한 결정에 쓰이는 선언(action, target 공급 여부)까지 함께 고정한다.
// 이 둘을 빼면 라우트의 action 을 'session' 이나 'public' 으로 바꿔 놓아도 표 테스트가 통과해 버린다.
// 함수형 action 은 값 비교가 불가능하므로 함수 이름을 식별자로 삼고,
// 실제 판정 결과는 아래의 "함수형 action" 테스트가 따로 고정한다.
type ExpectedRoute = {method: string; pattern: string; action: string; hasTarget: boolean};

const EXPECTED_ROUTES: ReadonlyArray<ExpectedRoute> = [
    {method: "POST", pattern: "^/api/login$", action: "public", hasTarget: false},
    {method: "GET", pattern: "^/api/version$", action: "public", hasTarget: false},
    {method: "POST", pattern: "^/api/logout$", action: "session", hasTarget: false},
    {method: "GET", pattern: "^/api/validateSession$", action: "session", hasTarget: false},
    {method: "GET", pattern: "^/api/csrfToken$", action: "session", hasTarget: false},
    {method: "GET", pattern: "^/api/me$", action: "me:read", hasTarget: false},
    {method: "PUT", pattern: "^/api/me/password$", action: "me:password", hasTarget: false},
    {method: "POST", pattern: "^/api/me/acknowledge-migration$", action: "me:read", hasTarget: false},
    // U4-04 / #112 본인 MFA. enroll 은 상태를 바꾸지 않는 준비 단계라 audit: false 로 감사에서 뺀다.
    {method: "POST", pattern: "^/api/me/mfa/enroll$", action: "me:mfa", hasTarget: false},
    {method: "POST", pattern: "^/api/me/mfa/confirm$", action: "me:mfa", hasTarget: false},
    {method: "DELETE", pattern: "^/api/me/mfa$", action: "me:mfa", hasTarget: false},
    {method: "POST", pattern: "^/api/me/mfa/recovery-codes$", action: "me:mfa", hasTarget: false},
    // U4-05 / #113 본인 세션.
    {method: "GET", pattern: "^/api/me/sessions$", action: "me:sessions", hasTarget: false},
    {method: "POST", pattern: "^/api/me/sessions/logout-others$", action: "me:sessions", hasTarget: false},
    {method: "GET", pattern: "^/api/serverOption$", action: "server:manage", hasTarget: false},
    {method: "POST", pattern: "^/api/serverOption$", action: "server:manage", hasTarget: false},
    {method: "PUT", pattern: "^/api/serverOption$", action: "server:manage", hasTarget: false},
    {method: "GET", pattern: "^/api/serverOptionHash$", action: "server:manage", hasTarget: false},
    {method: "GET", pattern: "^/api/adminCert$", action: "server:manage", hasTarget: false},
    {method: "POST", pattern: "^/api/adminCert$", action: "server:manage", hasTarget: false},
    {method: "PUT", pattern: "^/api/adminCert$", action: "server:manage", hasTarget: false},
    {method: "GET", pattern: "^/api/sysInfo$", action: "status:read", hasTarget: false},
    {method: "GET", pattern: "^/api/sysUsage$", action: "status:read", hasTarget: false},
    {method: "GET", pattern: "^/api/clientStatus$", action: "status:read", hasTarget: false},
    {method: "GET", pattern: "^/api/clientSysInfo/(?<id>[^/]*)$", action: "status:read", hasTarget: false},
    {method: "GET", pattern: "^/api/tunnelingOption$", action: "tunnel:list", hasTarget: true},
    {method: "POST", pattern: "^/api/tunnelingOption$", action: "tunnelWriteAction", hasTarget: true},
    {method: "PUT", pattern: "^/api/tunnelingOption$", action: "tunnelWriteAction", hasTarget: true},
    {method: "DELETE", pattern: "^/api/tunnelingOption$", action: "tunnel:delete", hasTarget: true},
    {method: "PUT", pattern: "^/api/tunnelingOption/(?<port>[^/]*)/owner$", action: "tunnel:reassign", hasTarget: true},
    {method: "POST", pattern: "^/api/tunneling/active/(?<port>[^/]*)$", action: "tunnel:activate", hasTarget: true},
    {method: "GET", pattern: "^/api/externalServerStatuses$", action: "tunnel:list", hasTarget: true},
    {method: "GET", pattern: "^/api/externalCert/(?<port>[^/]*)$", action: "tunnel:cert", hasTarget: true},
    {method: "POST", pattern: "^/api/externalCert/(?<port>[^/]*)$", action: "tunnel:cert", hasTarget: true},
    {method: "PUT", pattern: "^/api/externalCert/(?<port>[^/]*)$", action: "tunnel:cert", hasTarget: true},
    {method: "DELETE", pattern: "^/api/externalCert/(?<port>[^/]*)$", action: "tunnel:cert", hasTarget: true},
    {method: "GET", pattern: "^/api/security/bans$", action: "security:manage", hasTarget: false},
    {method: "DELETE", pattern: "^/api/security/bans/(?<port>[^/]+)/(?<ip>[^/]+)$", action: "security:manage", hasTarget: false},
    {method: "GET", pattern: "^/api/security/stats$", action: "security:manage", hasTarget: false},
    // U5-05 / #120 이 더한 국가 필터·국가 목록 라우트.
    {method: "GET", pattern: "^/api/security/geo$", action: "security:manage", hasTarget: false},
    {method: "PUT", pattern: "^/api/security/geo$", action: "security:manage", hasTarget: false},
    {method: "GET", pattern: "^/api/security/countries$", action: "security:manage", hasTarget: false},
    // U2-06 / #98 이 더한 사용자·그룹 관리 라우트. 핸들러는 rbacRoutes.ts 에 있다.
    {method: "GET", pattern: "^/api/users$", action: "user:manage", hasTarget: false},
    {method: "POST", pattern: "^/api/users$", action: "user:manage", hasTarget: false},
    {method: "GET", pattern: "^/api/users/(?<id>[^/]+)$", action: "user:manage", hasTarget: false},
    {method: "PUT", pattern: "^/api/users/(?<id>[^/]+)$", action: "user:manage", hasTarget: false},
    {method: "DELETE", pattern: "^/api/users/(?<id>[^/]+)$", action: "user:manage", hasTarget: false},
    {method: "POST", pattern: "^/api/users/(?<id>[^/]+)/password-reset$", action: "user:manage", hasTarget: false},
    {method: "GET", pattern: "^/api/groups$", action: "group:manage", hasTarget: false},
    {method: "POST", pattern: "^/api/groups$", action: "group:manage", hasTarget: false},
    {method: "GET", pattern: "^/api/groups/(?<id>[^/]+)$", action: "group:manage", hasTarget: false},
    {method: "PUT", pattern: "^/api/groups/(?<id>[^/]+)$", action: "group:manage", hasTarget: false},
    {method: "DELETE", pattern: "^/api/groups/(?<id>[^/]+)$", action: "group:manage", hasTarget: false},
    // U4-05 / #113 세션 관리.
    {method: "GET", pattern: "^/api/sessions$", action: "session:manage", hasTarget: false},
    {method: "DELETE", pattern: "^/api/sessions/(?<id>[^/]+)$", action: "session:manage", hasTarget: false},
    {method: "DELETE", pattern: "^/api/users/(?<id>[^/]+)/sessions$", action: "session:manage", hasTarget: false},
    // U4-02 / #110 감사 조회. 슈퍼유저는 audit:read-all, 일반 유저는 audit:read-self 로 판정한다.
    {method: "GET", pattern: "^/api/audit$", action: "auditReadAction", hasTarget: false},
    {method: "GET", pattern: "^/api/audit/types$", action: "auditReadAction", hasTarget: false}
];

/** 함수형 action 은 값으로 비교할 수 없으므로 함수 이름을 식별자로 쓴다. */
const actionIdOf = (action: RouteAction): string => typeof action === "function" ? action.name : action;

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
    const actual = ADMIN_ROUTES.map(route => ({
        method: route.method, pattern: route.pattern.source,
        action: actionIdOf(route.action), hasTarget: route.target !== undefined
    }));
    const expected = EXPECTED_ROUTES.map(route => ({
        method: route.method, pattern: new RegExp(route.pattern).source,
        action: route.action, hasTarget: route.hasTarget
    }));
    expect(actual).toEqual(expected);
});

// 위 표는 함수형 action 을 이름으로만 고정하므로, 그 함수가 실제로 무엇을 돌려주는지는 여기서 잠근다.
test("the functional action on /api/tunnelingOption picks update for a registered port and create otherwise", async () => withRoutesServer(async () => {
    ServerOptionStore.instance.updateTunnelingOption({
        forwardPort: 18099, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 8080, keepAlive: 0
    });
    const entry = ADMIN_ROUTES.find(route => route.method === "POST" && route.pattern.source === new RegExp("^/api/tunnelingOption$").source)!;
    expect(typeof entry.action).toBe("function");
    const resolve = entry.action as (ctx: RouteContext) => string;
    const contextOf = (forwardPort: number) => ({params: {}, body: {forwardPort}} as unknown as RouteContext);

    expect(resolve(contextOf(18099))).toBe("tunnel:update");
    expect(resolve(contextOf(18100))).toBe("tunnel:create");
}));

test("every ADMIN_ROUTES pattern is fully anchored", () => {
    for(const route of ADMIN_ROUTES) {
        expect(route.pattern.source.startsWith("^")).toBe(true);
        expect(route.pattern.source.endsWith("$")).toBe(true);
    }
});

// #98 이후 핸들러는 세 모듈에 나뉘어 있다: 기존 핸들러는 AdminServer 의 멤버, 사용자·그룹 핸들러는
// rbacRouteHandlers, 감사 조회 핸들러는 auditRouteHandlers(#110). 이름이 어느 쪽에서든 실제 함수로 풀리는지를 그대로 확인한다.
test("every ADMIN_ROUTES handler name resolves to a callable handler", async () => withRoutesServer(async f => {
    const auditHandlers = auditRouteHandlers(new AuditQuery("unused"), () => undefined);
    for(const route of ADMIN_ROUTES) {
        const handler = (f.api as any)[route.handler] ?? rbacRouteHandlers[route.handler] ?? auditHandlers[route.handler];
        expect(typeof handler).toBe("function");
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
