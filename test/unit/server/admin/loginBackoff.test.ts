/**
 * P5-T2 / REQ-07 — computeBackoffMs 순수 함수 경계값 검증.
 * Mock 금지: 순수 함수이므로 입력/출력만 검증.
 *  fail=0 -> 100, fail=1 -> 200, fail=2 -> 400, fail=3 -> 800, fail=4 -> 1600,
 *  fail=5 -> 3200, fail=6 -> 5000 (cap), fail=10 -> 5000, fail=100 -> 5000.
 *  음수/NaN -> 100 (기본).
 */
import {computeBackoffMs, LOGIN_BACKOFF_CAP_MS, LOGIN_BACKOFF_BASE_MS} from "../../../../src/server/admin/loginBackoff";

describe("REQ-07 computeBackoffMs (pure function)", () => {
    it("fail=0 -> BASE", () => {
        expect(computeBackoffMs(0)).toBe(LOGIN_BACKOFF_BASE_MS);
    });
    it("fail=1 -> 200, fail=5 -> 3200", () => {
        expect(computeBackoffMs(1)).toBe(200);
        expect(computeBackoffMs(5)).toBe(3200);
    });
    it("fail>=6 -> cap at 5000", () => {
        expect(computeBackoffMs(6)).toBe(LOGIN_BACKOFF_CAP_MS);
        expect(computeBackoffMs(10)).toBe(LOGIN_BACKOFF_CAP_MS);
        expect(computeBackoffMs(100)).toBe(LOGIN_BACKOFF_CAP_MS);
    });
    it("negative / NaN -> BASE", () => {
        expect(computeBackoffMs(-1)).toBe(LOGIN_BACKOFF_BASE_MS);
        expect(computeBackoffMs(Number.NaN)).toBe(LOGIN_BACKOFF_BASE_MS);
    });
});
