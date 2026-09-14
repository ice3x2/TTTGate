import {enforce, EnforceContext, EnforceResult, requiredProtocols} from "../../../../src/server/rbac/AttributeEnforcer";
import {cloneGroupAttributes, DEFAULT_GROUP_ATTRIBUTES, GroupAttributes, Role} from "../../../../src/server/rbac/IdentityTypes";
import {Principal} from "../../../../src/server/rbac/Principal";
import {TunnelingOption} from "../../../../src/types/TunnelingOption";

/** 케이스마다 기본 속성 위에 필요한 속성만 덮어쓴다. 형식이 틀린 값도 넣을 수 있도록 any 로 받는다. */
const principalWith = (overrides: Record<string, any>, role: string = "regular"): Principal => ({
    userId: "u_regular0000000",
    username: "regular",
    role: role as Role,
    groupId: "g_test00000000000",
    mustChangePassword: false,
    attributes: {...cloneGroupAttributes(DEFAULT_GROUP_ATTRIBUTES as GroupAttributes), ...overrides} as GroupAttributes
});

// 일반 유저는 allowedClientIds 가 비면 거부된다(아래 "신뢰 클라이언트" 참조). 성공 케이스가 다른 이유로
// 실패하지 않도록 기준 터널·속성·컨텍스트는 허용·등록된 클라이언트 c1 하나를 함께 갖는다.
const TCP: TunnelingOption = {forwardPort: 20010, protocol: "tcp", destinationAddress: "127.0.0.1", destinationPort: 80, keepAlive: 0,
    allowedClientIds: ["c1"]};
const tunnel = (overrides: Record<string, any>): TunnelingOption => ({...TCP, ...overrides} as TunnelingOption);

/** TCP 기준 터널을 받아들이는 최소 속성. 각 케이스는 여기서 한 속성만 바꿔 경계를 본다. */
const BASE = {allowed_port_range: [{from: 20000, to: 20099}], allowed_protocols: ["TCP"], max_tunnel_count: 2, allowed_trusted_clients: ["c1"]};
const CONTEXT: EnforceContext = {ownedCount: 1, trustedClientIds: ["c1"]};

const expectFailure = (result: EnforceResult, status: number, code: string): void => {
    expect(result).toMatchObject({success: false, status, code});
};

describe("requiredProtocols", () => {
    it.each([["tcp", ["TCP"]], ["http", ["HTTP"]], ["https", ["HTTPS"]]])("protocol %s 는 %j 를 요구한다", (protocol, expected) => {
        expect(requiredProtocols(tunnel({protocol}))).toEqual(expected);
    });

    it("리라이트가 켜진 https 는 HTTPS 와 HTTP_REWRITE 를 요구한다", () => {
        expect(requiredProtocols(tunnel({protocol: "https", httpOption: {bodyRewriteRules: [{from: "a", to: "b"}]}})))
            .toEqual(["HTTPS", "HTTP_REWRITE"]);
    });

    it.each([
        ["replaceAccessControlAllowOrigin", true],
        ["rewriteHostInTextBody", true],
        ["customRequestHeaders", [{name: "X", value: "1", replace: false}]],
        ["customResponseHeaders", [{name: "X", value: "1", replace: false}]],
        ["bodyRewriteRules", [{from: "a", to: "b"}]]
    ])("%s 가 켜지면 HTTP_REWRITE 가 더해진다", (field, value) => {
        expect(requiredProtocols(tunnel({protocol: "http", httpOption: {[field]: value}}))).toEqual(["HTTP", "HTTP_REWRITE"]);
    });

    it("keepAliveTimeout 과 꺼진 리라이트 값만 있으면 리라이트가 아니다", () => {
        expect(requiredProtocols(tunnel({protocol: "http", httpOption: {
            keepAliveTimeout: 1000, replaceAccessControlAllowOrigin: false, rewriteHostInTextBody: false,
            customRequestHeaders: [], customResponseHeaders: [], bodyRewriteRules: []
        }}))).toEqual(["HTTP"]);
    });

    // 런타임(HttpHandler)은 == true 로 읽어 1 이나 "1" 에서도 리라이트를 켠다.
    // 명시적으로 꺼져 있지 않은 값은 모두 리라이트 요청으로 본다(거부 쪽으로 떨어진다).
    it.each([1, "1", "true", {}])("true 가 아닌 켜짐 값 %j 도 리라이트로 본다", (value) => {
        expect(requiredProtocols(tunnel({protocol: "http", httpOption: {replaceAccessControlAllowOrigin: value}})))
            .toEqual(["HTTP", "HTTP_REWRITE"]);
        expect(requiredProtocols(tunnel({protocol: "http", httpOption: {rewriteHostInTextBody: value}})))
            .toEqual(["HTTP", "HTTP_REWRITE"]);
    });

    it.each([["udp"], [undefined], [""], ["TCP"]])("알 수 없는 protocol %j 는 만족시킬 수 없는 요구(undefined)다", (protocol) => {
        expect(requiredProtocols(tunnel({protocol}))).toBeUndefined();
    });
});

