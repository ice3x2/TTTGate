import {
    MAX_SHARED_USERS,
    normalizeSharedUserIds,
    resolveSharedUserIds,
    sharedUserIdsOf,
    sharedUsersChange
} from "../../../../src/server/rbac/TunnelSharing";

// 이슈 347 FR-5·FR-7 — 공유 목록의 읽기·검증 규칙. 저장소를 모르는 순수 함수다.
const OWNER = "u_owner";
const known = new Set(["u_a", "u_b", "u_c", OWNER]);
const exists = (id: string) => known.has(id);

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
    it("정규화한 목록을 돌려준다", () => {
        expect(resolveSharedUserIds(["u_a", "u_a", OWNER, "u_c"], OWNER, exists)).toEqual({success: true, ids: ["u_a", "u_c"]});
    });

    it("배열이 아니거나 문자열이 아닌 항목이 있으면 422 shared_users_invalid 다", () => {
        for(const value of ["u_a", null, {}, ["u_a", 1]]) {
            expect({value, result: resolveSharedUserIds(value, OWNER, exists)})
                .toMatchObject({value, result: {success: false, status: 422, code: "shared_users_invalid"}});
        }
    });

    it("없는(삭제된) 사용자 id 는 422 shared_user_not_found 다 (FR-7)", () => {
        expect(resolveSharedUserIds(["u_a", "u_gone"], OWNER, exists))
            .toMatchObject({success: false, status: 422, code: "shared_user_not_found"});
    });

    it(`중복을 뺀 뒤 ${MAX_SHARED_USERS}명까지 받고 넘으면 422 shared_users_too_many 다`, () => {
        const ids = Array.from({length: MAX_SHARED_USERS + 1}, (_, index) => `u_${index}`);
        const all = (id: string) => id.startsWith("u_");
        expect(resolveSharedUserIds(ids.slice(0, MAX_SHARED_USERS), OWNER, all)).toMatchObject({success: true});
        expect(resolveSharedUserIds([...ids.slice(0, MAX_SHARED_USERS), ids[0]], OWNER, all)).toMatchObject({success: true});
        expect(resolveSharedUserIds(ids, OWNER, all)).toMatchObject({success: false, status: 422, code: "shared_users_too_many"});
    });
});

describe("sharedUsersChange", () => {
    it("더해진 id 와 빠진 id 를 나눈다 (FR-16)", () => {
        expect(sharedUsersChange(["u_a", "u_b"], ["u_b", "u_c"])).toEqual({added: ["u_c"], removed: ["u_a"]});
        expect(sharedUsersChange([], [])).toEqual({added: [], removed: []});
    });
});
