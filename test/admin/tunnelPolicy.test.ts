import {DEFAULT_GROUP_ATTRIBUTES, type GroupAttributes, type MeResponse, type Role} from "../../admin/src/controller/Types";
import {tunnelErrorMessage, tunnelPolicy} from "../../admin/src/screens/parts/tunnelPolicy";
import {RBAC_IDENTITY_FIXTURE} from "../helpers/rbacFixture";

// U3-06 / #108 — 터널 화면의 그룹 속성 정책(순수 함수). tunnelPolicy 는 user.role 과 group.attributes 만 읽는다.
const FIELD_TEAM = RBAC_IDENTITY_FIXTURE.groups![0].attributes as GroupAttributes;

const meOf = (role: Role, attributes: GroupAttributes): MeResponse => ({
    user: {id: "", username: "", displayName: "", role, status: "active", groupId: "", groupName: "",
        mustChangePassword: false, migratedFromLegacyAdmin: false, createdAt: 0, updatedAt: 0},
    group: {id: "", name: "", attributes},
    sections: [],
    migrationBanner: false,
});

const values = (options: Array<{value: string}>) => options.map((option) => option.value);

describe("tunnelPolicy", () => {
    test("alice(Field team)는 그룹 범위·프로토콜·리라이트·신뢰 클라이언트·개수 한도를 따른다", () => {
        const policy = tunnelPolicy(meOf("regular", FIELD_TEAM));
        expect(policy.restricted).toBe(true);
        expect(policy.portHint()).toBe("Allowed ranges: 20000–20099");
        expect(policy.initialPort()).toBe(20000);
        expect(policy.isPortAllowed(20050)).toBe(true);
        expect(policy.isPortAllowed(30000)).toBe(false);
        expect(values(policy.protocolOptions("tcp"))).toEqual(["tcp", "http"]);
        expect(policy.protocolOptions("tcp").map((option) => option.label)).toEqual(["TCP", "HTTP (http/1.1)"]);
        expect(values(policy.protocolOptions("https"))).toEqual(["https", "tcp", "http"]);
        expect(policy.showHttpOptions).toBe(true);
        expect(policy.rewrite).toEqual({cors: true, host: true, header: false, body: false});
        expect(policy.trustedClients).toEqual(["client-a"]);
        expect(policy.canCreate(1)).toBe(true);
        expect(policy.canCreate(2)).toBe(false);
        expect(policy.limitReached(2)).toBe(true);
    });

    test("normalizeHttpOption 은 제자리에서 고치며, TCP 는 리라이트를 모두 끄고 HTTP 는 허용된 것만 남긴다", () => {
        const policy = tunnelPolicy(meOf("regular", FIELD_TEAM));
        const make = (protocol: string) => ({protocol, httpOption: {rewriteHostInTextBody: true, replaceAccessControlAllowOrigin: true,
            customRequestHeaders: [{name: "a", value: "b"}], customResponseHeaders: [], bodyRewriteRules: [{from: "x", to: "y"}]}});
        const input = make("tcp");
        expect(policy.normalizeHttpOption(input)).toBeUndefined();
        expect(input.httpOption).toEqual({rewriteHostInTextBody: false, replaceAccessControlAllowOrigin: false,
            customRequestHeaders: [], customResponseHeaders: [], bodyRewriteRules: []});
        const http = make("http");
        policy.normalizeHttpOption(http);
        expect(http.httpOption).toEqual({rewriteHostInTextBody: true, replaceAccessControlAllowOrigin: true,
            customRequestHeaders: [], customResponseHeaders: [], bodyRewriteRules: []});
        expect(() => policy.normalizeHttpOption({protocol: "tcp"})).not.toThrow();
    });

    test("carol(Default)은 포트·프로토콜이 없어 힌트·초기 포트·HTTP 옵션이 비어 있다", () => {
        const policy = tunnelPolicy(meOf("regular", DEFAULT_GROUP_ATTRIBUTES));
        expect(policy.portHint()).toBe("No ports are allowed for your group.");
        expect(policy.initialPort()).toBeNull();
        expect(policy.isPortAllowed(25000)).toBe(false);
        expect(values(policy.protocolOptions("tcp"))).toEqual(["tcp"]);
        expect(policy.showHttpOptions).toBe(false);
        expect(policy.canCreate(0)).toBe(true);
    });

    test("read_only 그룹은 만들 수 없지만 한도 도달로 보지 않는다", () => {
        const policy = tunnelPolicy(meOf("regular", {...DEFAULT_GROUP_ATTRIBUTES, tunnel_crud: "read_only"}));
        expect(policy.canCreate(0)).toBe(false);
        expect(policy.limitReached(0)).toBe(false);
    });

    test("슈퍼유저는 제한이 없고 httpOption 을 바꾸지 않는다", () => {
        const policy = tunnelPolicy(meOf("superuser", DEFAULT_GROUP_ATTRIBUTES));
        expect(policy.restricted).toBe(false);
        expect(policy.portHint()).toBe("");
        expect(policy.initialPort()).toBeNull();
        expect(policy.isPortAllowed(1)).toBe(true);
        expect(policy.protocolOptions("tcp")).toHaveLength(3);
        expect(policy.rewrite).toEqual({cors: true, host: true, header: true, body: true});
        expect(policy.canCreate(1000)).toBe(true);
        const input = {protocol: "tcp", httpOption: {rewriteHostInTextBody: true}};
        policy.normalizeHttpOption(input);
        expect(input.httpOption).toEqual({rewriteHostInTextBody: true});
    });

    test("tunnelErrorMessage 는 알려진 코드만 문구로 바꾼다", () => {
        expect(tunnelErrorMessage("port_not_allowed", "x")).toBe("This port is outside your group's allowed ranges.");
        expect(tunnelErrorMessage("unknown_code", "server says")).toBe("server says");
        expect(tunnelErrorMessage(undefined, "fallback")).toBe("fallback");
        expect(tunnelErrorMessage("toString", "fallback")).toBe("fallback");
    });
});