describe("enforce: 슈퍼유저", () => {
    it("슈퍼유저 주체면 어떤 터널 입력이든 성공이다", () => {
        const superuser = principalWith({allowed_port_range: [], allowed_protocols: [], max_tunnel_count: 0}, "superuser");
        const hostile = tunnel({
            forwardPort: 99999, protocol: "udp", allowedClientNames: ["old"], allowedClientIds: ["unregistered"],
            httpOption: {replaceAccessControlAllowOrigin: true, rewriteHostInTextBody: true, bodyRewriteRules: [{from: "a", to: "b"}]}
        });
        expect(enforce(superuser, hostile, "create", {ownedCount: 1000, trustedClientIds: []})).toEqual({success: true});
        expect(enforce(superuser, hostile, "update", {ownedCount: 1000, trustedClientIds: []})).toEqual({success: true});
    });

    it.each(["Superuser", "admin", "", "superuser "])("정확히 'superuser' 가 아닌 역할 %j 은 우회하지 못한다", (role) => {
        expectFailure(enforce(principalWith({}, role), TCP, "update", CONTEXT), 422, "port_not_allowed");
    });
});

describe("enforce: 터널 수(max_tunnel_count)", () => {
    it("create 는 ownedCount 가 상한 미만일 때만 성공한다", () => {
        expect(enforce(principalWith(BASE), TCP, "create", {...CONTEXT, ownedCount: 1})).toEqual({success: true});
        expectFailure(enforce(principalWith(BASE), TCP, "create", {...CONTEXT, ownedCount: 2}), 409, "tunnel_count_exceeded");
    });

    it("update 는 터널 수를 보지 않는다", () => {
        expect(enforce(principalWith(BASE), TCP, "update", {...CONTEXT, ownedCount: 5})).toEqual({success: true});
    });

    it("max_tunnel_count 0 이면 첫 터널도 만들 수 없다", () => {
        expectFailure(enforce(principalWith({...BASE, max_tunnel_count: 0}), TCP, "create", {...CONTEXT, ownedCount: 0}),
            409, "tunnel_count_exceeded");
    });

    it.each([[undefined], ["10"], [NaN], [-1], [1.5], [null], [Infinity]])("형식이 틀린 max_tunnel_count %j 는 0 으로 보고 거부한다", (limit) => {
        expectFailure(enforce(principalWith({...BASE, max_tunnel_count: limit}), TCP, "create", {...CONTEXT, ownedCount: 0}),
            409, "tunnel_count_exceeded");
    });
});

