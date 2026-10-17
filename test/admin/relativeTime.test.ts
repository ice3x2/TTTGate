import {formatLocal, relativeTime} from "../../admin/src/util/relativeTime";

// U4-06 / #114 — 상대 시각과 로컬 시각 표기(순수 함수).
describe("relativeTime", () => {
    const now = 1_760_000_000_000;

    test("초·분·시·일 단위로 줄여 쓴다", () => {
        expect(relativeTime(now - 30_000, now)).toBe("just now");
        expect(relativeTime(now - 5 * 60_000, now)).toBe("5 min ago");
        expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3 h ago");
        expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2 d ago");
    });

    test("경계값: 59초는 just now, 60분은 1 h ago, 미래 시각은 just now", () => {
        expect(relativeTime(now - 59_999, now)).toBe("just now");
        expect(relativeTime(now - 3_600_000, now)).toBe("1 h ago");
        expect(relativeTime(now + 10_000, now)).toBe("just now");
    });

    test("formatLocal 은 로컬 시각을 YYYY-MM-DD HH:mm(:ss) 로 쓴다", () => {
        const at = new Date(2026, 0, 2, 3, 4, 5).getTime();
        expect(formatLocal(at, false)).toBe("2026-01-02 03:04");
        expect(formatLocal(at, true)).toBe("2026-01-02 03:04:05");
    });
});
