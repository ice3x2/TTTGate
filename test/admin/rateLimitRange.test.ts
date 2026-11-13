import {RATE_RANGES, rateRangeError} from "../../admin/src/screens/parts/rateLimitRange";
import {translator} from "../../admin/src/i18n";

// 이슈 370 C-2·AC-5 — 연결 횟수 제한 칸의 범위 오류는 번역한 문구로 보인다. 영어 화면은 지금 표기('1..3600')를 그대로 둔다.
// 한국어는 server.millisecondsRequired 처럼 자릿점을 붙인다(PR 373 리뷰 L-1).

test("세 칸의 범위는 측정 구간 1~3600초, IP당 최대 연결 횟수 1~100000, 차단 시간 1~1440분이다", () => {
    expect(RATE_RANGES).toEqual({window: [1, 3600], max: [1, 100000], ban: [1, 1440]});
});

test.each([
    ["window", "1~3,600 사이로 입력하세요."],
    ["max", "1~100,000 사이로 입력하세요."],
    ["ban", "1~1,440 사이로 입력하세요."],
] as const)("한국어 화면의 %s 칸 오류는 '%s' 다", (field, message) => {
    expect(rateRangeError(RATE_RANGES[field], translator("ko"))).toBe(message);
});

test.each([
    ["window", "1..3600"],
    ["max", "1..100000"],
    ["ban", "1..1440"],
] as const)("영어 화면의 %s 칸 오류는 지금처럼 '%s' 다", (field, message) => {
    expect(rateRangeError(RATE_RANGES[field], translator("en"))).toBe(message);
});