describe("enforce: 포트(allowed_port_range)", () => {
    it("범위 밖 포트는 create·update 모두 거부한다(수정 때도 전체 검사)", () => {
        const outside = tunnel({forwardPort: 30000});
        expectFailure(enforce(principalWith(BASE), outside, "create", CONTEXT), 422, "port_not_allowed");
        expectFailure(enforce(principalWith(BASE), outside, "update", CONTEXT), 422, "port_not_allowed");
    });

    it("구간이 여럿이면 어느 한 구간에만 들어도 된다", () => {
        const ranges = {...BASE, allowed_port_range: [{from: 1, to: 10}, {from: 20000, to: 20099}]};
        expect(enforce(principalWith(ranges), tunnel({forwardPort: 20050}), "update", CONTEXT)).toEqual({success: true});
        expect(enforce(principalWith(ranges), tunnel({forwardPort: 5}), "update", CONTEXT)).toEqual({success: true});
        expectFailure(enforce(principalWith(ranges), tunnel({forwardPort: 11}), "update", CONTEXT), 422, "port_not_allowed");
    });

    it("구간의 양 끝은 포함하고 바로 바깥은 거부한다", () => {
        expect(enforce(principalWith(BASE), tunnel({forwardPort: 20000}), "update", CONTEXT)).toEqual({success: true});
        expect(enforce(principalWith(BASE), tunnel({forwardPort: 20099}), "update", CONTEXT)).toEqual({success: true});
        expectFailure(enforce(principalWith(BASE), tunnel({forwardPort: 19999}), "update", CONTEXT), 422, "port_not_allowed");
        expectFailure(enforce(principalWith(BASE), tunnel({forwardPort: 20100}), "update", CONTEXT), 422, "port_not_allowed");
    });

    it.each([1, 20010, 65535])("allowed_port_range 가 비어 있으면(기본값) 포트 %d 도 거부한다", (port) => {
        expectFailure(enforce(principalWith({...BASE, allowed_port_range: []}), tunnel({forwardPort: port}), "update", CONTEXT),
            422, "port_not_allowed");
    });

    it.each([["20010"], [20010.5], [undefined], [NaN]])("형식이 틀린 forwardPort %j 는 거부한다", (port) => {
        expectFailure(enforce(principalWith(BASE), tunnel({forwardPort: port}), "update", CONTEXT), 422, "port_not_allowed");
    });

    it.each([
        [undefined],
        ["all"],
        [{from: 20000, to: 20099}],
        [[{from: "20000", to: "20099"}]],
        [[{from: 20099, to: 20000}]],
        [[null]]
    ])("형식이 틀린 allowed_port_range %j 는 아무 포트도 허용하지 않는다", (ranges) => {
        expectFailure(enforce(principalWith({...BASE, allowed_port_range: ranges}), TCP, "update", CONTEXT), 422, "port_not_allowed");
    });
});

describe("enforce: 프로토콜(allowed_protocols)", () => {
    const HTTP = {...BASE, allowed_protocols: ["HTTP"]};

    it("http 터널은 HTTP 허용이 있어야 한다", () => {
        expectFailure(enforce(principalWith(BASE), tunnel({protocol: "http"}), "update", CONTEXT), 422, "protocol_not_allowed");
        expect(enforce(principalWith(HTTP), tunnel({protocol: "http"}), "update", CONTEXT)).toEqual({success: true});
    });

    it("호스트 리라이트는 HTTP_REWRITE 와 host 권한을 모두 요구한다", () => {
        const rewriting = tunnel({protocol: "http", httpOption: {rewriteHostInTextBody: true}});
        expectFailure(enforce(principalWith(HTTP), rewriting, "update", CONTEXT), 422, "protocol_not_allowed");

        const withRewrite = {...BASE, allowed_protocols: ["HTTP", "HTTP_REWRITE"]};
        const noHost = {cors: false, host: false, header: false, body: false};
        expectFailure(enforce(principalWith({...withRewrite, http_tunnel_rewrite_permissions: noHost}), rewriting, "update", CONTEXT),
            422, "rewrite_not_allowed");
        expect(enforce(principalWith({...withRewrite, http_tunnel_rewrite_permissions: {...noHost, host: true}}), rewriting, "update", CONTEXT))
            .toEqual({success: true});
    });

    it("keepAliveTimeout 만 있으면 HTTP_REWRITE 가 필요 없다", () => {
        expect(enforce(principalWith(HTTP), tunnel({protocol: "http", httpOption: {keepAliveTimeout: 1000}}), "update", CONTEXT))
            .toEqual({success: true});
    });

    it.each([["udp"], [undefined], ["TCP"]])("알 수 없는 protocol %j 는 네 프로토콜을 모두 허용해도 거부한다", (protocol) => {
        const everything = {...BASE, allowed_protocols: ["TCP", "HTTP", "HTTPS", "HTTP_REWRITE"]};
        expectFailure(enforce(principalWith(everything), tunnel({protocol}), "update", CONTEXT), 422, "protocol_not_allowed");
    });

    // "TCP".includes("TCP") 는 참이다. 배열이 아닌 값을 목록처럼 다루면 허용으로 떨어진다.
    it.each([[undefined], ["TCP"], [{0: "TCP", length: 1}], [null]])("형식이 틀린 allowed_protocols %j 는 아무 프로토콜도 허용하지 않는다", (protocols) => {
        expectFailure(enforce(principalWith({...BASE, allowed_protocols: protocols}), TCP, "update", CONTEXT), 422, "protocol_not_allowed");
    });

    it("HTTP_REWRITE 허용만으로는 기반 프로토콜 HTTP 가 충족되지 않는다", () => {
        const onlyRewrite = {...BASE, allowed_protocols: ["HTTP_REWRITE"], http_tunnel_rewrite_permissions: {cors: true, host: true, header: true, body: true}};
        expectFailure(enforce(principalWith(onlyRewrite), tunnel({protocol: "http", httpOption: {rewriteHostInTextBody: true}}), "update", CONTEXT),
            422, "protocol_not_allowed");
    });
});

