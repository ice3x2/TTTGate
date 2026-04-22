/**
 * P5-T2 / REQ-07: 로그인 실패 횟수에 대한 지수 백오프 지연(ms)을 계산하는 순수 함수.
 *
 * - 입력: failCount >= 0 (정수 권장). 음수/비정상 값은 0으로 clamp.
 * - 출력: Math.min(2^failCount * 100, 5000) ms.
 *   fail=0 -> 100, fail=1 -> 200, fail=2 -> 400, fail=3 -> 800, fail=4 -> 1600,
 *   fail=5 -> 3200, fail=6 이상 -> 5000 상한.
 *
 * 본 모듈은 side-effect를 절대 갖지 않는다. (no I/O, no logger, no Date.now)
 */

export const LOGIN_BACKOFF_CAP_MS = 5000;
export const LOGIN_BACKOFF_BASE_MS = 100;

export function computeBackoffMs(failCount: number): number {
    if(!Number.isFinite(failCount) || failCount <= 0) {
        return LOGIN_BACKOFF_BASE_MS;
    }
    const n = Math.floor(failCount);
    // 2^n 이 너무 커지기 전에 cap을 걸어야 overflow/NaN 방지.
    if(n >= 20) {
        return LOGIN_BACKOFF_CAP_MS;
    }
    const exp = Math.pow(2, n) * LOGIN_BACKOFF_BASE_MS;
    return Math.min(exp, LOGIN_BACKOFF_CAP_MS);
}
