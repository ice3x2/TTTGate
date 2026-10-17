import {parseHash, type Route} from "../../admin/src/router";

// 앞의 '#' 는 있어도 없어도 결과가 같다.
const variant = (hash: string): string => hash.startsWith("#") ? hash.slice(1) : `#${hash}`;

const CASES: ReadonlyArray<readonly [string, Route]> = [
    ["", {screen: "status"}],
    ["#", {screen: "status"}],
    ["#/", {screen: "status"}],
    ["#/status", {screen: "status"}],
    ["#/tunnels", {screen: "tunnels"}],
    ["#/tunnels/new", {screen: "tunnel-edit", param: "new"}],
    ["#/tunnels/1", {screen: "tunnel-edit", param: "1"}],
    ["#/tunnels/20001", {screen: "tunnel-edit", param: "20001"}],
    ["#/tunnels/65535", {screen: "tunnel-edit", param: "65535"}],
    ["#/tunnels/0", {screen: "tunnels"}],
    ["#/tunnels/65536", {screen: "tunnels"}],
    ["#/tunnels/abc", {screen: "tunnels"}],
    ["#/tunnels/007", {screen: "tunnels"}],
    ["#/server", {screen: "server"}],
    ["#/unknown", {screen: "status"}],
    ["#/status/x", {screen: "status"}],
    ["#/server/1", {screen: "status"}],
    // #103 (U3-01) 사용자·그룹·내 계정·거부 화면.
    ["#/users", {screen: "users"}],
    ["#/users/new", {screen: "user-edit", param: "new"}],
    ["#/users/u_0123456789abcdef", {screen: "user-edit", param: "u_0123456789abcdef"}],
    ["#/users/u_123", {screen: "users"}],
    ["#/audit", {screen: "audit"}],
    ["#/sessions", {screen: "sessions"}],
    ["#/users/u_0123456789ABCDEF", {screen: "users"}],
    ["#/users/alice", {screen: "users"}],
    ["#/groups", {screen: "groups"}],
    ["#/groups/new", {screen: "group-edit", param: "new"}],
    ["#/groups/g_0123456789abcdef", {screen: "group-edit", param: "g_0123456789abcdef"}],
    ["#/groups/default", {screen: "group-edit", param: "default"}],
    ["#/groups/system:superuser", {screen: "group-edit", param: "system:superuser"}],
    ["#/groups/other", {screen: "groups"}],
    ["#/me", {screen: "me"}],
    ["#/me/password", {screen: "me-password"}],
    ["#/denied", {screen: "denied"}],
];

describe("parseHash", () => {
    test.each(CASES.map(([hash, route]) => [JSON.stringify(hash), hash, route] as const))(
        "%s 는 지정된 Route 로 해석된다", (_label, hash, route) => {
            expect(parseHash(hash)).toEqual(route);
        });

    test.each(CASES.map(([hash, route]) => [JSON.stringify(variant(hash)), variant(hash), route] as const))(
        "%s 는 '#' 유무와 무관하게 같은 Route 로 해석된다", (_label, hash, route) => {
            expect(parseHash(hash)).toEqual(route);
        });
});