describe("enforce: 레거시 클라이언트 이름(allowedClientNames)", () => {
    it("비어 있지 않으면 거부하고 비었거나 없으면 통과한다", () => {
        expectFailure(enforce(principalWith(BASE), tunnel({allowedClientNames: ["old"]}), "update", CONTEXT), 422, "legacy_client_names_not_allowed");
        expect(enforce(principalWith(BASE), tunnel({allowedClientNames: []}), "update", CONTEXT)).toEqual({success: true});
        expect(enforce(principalWith(BASE), tunnel({allowedClientNames: undefined}), "update", CONTEXT)).toEqual({success: true});
        expect(enforce(principalWith(BASE), tunnel({allowedClientNames: null}), "update", CONTEXT)).toEqual({success: true});
    });

    it.each([["old"], [{0: "old"}], [1]])("배열이 아닌 값 %j 도 거부한다", (names) => {
        expectFailure(enforce(principalWith(BASE), tunnel({allowedClientNames: names}), "update", CONTEXT), 422, "legacy_client_names_not_allowed");
    });
});

describe("enforce: 신뢰 클라이언트(allowed_trusted_clients)", () => {
    const withIds = tunnel({allowedClientIds: ["c1"]});

    it("그룹 허용과 서버 등록이 모두 있어야 성공한다", () => {
        expect(enforce(principalWith({...BASE, allowed_trusted_clients: ["c1"]}), withIds, "update", {...CONTEXT, trustedClientIds: ["c1"]}))
            .toEqual({success: true});
        expectFailure(enforce(principalWith({...BASE, allowed_trusted_clients: []}), withIds, "update", {...CONTEXT, trustedClientIds: ["c1"]}),
            422, "trusted_client_not_allowed");
        expectFailure(enforce(principalWith({...BASE, allowed_trusted_clients: ["c1"]}), withIds, "update", {...CONTEXT, trustedClientIds: []}),
            422, "trusted_client_not_allowed");
    });

    it("여러 id 중 하나라도 어긋나면 거부한다", () => {
        const two = tunnel({allowedClientIds: ["c1", "c2"]});
        expectFailure(enforce(principalWith({...BASE, allowed_trusted_clients: ["c1", "c2"]}), two, "update", {...CONTEXT, trustedClientIds: ["c1"]}),
            422, "trusted_client_not_allowed");
    });

    // 이슈 #99 표는 빈 목록을 통과로 적었지만 결정에 따라 거부로 바꿨다. 런타임 TunnelServer.getNextHandlerPool 은
    // allowedClientIds·allowedClientNames 가 모두 비면 연결된 모든 클라이언트를 후보로 삼으므로, 빈 목록은 곧
    // PRD §7 속성 7 의 슈퍼유저 전용 `*`(전체) 다. 일반 유저는 목록을 비워 그 권한을 얻을 수 없다.
    it.each([[[]], [undefined], [null]])("일반 유저의 allowedClientIds %j 는 그룹·등록 목록이 넓어도 거부한다", (ids) => {
        const wide = principalWith({...BASE, allowed_trusted_clients: ["c1", "c2"]});
        expectFailure(enforce(wide, tunnel({allowedClientIds: ids}), "update", {...CONTEXT, trustedClientIds: ["c1", "c2"]}),
            422, "trusted_client_not_allowed");
        expectFailure(enforce(wide, tunnel({allowedClientIds: ids}), "create", {ownedCount: 0, trustedClientIds: ["c1", "c2"]}),
            422, "trusted_client_not_allowed");
    });

    it.each([[[]], [undefined]])("슈퍼유저의 allowedClientIds %j 는 계속 허용한다", (ids) => {
        const superuser = principalWith({allowed_trusted_clients: []}, "superuser");
        expect(enforce(superuser, tunnel({allowedClientIds: ids}), "update", {ownedCount: 0, trustedClientIds: []})).toEqual({success: true});
        expect(enforce(superuser, tunnel({allowedClientIds: ids}), "create", {ownedCount: 0, trustedClientIds: []})).toEqual({success: true});
    });

    it("빈 목록 거부는 레거시 이름 검사 다음 단계에서 같은 코드로 나온다", () => {
        expectFailure(enforce(principalWith(BASE), tunnel({allowedClientNames: ["old"], allowedClientIds: []}), "update", CONTEXT),
            422, "legacy_client_names_not_allowed");
        const denied = enforce(principalWith(BASE), tunnel({allowedClientIds: []}), "update", CONTEXT);
        const notAllowed = enforce(principalWith(BASE), tunnel({allowedClientIds: ["c9"]}), "update", CONTEXT);
        expect(JSON.stringify(denied)).toBe(JSON.stringify(notAllowed));
    });

    // 등록된 clientId 목록이 응답으로 새면 안 된다. 어느 쪽에서 어긋났는지 구분하지 않고, 값이 메시지에 없는지 본다.
    it("거부 메시지는 두 원인을 구분하지 않고 등록된 id 를 담지 않는다", () => {
        const registered = "registered-client-id-that-must-not-leak";
        const notInGroup = enforce(principalWith({...BASE, allowed_trusted_clients: []}), tunnel({allowedClientIds: [registered]}), "update",
            {...CONTEXT, trustedClientIds: [registered, "another-registered-client-id"]});
        const notRegistered = enforce(principalWith({...BASE, allowed_trusted_clients: [registered]}), tunnel({allowedClientIds: [registered]}), "update",
            {...CONTEXT, trustedClientIds: ["another-registered-client-id"]});
        expectFailure(notInGroup, 422, "trusted_client_not_allowed");
        expectFailure(notRegistered, 422, "trusted_client_not_allowed");
        expect(JSON.stringify(notInGroup)).toBe(JSON.stringify(notRegistered));
        expect(JSON.stringify(notInGroup)).not.toContain("another-registered-client-id");
    });

    it.each([["c1"], [undefined], [null]])("형식이 틀린 allowed_trusted_clients %j 는 아무 id 도 허용하지 않는다", (group) => {
        expectFailure(enforce(principalWith({...BASE, allowed_trusted_clients: group}), withIds, "update", {...CONTEXT, trustedClientIds: ["c1"]}),
            422, "trusted_client_not_allowed");
    });

    it.each([["c1"], [[1]], [[null]], [{0: "c1"}]])("형식이 틀린 allowedClientIds %j 는 거부한다", (ids) => {
        expectFailure(enforce(principalWith({...BASE, allowed_trusted_clients: ["c1", "1"]}), tunnel({allowedClientIds: ids}), "update",
            {...CONTEXT, trustedClientIds: ["c1", "1"]}), 422, "trusted_client_not_allowed");
    });
});

