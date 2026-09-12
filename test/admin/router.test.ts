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
