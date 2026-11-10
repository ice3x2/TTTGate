import {LOOKUP_LIMIT, lookupUsers, parseLookupQuery} from "../../../../src/server/rbac/UserLookup";
import {User} from "../../../../src/server/rbac/IdentityTypes";

// 이슈 347 FR-9 — 공유할 사용자를 고르는 검색. 저장소를 모르는 순수 함수다.
const userOf = (id: string, username: string, displayName: string, patch: Partial<User> = {}): User => ({
    id, username, displayName, role: "regular", status: "active", groupId: "default", passwordHash: "$2b$04$hash",
    mustChangePassword: false, migratedFromLegacyAdmin: false, migrationAcknowledged: true, createdAt: 1, updatedAt: 1, ...patch
});

const caller = {userId: "u_me", role: "regular" as const};

describe("parseLookupQuery", () => {
    it("앞뒤 공백을 빼고 2~64자만 받는다", () => {
        expect(parseLookupQuery("  bo ")).toEqual({success: true, query: "bo"});
        expect(parseLookupQuery("x".repeat(64))).toEqual({success: true, query: "x".repeat(64)});
        for(const raw of [null, "", " b ", "x".repeat(65)]) {
            expect({raw, result: parseLookupQuery(raw)}).toMatchObject({raw, result: {success: false, status: 422, code: "query_invalid"}});
        }
    });
});

describe("lookupUsers", () => {
    it("사용자 이름이나 표시 이름에 대소문자 없이 포함되면 찾고, id·username·displayName 만 준다", () => {
        const users = [userOf("u_1", "robert", "Bob Lee"), userOf("u_2", "alice", "Alice"), userOf("u_3", "carol", "Carol BOBBY")];
        expect(lookupUsers(users, "BOB", caller)).toEqual([
            {id: "u_1", username: "robert", displayName: "Bob Lee"},
            {id: "u_3", username: "carol", displayName: "Carol BOBBY"}
        ]);
    });

    it("앞부분이 일치하는 결과를 먼저 두고, 같은 무리 안에서는 사용자 이름 순이다", () => {
        const users = [userOf("u_1", "zbob", "Z"), userOf("u_2", "bobby", "B2"), userOf("u_3", "abob", "A"), userOf("u_4", "bob", "B1")];
        expect(lookupUsers(users, "bob", caller).map((user) => user.username)).toEqual(["bob", "bobby", "abob", "zbob"]);
    });

    it("비활성 사용자와 호출자 자신을 뺀다 (AC-12)", () => {
        const users = [userOf("u_me", "bobself", "Me"), userOf("u_1", "bobby", "B", {status: "disabled"}), userOf("u_2", "bobo", "B", {groupId: "g_other"})];
        expect(lookupUsers(users, "bob", caller).map((user) => user.id)).toEqual(["u_2"]);
    });

    it("슈퍼유저가 아닌 호출자에게는 슈퍼유저를 빼고, 슈퍼유저 호출자에게는 준다 (AC-5)", () => {
        const users = [userOf("u_root", "bobroot", "Root", {role: "superuser"}), userOf("u_1", "bobby", "B")];
        expect(lookupUsers(users, "bob", caller).map((user) => user.id)).toEqual(["u_1"]);
        expect(lookupUsers(users, "bob", {userId: "u_admin", role: "superuser"}).map((user) => user.id)).toEqual(["u_1", "u_root"]);
    });

    it(`결과는 ${LOOKUP_LIMIT}개까지다`, () => {
        const users = Array.from({length: LOOKUP_LIMIT + 5}, (_, index) => userOf(`u_${index}`, `bob${String(index).padStart(2, "0")}`, "B"));
        expect(lookupUsers(users, "bob", caller)).toHaveLength(LOOKUP_LIMIT);
    });
});