describe("enforce: 리라이트 권한(http_tunnel_rewrite_permissions)", () => {
    const REWRITE = {...BASE, allowed_protocols: ["HTTP", "HTTP_REWRITE"]};
    const NONE = {cors: false, host: false, header: false, body: false};

    it.each([
        ["header", {customRequestHeaders: [{name: "X", value: "1", replace: false}]}],
        ["header", {customResponseHeaders: [{name: "X", value: "1", replace: false}]}],
        ["body", {bodyRewriteRules: [{from: "a", to: "b"}]}],
        ["cors", {replaceAccessControlAllowOrigin: true}],
        ["host", {rewriteHostInTextBody: true}]
    ])("%s 플래그가 꺼져 있으면 %j 를 거부하고 켜져 있으면 허용한다", (flag, httpOption) => {
        const option = tunnel({protocol: "http", httpOption});
        const denied = enforce(principalWith({...REWRITE, http_tunnel_rewrite_permissions: NONE}), option, "update", CONTEXT);
        expectFailure(denied, 422, "rewrite_not_allowed");
        expect((denied as {message: string}).message).toContain(flag);
        expect(enforce(principalWith({...REWRITE, http_tunnel_rewrite_permissions: {...NONE, [flag]: true}}), option, "update", CONTEXT))
            .toEqual({success: true});
    });

    it("한 플래그의 권한이 다른 플래그를 허용하지 않는다", () => {
        const option = tunnel({protocol: "http", httpOption: {rewriteHostInTextBody: true}});
        const allButHost = {cors: true, host: false, header: true, body: true};
        expectFailure(enforce(principalWith({...REWRITE, http_tunnel_rewrite_permissions: allButHost}), option, "update", CONTEXT),
            422, "rewrite_not_allowed");
    });

    it.each([[undefined], [null], [{cors: "true", host: "true", header: "true", body: "true"}], [{cors: 1, host: 1, header: 1, body: 1}]])(
        "형식이 틀린 권한 %j 은 아무 리라이트도 허용하지 않는다", (permissions) => {
            const option = tunnel({protocol: "http", httpOption: {replaceAccessControlAllowOrigin: true}});
            expectFailure(enforce(principalWith({...REWRITE, http_tunnel_rewrite_permissions: permissions}), option, "update", CONTEXT),
                422, "rewrite_not_allowed");
        });

    it("true 가 아닌 켜짐 값(1)으로 보낸 리라이트도 권한을 요구한다", () => {
        const option = tunnel({protocol: "http", httpOption: {replaceAccessControlAllowOrigin: 1}});
        expectFailure(enforce(principalWith({...REWRITE, http_tunnel_rewrite_permissions: NONE}), option, "update", CONTEXT),
            422, "rewrite_not_allowed");
    });
});

