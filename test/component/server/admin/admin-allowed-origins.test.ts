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
