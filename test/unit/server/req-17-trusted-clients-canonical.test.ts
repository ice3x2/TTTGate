/**
 * P7-T1 / REQ-17 — trustedClients 변경 감지 canonical 비교.
 *
 * JSON.stringify 기반 단순 비교는 배열 요소 순서 또는 객체 키 순서가 달라지면
 * 내용이 동일해도 "변경"으로 오탐하여 불필요한 터널 재시작을 유발한다.
 * ObjectUtil.canonicalEquals 는 키 정렬 + 배열 요소 정렬 기반 canonical 직렬화로
 * 이 오탐을 제거한다. 본 테스트는 실제 ObjectUtil을 그대로 사용한다 (Mock 금지).
 */
import ObjectUtil from "../../../src/util/ObjectUtil";

describe("REQ-17: trustedClients canonical equality", () => {
    it("배열 요소 순서 및 객체 키 순서만 다른 동일 내용은 변경 없음(true)으로 판정한다", () => {
        const a = [
            { clientId: "alpha", clientSecret: "s1", displayName: "Alpha" },
            { clientId: "beta",  clientSecret: "s2", displayName: "Beta" }
        ];
        const b = [
            { displayName: "Beta",  clientSecret: "s2", clientId: "beta"  },
            { clientSecret: "s1", displayName: "Alpha", clientId: "alpha" }
        ];
        expect(ObjectUtil.canonicalEquals(a, b)).toBe(true);
    });

    it("요소의 실제 값이 변경되면 변경 있음(false)으로 판정한다", () => {
        const a = [{ clientId: "alpha", clientSecret: "s1" }];
        const b = [{ clientId: "alpha", clientSecret: "s1-ROTATED" }];
        expect(ObjectUtil.canonicalEquals(a, b)).toBe(false);
    });

    it("요소가 추가되거나 제거되면 변경 있음(false)으로 판정한다", () => {
        const base = [{ clientId: "alpha", clientSecret: "s1" }];
        const added = [
            { clientId: "alpha", clientSecret: "s1" },
            { clientId: "beta",  clientSecret: "s2" }
        ];
        expect(ObjectUtil.canonicalEquals(base, added)).toBe(false);
        expect(ObjectUtil.canonicalEquals(added, base)).toBe(false);
    });

    it("빈 배열과 undefined(?? [])는 변경 없음(true)으로 판정한다", () => {
        expect(ObjectUtil.canonicalEquals([], [])).toBe(true);
    });
});