describe("enforce: 검사 순서와 속성 간 격리", () => {
    const WIDE_OPEN_EXCEPT = (overrides: Record<string, any>) => principalWith({
        max_tunnel_count: 100,
        allowed_port_range: [{from: 1, to: 65535}],
        allowed_protocols: ["TCP", "HTTP", "HTTPS", "HTTP_REWRITE"],
        allowed_trusted_clients: ["c1"],
        http_tunnel_rewrite_permissions: {cors: true, host: true, header: true, body: true},
        ...overrides
    });
    const ctx = {ownedCount: 0, trustedClientIds: ["c1"]};

    it("첫 실패에서 멈추며 표의 순서를 따른다", () => {
        const everythingWrong = tunnel({
            forwardPort: 30000, protocol: "http", allowedClientNames: ["old"], allowedClientIds: ["c9"],
            httpOption: {rewriteHostInTextBody: true}
        });
        const strict = principalWith({max_tunnel_count: 1, allowed_port_range: [{from: 20000, to: 20099}], allowed_protocols: ["TCP"]});
        expectFailure(enforce(strict, everythingWrong, "create", {ownedCount: 1, trustedClientIds: []}), 409, "tunnel_count_exceeded");
        expectFailure(enforce(strict, everythingWrong, "update", {ownedCount: 1, trustedClientIds: []}), 422, "port_not_allowed");
        expectFailure(enforce(strict, tunnel({...everythingWrong, forwardPort: 20010}), "update", CONTEXT), 422, "protocol_not_allowed");
        expectFailure(enforce(strict, tunnel({forwardPort: 20010, allowedClientNames: ["old"], allowedClientIds: ["c9"]}), "update", CONTEXT),
            422, "legacy_client_names_not_allowed");
        expectFailure(enforce(principalWith({...BASE, allowed_protocols: ["HTTP", "HTTP_REWRITE"]}),
            tunnel({protocol: "http", allowedClientIds: ["c9"], httpOption: {rewriteHostInTextBody: true}}), "update", CONTEXT),
            422, "trusted_client_not_allowed");
    });

    it.each([
        ["max_tunnel_count", {max_tunnel_count: 0}, "create", 409, "tunnel_count_exceeded"],
        ["allowed_port_range", {allowed_port_range: []}, "update", 422, "port_not_allowed"],
        ["allowed_protocols", {allowed_protocols: ["TCP", "HTTPS", "HTTP_REWRITE"]}, "update", 422, "protocol_not_allowed"],
        ["allowed_trusted_clients", {allowed_trusted_clients: []}, "update", 422, "trusted_client_not_allowed"],
        ["http_tunnel_rewrite_permissions", {http_tunnel_rewrite_permissions: {cors: true, host: false, header: true, body: true}}, "update", 422, "rewrite_not_allowed"]
    ])("나머지를 모두 넓게 열어도 %s 하나만 좁히면 그 코드로 거부된다", (_attribute, narrowed, mode, status, code) => {
        const option = tunnel({forwardPort: 20010, protocol: "http", allowedClientIds: ["c1"], httpOption: {rewriteHostInTextBody: true}});
        expect(enforce(WIDE_OPEN_EXCEPT({}), option, mode as "create" | "update", ctx)).toEqual({success: true});
        expectFailure(enforce(WIDE_OPEN_EXCEPT(narrowed), option, mode as "create" | "update", ctx), status as number, code as string);
    });

    it("집행 대상이 아닌 속성(기간·동시 연결·속도·가시성·CRUD·섹션)은 판정에 영향을 주지 않는다", () => {
        const option = tunnel({forwardPort: 20010, protocol: "http", allowedClientIds: ["c1"], httpOption: {rewriteHostInTextBody: true}});
        const unrelated = WIDE_OPEN_EXCEPT({
            max_tunnel_duration_ms: 1, max_concurrent_connections: 0, rate_limit: "1MB/s",
            tunnel_visibility: "group_read", tunnel_crud: "none", admin_ui_section_access: []
        });
        expect(enforce(unrelated, option, "create", ctx)).toEqual({success: true});
    });
});

