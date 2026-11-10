import {
    MAX_SHARED_USERS,
    normalizeSharedUserIds,
    resolveSharedUserIds,
    sharedUserIdsOf,
    sharedUsersChange
} from "../../../../src/server/rbac/TunnelSharing";

// 이슈 347 FR-5·FR-7 — 공유 목록의 읽기·검증 규칙. 저장소를 모르는 순수 함수다.
const OWNER = "u_owner";

describe("sharedUserIdsOf", () => {
    it("없거나 배열이 아니면 빈 목록으로 읽는다 (§6 호환)", () => {
        expect(sharedUserIdsOf({})).toEqual([]);
        expect(sharedUserIdsOf({sharedUserIds: "u_a"})).toEqual([]);
    });

    it("문자열이 아닌 항목은 버린다", () => {
        expect(sharedUserIdsOf({sharedUserIds: ["u_a", 3, null, "u_b"]})).toEqual(["u_a", "u_b"]);
    });
});

describe("normalizeSharedUserIds", () => {
    it("중복과 소유자를 빼고 처음 나온 순서를 지킨다", () => {
        expect(normalizeSharedUserIds(["u_b", OWNER, "u_a", "u_b"], OWNER)).toEqual(["u_b", "u_a"]);
    });
});

describe("resolveSharedUserIds", () => {
    type Subject = {role: "regular" | "superuser"; status: "active" | "disabled"};
    const USERS: Record<string, Subject> = {
        u_a: {role: "regular", status: "active"}, u_b: {role: "regular", status: "active"}, u_c: {role: "regular", status: "active"},
        [OWNER]: {role: "regular", status: "active"}, u_root: {role: "superuser", status: "active"}, u_off: {role: "regular", status: "disabled"}
    };
    const userOf = (id: string) => USERS[id];
    const resolve = (requested: unknown, stored: string[] = []) => resolveSharedUserIds(requested, {ownerId: OWNER, stored, userOf});

    it("정규화한 목록을 돌려준다", () => {
        expect(resolve(["u_a", "u_a", OWNER, "u_c"])).toEqual({success: true, ids: ["u_a", "u_c"]});
    });

    it("배열이 아니거나 문자열이 아닌 항목이 있으면 422 shared_users_invalid 다", () => {
        for(const value of ["u_a", null, {}, ["u_a", 1]]) {
            expect({value, result: resolve(value)})
                .toMatchObject({value, result: {success: false, status: 422, code: "shared_users_invalid"}});
        }
    });

    it("없는(삭제된) 사용자 id 를 새로 넣으면 422 shared_user_not_found 다 (FR-7)", () => {
        expect(resolve(["u_a", "u_gone"])).toMatchObject({success: false, status: 422, code: "shared_user_not_found"});
    });

    it("슈퍼유저나 비활성 사용자를 새로 넣으면 같은 422 다. 이미 저장된 id 는 그대로 받는다", () => {
        expect(resolve(["u_root"])).toMatchObject({success: false, status: 422, code: "shared_user_not_found"});
        expect(resolve(["u_off"])).toMatchObject({success: false, status: 422, code: "shared_user_not_found"});
        expect(resolve(["u_root", "u_off", "u_a"], ["u_root", "u_off"])).toEqual({success: true, ids: ["u_root", "u_off", "u_a"]});
    });

    it("저장된 id 가 사라진 사용자면 거절하지 않고 조용히 뺀다", () => {
        expect(resolve(["u_gone", "u_a"], ["u_gone"])).toEqual({success: true, ids: ["u_a"]});
    });

    it("본문에 없으면 저장된 목록을 새 소유자 기준으로 정규화하고 사라진 사용자를 뺀다", () => {
        expect(resolve(undefined, ["u_a", OWNER, "u_gone", "u_root"])).toEqual({success: true, ids: ["u_a", "u_root"]});
    });

    it(`중복을 뺀 뒤 ${MAX_SHARED_USERS}명까지 받고 넘으면 422 shared_users_too_many 다`, () => {
        const ids = Array.from({length: MAX_SHARED_USERS + 1}, (_, index) => `u_${index}`);
        const all = (id: string) => (id.startsWith("u_") ? {role: "regular" as const, status: "active" as const} : undefined);
        const resolveAll = (requested: string[]) => resolveSharedUserIds(requested, {ownerId: OWNER, stored: [], userOf: all});
        expect(resolveAll(ids.slice(0, MAX_SHARED_USERS))).toMatchObject({success: true});
        expect(resolveAll([...ids.slice(0, MAX_SHARED_USERS), ids[0]])).toMatchObject({success: true});
        expect(resolveAll(ids)).toMatchObject({success: false, status: 422, code: "shared_users_too_many"});
    });
});

describe("sharedUsersChange", () => {
    it("더해진 id 와 빠진 id 를 나눈다 (FR-16)", () => {
        expect(sharedUsersChange(["u_a", "u_b"], ["u_b", "u_c"])).toEqual({added: ["u_c"], removed: ["u_a"]});
        expect(sharedUsersChange([], [])).toEqual({added: [], removed: []});
    });
});
