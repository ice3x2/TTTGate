import {LifetimeContext, maxActiveSeconds} from "../../../../src/server/security/TunnelLifetimePolicy";

type Owner = ReturnType<LifetimeContext['ownerOf']>;

/** 포트 1 하나만 아는 가짜 컨텍스트. 그룹 g 의 max_tunnel_duration_ms 를 지정한다. */
const contextOf = (owner: Owner, maxTunnelDurationMs: number): LifetimeContext => ({
    ownerOf: (port) => (port === 1 ? owner : undefined),
    groupAttributes: () => ({max_tunnel_duration_ms: maxTunnelDurationMs})
});

const regular = {userId: "u_alice", groupId: "g_field", role: "regular" as const};
const superuser = {userId: "u_admin", groupId: "g_superusers", role: "superuser" as const};

describe("maxActiveSeconds", () => {
    it("소유자가 없으면(system:migrated) 상한이 없다", () => {
        expect(maxActiveSeconds(1, contextOf(undefined, 5000))).toBeUndefined();
    });

    it("슈퍼유저 소유는 그룹 값이 있어도 상한이 없다", () => {
        expect(maxActiveSeconds(1, contextOf(superuser, 5000))).toBeUndefined();
    });

    it("일반 유저라도 그룹 값이 0 이면 상한이 없다", () => {
        expect(maxActiveSeconds(1, contextOf(regular, 0))).toBeUndefined();
        expect(maxActiveSeconds(1, contextOf(regular, -1))).toBeUndefined();
    });

    it("밀리초를 초로 올림한다", () => {
        expect(maxActiveSeconds(1, contextOf(regular, 2000))).toBe(2);
        expect(maxActiveSeconds(1, contextOf(regular, 1500))).toBe(2);
        expect(maxActiveSeconds(1, contextOf(regular, 1))).toBe(1);
        expect(maxActiveSeconds(1, contextOf(regular, 43_200_000))).toBe(43200);
    });

    it("소유자를 그 포트로 조회하고 그 그룹의 속성을 읽는다", () => {
        const asked: Array<string> = [];
        const context: LifetimeContext = {
            ownerOf: (port) => { asked.push(`owner:${port}`); return regular; },
            groupAttributes: (groupId) => { asked.push(`group:${groupId}`); return {max_tunnel_duration_ms: 3000}; }
        };
        expect(maxActiveSeconds(20001, context)).toBe(3);
        expect(asked).toEqual(["owner:20001", "group:g_field"]);
    });
});