describe("enforce: 잘못된 사용은 즉시 실패한다", () => {
    it.each(["delete", "", "CREATE", undefined])("mode %j 는 TypeError 다", (mode) => {
        expect(() => enforce(principalWith(BASE), TCP, mode as any, CONTEXT)).toThrow(TypeError);
    });

    it.each([[NaN], [-1], [1.5], ["1"], [undefined]])("ownedCount %j 는 TypeError 다", (ownedCount) => {
        expect(() => enforce(principalWith(BASE), TCP, "update", {ownedCount: ownedCount as any, trustedClientIds: []})).toThrow(TypeError);
    });

    it.each([[undefined], ["c1"], [["c1", 2]]])("trustedClientIds %j 는 TypeError 다", (trustedClientIds) => {
        expect(() => enforce(principalWith(BASE), TCP, "update", {ownedCount: 0, trustedClientIds: trustedClientIds as any})).toThrow(TypeError);
    });
});

describe("enforce: 형식이 틀린 입력은 거부 쪽으로 떨어진다", () => {
    const REWRITE = {...BASE, allowed_protocols: ["HTTP", "HTTP_REWRITE"]};

    // httpOption 이 객체가 아니면 어느 리라이트를 뜻하는지 알 수 없으므로 모두 요청한 것으로 본다.
    it.each([["x"], [[]], [1], [true]])("객체가 아닌 httpOption %j 은 리라이트를 요구한다", (httpOption) => {
        expect(requiredProtocols(tunnel({protocol: "http", httpOption}))).toEqual(["HTTP", "HTTP_REWRITE"]);
        expectFailure(enforce(principalWith({...REWRITE, http_tunnel_rewrite_permissions: {cors: false, host: false, header: false, body: false}}),
            tunnel({protocol: "http", httpOption}), "update", CONTEXT), 422, "rewrite_not_allowed");
    });

    it("주체에 속성 객체가 없으면 아무것도 허용하지 않는다", () => {
        const bare = {...principalWith(BASE), attributes: undefined as any};
        expectFailure(enforce(bare, TCP, "create", {...CONTEXT, ownedCount: 0}), 409, "tunnel_count_exceeded");
        expectFailure(enforce(bare, TCP, "update", CONTEXT), 422, "port_not_allowed");
    });

    it.each([[null], ["tunnel"], [[]]])("일반 유저에게 객체가 아닌 터널 %j 을 넘기면 TypeError 다", (next) => {
        expect(() => enforce(principalWith(BASE), next as any, "update", CONTEXT)).toThrow(TypeError);
    });
});
