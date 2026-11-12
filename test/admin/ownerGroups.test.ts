import type {Options} from "../../admin/src/controller/Options";
import {ownerGroups} from "../../admin/src/screens/parts/ownerGroups";
import {translator} from "../../admin/src/i18n";

// 이슈 367 FR-2~FR-4·FR-7 — 터널 목록을 소유자별로 묶는 순수 함수.
const ME = "u_root";
const tunnel = (port: number, owner?: Options["owner"]): Options => ({forwardPort: port, protocol: "tcp", destinationAddress: "127.0.0.1",
    destinationPort: 22, owner} as Options);
const root = {id: ME, username: "root", displayName: "관리자"};
const alice = {id: "u_alice", username: "alice", displayName: "앨리스"};
const bob = {id: "u_bob", username: "bob", displayName: "bob"};
const migrated = {id: "system:migrated"};
const gone = {id: "u_gone"};

describe("ownerGroups", () => {
    const en = translator("en");

    test("AC-3 소유자가 하나뿐이면 묶지 않는다(머리글 없음)", () => {
        const result = ownerGroups([tunnel(1, root), tunnel(2, root)], ME, en);
        expect(result.grouped).toBe(false);
        expect(result.groups).toHaveLength(1);
        expect(result.groups[0].options.map((option) => option.forwardPort)).toEqual([1, 2]);
    });

    test("AC-1·AC-5 순서는 나 → 다른 사용자(아이디 순) → 업그레이드 전 터널 → 소유자 없음이고, 묶음 안은 서버 순서다", () => {
        const result = ownerGroups([tunnel(5, gone), tunnel(4, migrated), tunnel(3, bob), tunnel(2, alice), tunnel(6, root), tunnel(1, root), tunnel(7, alice)], ME, en);
        expect(result.grouped).toBe(true);
        expect(result.groups.map((group) => [group.kind, group.title, group.options.map((option) => option.forwardPort)])).toEqual([
            ["me", "root (관리자)", [6, 1]],
            ["user", "alice (앨리스)", [2, 7]],
            ["user", "bob", [3]],
            ["migrated", "Tunnels from before the upgrade", [4]],
            ["unknown", "No owner", [5]],
        ]);
    });

    test("표시 이름이 비었거나 아이디와 같으면 괄호를 생략하고, 머리글 키는 소유자 id 다", () => {
        const result = ownerGroups([tunnel(1, {id: "u_c", username: "carol", displayName: ""}), tunnel(2, bob)], ME, en);
        expect(result.groups.map((group) => [group.key, group.title])).toEqual([["u_bob", "bob"], ["u_c", "carol"]]);
    });

    test("AC-4 공유받은 일반 사용자도 소유자가 둘 이상이면 묶는다", () => {
        const result = ownerGroups([tunnel(1, {id: "u_me", username: "me", displayName: "나"}), tunnel(2, alice)], "u_me", en);
        expect(result.grouped).toBe(true);
        expect(result.groups.map((group) => group.kind)).toEqual(["me", "user"]);
    });

    test("소유자 정보가 없는 옛 서버 응답은 묶지 않는다", () => {
        expect(ownerGroups([tunnel(1), tunnel(2)], ME, en).grouped).toBe(false);
    });

    test("한국어 머리글", () => {
        const ko = translator("ko");
        const result = ownerGroups([tunnel(1, migrated), tunnel(2, gone), tunnel(3, root)], ME, ko);
        expect(result.groups.map((group) => group.title)).toEqual(["root (관리자)", "업그레이드 전 터널", "소유자 없음"]);
    });
});
