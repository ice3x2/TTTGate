import {
    addSharedUser,
    candidatesOf,
    MAX_SHARED_USERS,
    moveActive,
    removeSharedUser,
    SHARE_SEARCH_DELAY_MS,
    shareQueryOf
} from "../../admin/src/screens/parts/shareUsers";

// 이슈 347 FR-10 — 터널 편집 화면의 공유 칸(자동 완성) 규칙. 순수 함수라 브라우저 없이 확인한다.
const user = (id: string, username = id) => ({id, username, displayName: username.toUpperCase()});

describe("shareQueryOf — 검색할 값", () => {
    test("앞뒤 공백을 빼고 2자부터 검색한다", () => {
        expect(shareQueryOf(" b ")).toBeUndefined();
        expect(shareQueryOf("")).toBeUndefined();
        expect(shareQueryOf(" bo ")).toBe("bo");
    });
    test("64자를 넘으면 검색하지 않는다(서버가 422 를 낸다)", () => {
        expect(shareQueryOf("x".repeat(64))).toBe("x".repeat(64));
        expect(shareQueryOf("x".repeat(65))).toBeUndefined();
    });
    test("검색은 입력이 250ms 멈춘 뒤에 한다", () => {
        expect(SHARE_SEARCH_DELAY_MS).toBe(250);
    });
});

describe("moveActive — 위·아래 화살표", () => {
    test("아래는 다음, 위는 이전이며 끝에서 처음으로 돈다", () => {
        expect(moveActive(-1, "ArrowDown", 3)).toBe(0);
        expect(moveActive(0, "ArrowDown", 3)).toBe(1);
        expect(moveActive(2, "ArrowDown", 3)).toBe(0);
        expect(moveActive(-1, "ArrowUp", 3)).toBe(2);
        expect(moveActive(0, "ArrowUp", 3)).toBe(2);
    });
    test("결과가 없으면 고른 것이 없다", () => {
        expect(moveActive(0, "ArrowDown", 0)).toBe(-1);
    });
});

describe("candidatesOf — 목록에 보일 결과", () => {
    test("이미 고른 사용자와 소유자는 뺀다", () => {
        const results = [user("u_a"), user("u_b"), user("u_owner")];
        expect(candidatesOf(results, [user("u_b")], "u_owner").map((entry) => entry.id)).toEqual(["u_a"]);
    });
});

describe("addSharedUser·removeSharedUser — 칩", () => {
    test("더하면 끝에 붙고 같은 사용자는 다시 더하지 않는다", () => {
        const once = addSharedUser([user("u_a")], user("u_b"));
        expect(once.map((entry) => entry.id)).toEqual(["u_a", "u_b"]);
        expect(addSharedUser(once, user("u_a"))).toBe(once);
    });
    test(`${MAX_SHARED_USERS}명이 차면 더하지 않는다`, () => {
        const full = Array.from({length: MAX_SHARED_USERS}, (_, index) => user(`u_${index}`));
        expect(addSharedUser(full, user("u_new"))).toBe(full);
    });
    test("빼면 그 사용자만 빠진다", () => {
        expect(removeSharedUser([user("u_a"), user("u_b")], "u_a").map((entry) => entry.id)).toEqual(["u_b"]);
    });
});
