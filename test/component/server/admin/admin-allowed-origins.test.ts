import fs from "fs/promises";
import path from "path";
import {httpRequest} from "../../../helpers/http";
import {withConfigurationServer} from "./configuration-revision-fixture";

// #303 — 역방향 프록시·도메인으로 관리 화면을 열 수 있게 server.yaml 의 adminAllowedOrigins 에 적은 Origin 도 허용한다.
jest.setTimeout(60_000);

const PROXY_ORIGIN = "https://admin.example.com";

/** 틀린 비밀번호로 로그인한다. Origin 검사를 통과하면 401, 막히면 403 Forbidden origin 이다. */
const loginFrom = async (port: number, origin: string) => {
    const response = await httpRequest({port, path: "/api/login", method: "POST",
        headers: {"Content-Type": "application/json", Origin: origin}, body: JSON.stringify({username: "admin", password: "wrong-password"})});
    return {status: response.statusCode, message: JSON.parse(response.body).message};
};

const saveOrigins = async (request: any, snapshot: any, origins: unknown) => {
    const read = await snapshot();
    return request("POST", "/api/serverOption", {...read.serverOption, adminAllowedOrigins: origins, expectedRevision: read.revisionState.currentRevision});
};

describe("adminAllowedOrigins (#303)", () => {
    test("an origin in the list passes the origin check at once and other origins still get 403 (REQ-3·REQ-4)", async () => withConfigurationServer(async ({request, snapshot, ports}) => {
        expect(await loginFrom(ports[0], PROXY_ORIGIN)).toEqual({status: 403, message: "Forbidden origin"});
        expect((await saveOrigins(request, snapshot, [PROXY_ORIGIN])).statusCode).toBe(200);
        expect((await loginFrom(ports[0], PROXY_ORIGIN)).status).toBe(401);
        // 요청의 Origin 도 같은 방식으로 정규화한다(기본 포트 443 을 적어도 같은 Origin 이다).
        expect((await loginFrom(ports[0], `${PROXY_ORIGIN}:443`)).status).toBe(401);
        // CORS 응답 헤더도 같은 판정을 따른다.
        const read = await request("GET", "/api/serverOption", undefined, 0, {Origin: PROXY_ORIGIN});
        expect(read.statusCode).toBe(200);
        expect(read.headers["access-control-allow-origin"]).toBe(PROXY_ORIGIN);
        for(const other of ["https://admin.example.com:8443", "http://admin.example.com", "https://evil.example"]) {
            expect(await loginFrom(ports[0], other)).toEqual({status: 403, message: "Forbidden origin"});
        }
        expect((await saveOrigins(request, snapshot, [])).statusCode).toBe(200);
        expect(await loginFrom(ports[0], PROXY_ORIGIN)).toEqual({status: 403, message: "Forbidden origin"});
    }));

    test("saving the server option without the key keeps the list (REQ-5)", async () => withConfigurationServer(async ({request, snapshot, store}) => {
        expect((await saveOrigins(request, snapshot, [PROXY_ORIGIN])).statusCode).toBe(200);
        const read = await snapshot();
        expect(read.serverOption.adminAllowedOrigins).toEqual([PROXY_ORIGIN]);
        const {adminAllowedOrigins: _omit, ...withoutOrigins} = read.serverOption;
        const saved = await request("POST", "/api/serverOption", {...withoutOrigins, logLevel: "warn", expectedRevision: read.revisionState.currentRevision});
        expect(saved.statusCode).toBe(200);
        expect(store.serverOption.adminAllowedOrigins).toEqual([PROXY_ORIGIN]);
    }));

    // #318: URL 의 IPv6 호스트 이름은 대괄호가 붙는다([::1]). 대괄호를 벗겨 비교해야 루프백과 IPv6 바인드 주소가 통과한다.
    test("the IPv6 loopback origin with the console port passes without a list, other ports do not (#318 AC-1)", async () => withConfigurationServer(async ({ports}) => {
        expect((await loginFrom(ports[0], `https://[::1]:${ports[0]}`)).status).toBe(401);
        expect(await loginFrom(ports[0], `https://[::1]:${ports[0] + 1}`)).toEqual({status: 403, message: "Forbidden origin"});
    }));

    test("an IPv6 adminBindHost passes in any spelling with the console port; other addresses and :: do not (#318 AC-2)", async () => withConfigurationServer(async ({apis, ports}) => {
        const api = apis[0] as any;
        const allowed = (origin: string) => api.isOriginAllowed(origin);
        api._bindHost = "fd00::10";
        expect(allowed(`https://[fd00::10]:${ports[0]}`)).toBe(true);
        expect(allowed(`https://[FD00:0:0:0:0:0:0:10]:${ports[0]}`)).toBe(true);
        expect(allowed(`https://[fd00::11]:${ports[0]}`)).toBe(false);
        expect(allowed(`https://[fd00::10]:${ports[0] + 1}`)).toBe(false);
        api._bindHost = "FD00:0000::0010";
        expect(allowed(`https://[fd00::10]:${ports[0]}`)).toBe(true);
        api._bindHost = "::";
        expect(allowed(`https://[::]:${ports[0]}`)).toBe(false);
    }));

    test("a wrong origin is 400 and server.yaml does not change (REQ-2)", async () => withConfigurationServer(async ({request, snapshot, store, root}) => {
        const file = path.join(root.rootDir, "config", "server.yaml");
        const before = await fs.readFile(file, "utf8");
        const rejected = await saveOrigins(request, snapshot, ["https://admin.example.com/console"]);
        expect(rejected.statusCode).toBe(400);
        expect(JSON.parse(rejected.body).message).toMatch(/^adminAllowedOrigins /);
        expect(await fs.readFile(file, "utf8")).toBe(before);
        expect(store.serverOption.adminAllowedOrigins ?? []).toEqual([]);
    }));
});
