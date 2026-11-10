import {LifetimeContext, maxActiveSeconds} from "../../../../src/server/security/TunnelLifetimePolicy";

type Owner = ReturnType<LifetimeContext['ownerOf']>;

/** 포트 1 하나만 아는 가짜 컨텍스트. 그룹 g 의 max_tunnel_duration_ms 를 지정한다. */
const contextOf = (owner: Owner, maxTunnelDurationMs: number): LifetimeContext => ({
    ownerOf: (port) => (port === 1 ? owner : undefined),
    groupAttributes: () => ({max_tunnel_duration_ms: maxTunnelDurationMs}),
    activatorOf: () => undefined
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
            groupAttributes: (groupId) => { asked.push(`group:${groupId}`); return {max_tunnel_duration_ms: 3000}; },
            activatorOf: () => undefined
        };
        expect(maxActiveSeconds(20001, context)).toBe(3);
        expect(asked).toEqual(["owner:20001", "group:g_field"]);
    });
});

// 이슈 347 FR-14 — 상한은 소유자 그룹 상한과 켠 사람 그룹 상한 중 더 짧은 값이다. 상한이 없는 쪽은 비교에서 뺀다.
describe("maxActiveSeconds: 켠 사람 (이슈 347)", () => {
    const HOUR_MS = 3_600_000;
    const LIMITS: Record<string, number> = {g_owner: 8 * HOUR_MS, g_short: 2 * HOUR_MS, g_open: 0};
    const ACTIVATORS: Record<string, {groupId: string; role: "regular" | "superuser"}> = {
        u_short: {groupId: "g_short", role: "regular"},
        u_open: {groupId: "g_open", role: "regular"},
        u_root: {groupId: "g_short", role: "superuser"}
    };
    const contextWith = (owner: Owner): LifetimeContext => ({
        ownerOf: () => owner,
        groupAttributes: (groupId) => ({max_tunnel_duration_ms: LIMITS[groupId]}),
        activatorOf: (userId) => ACTIVATORS[userId]
    });
    const owner = {userId: "u_owner", groupId: "g_owner", role: "regular" as const};

    it("둘 다 상한이 있으면 더 짧은 값이다 (AC-7)", () => {
        expect(maxActiveSeconds(1, contextWith(owner), "u_short")).toBe(2 * 3600);
    });

    it("켠 사람이 슈퍼유저이거나 그룹 상한이 0 이면 소유자 상한만 쓴다 (AC-7)", () => {
        expect(maxActiveSeconds(1, contextWith(owner), "u_root")).toBe(8 * 3600);
        expect(maxActiveSeconds(1, contextWith(owner), "u_open")).toBe(8 * 3600);
    });

    it("켠 사람이 없거나 찾을 수 없으면(삭제·권한 상실) 소유자 상한만 쓴다 (FR-15)", () => {
        expect(maxActiveSeconds(1, contextWith(owner))).toBe(8 * 3600);
        expect(maxActiveSeconds(1, contextWith(owner), "u_gone")).toBe(8 * 3600);
    });

    it("소유자 상한이 없으면(system:migrated·슈퍼유저) 켠 사람 상한만 쓰고, 둘 다 없으면 제한이 없다", () => {
        expect(maxActiveSeconds(1, contextWith(undefined), "u_short")).toBe(2 * 3600);
        expect(maxActiveSeconds(1, contextWith({userId: "u_admin", groupId: "g_owner", role: "superuser"}), "u_short")).toBe(2 * 3600);
        expect(maxActiveSeconds(1, contextWith(undefined), "u_open")).toBeUndefined();
    });

    it("켠 사람을 그 포트와 함께 조회한다(켜기 권한은 포트마다 다르다)", () => {
        const asked: string[] = [];
        const context: LifetimeContext = {...contextWith(owner), activatorOf: (userId, port) => { asked.push(`${userId}@${port}`); return undefined; }};
        maxActiveSeconds(20001, context, "u_short");
        expect(asked).toEqual(["u_short@20001"]);
    });
});
