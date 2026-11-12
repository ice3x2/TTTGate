import {capSecondsOf, endsAtSentence, fixedReasonOf, formatCap, formatDays, formatSpan, initialKeepOn, keepOnLimits, keepOnSeconds, scaleOf,
    stepNames, stepKeepOn, switchUnit, type KeepOnState} from "../../admin/src/screens/parts/keepOn";
import {translator} from "../../admin/src/i18n";

// 이슈 368 — 켜 둘 시간 창의 범위·문구·처음 값·단위 바꾸기·보낼 값(순수 함수).
const en = translator("en");
const ko = translator("ko");
const HOUR = 3600;
const DAY = 86_400;

describe("keepOnLimits (FR-5·FR-6·FR-9·FR-11·FR-19)", () => {
    test("상한이 없으면 시간 1분~24시간, 일 1~30일, 단위 버튼과 '자동으로 끄지 않기'가 보인다", () => {
        expect(keepOnLimits(null)).toEqual({hourMaxMinutes: 1440, dayMax: 30, showUnits: true, showNoAuto: true, fixedSeconds: undefined});
    });
    test("AC-2 상한 12시간이면 단위 버튼과 '자동으로 끄지 않기'가 없고 최댓값이 720분이다", () => {
        expect(keepOnLimits(12 * HOUR)).toEqual({hourMaxMinutes: 720, dayMax: 0, showUnits: false, showNoAuto: false, fixedSeconds: undefined});
    });
    test("AC-3 상한 3일이면 일 1~3일, 시간 1분~24시간", () => {
        expect(keepOnLimits(3 * DAY)).toMatchObject({hourMaxMinutes: 1440, dayMax: 3, showUnits: true, showNoAuto: false});
    });
    test("AC-12 상한 1일 12시간이면 일 단위 최대가 1일이다(고정으로 보인다)", () => {
        expect(keepOnLimits(DAY + 12 * HOUR)).toMatchObject({dayMax: 1, showUnits: true});
    });
    test("상한이 1분보다 짧으면 그 초를 고정해 보낸다", () => {
        expect(keepOnLimits(59)).toEqual({hourMaxMinutes: 0, dayMax: 0, showUnits: false, showNoAuto: false, fixedSeconds: 59});
    });
    test("상한이 분으로 나누어떨어지지 않으면 분 단위로 내림한다", () => {
        expect(keepOnLimits(125).hourMaxMinutes).toBe(2);
    });
});

describe("formatSpan·formatDays (FR-7·FR-9·AC-4)", () => {
    test("1시간 미만은 분, 그 이상은 n시간 m분, m 이 0 이면 n시간", () => {
        expect([59, 60, 125, 1440].map((m) => formatSpan(m, ko))).toEqual(["59분", "1시간", "2시간 5분", "24시간"]);
        expect([59, 60, 125].map((m) => formatSpan(m, en))).toEqual(["59 min", "1 h", "2 h 5 min"]);
    });
    test("일 단위", () => {
        expect([1, 3].map((d) => formatDays(d, ko))).toEqual(["1일", "3일"]);
        expect([1, 3].map((d) => formatDays(d, en))).toEqual(["1 day", "3 days"]);
    });
});

describe("initialKeepOn (FR-12·AC-6)", () => {
    test("남은 시간 1시간 30분이면 시간 단위 90분으로 연다", () => {
        expect(initialKeepOn({remainingSeconds: 90 * 60, activeTimeout: 4 * HOUR}, keepOnLimits(null))).toEqual({unit: "h", minutes: 90, days: 1, noAuto: false});
    });
    test("남은 시간이 1분 미만이면 1분이다", () => {
        expect(initialKeepOn({remainingSeconds: 10, activeTimeout: HOUR}, keepOnLimits(null))).toMatchObject({unit: "h", minutes: 1});
    });
    test("남은 시간이 하루 이상이고 일 단위를 쓸 수 있으면 일 단위로, 일 수는 반올림한다", () => {
        expect(initialKeepOn({remainingSeconds: 2 * DAY + 13 * HOUR, activeTimeout: 5 * DAY}, keepOnLimits(null))).toMatchObject({unit: "d", days: 3});
    });
    test("자동으로 끄지 않는 터널은 스위치가 켜진 채로, 상한이 있어 스위치가 없으면 시간 단위 최댓값으로 연다", () => {
        expect(initialKeepOn({remainingSeconds: 0, activeTimeout: 0}, keepOnLimits(null))).toMatchObject({noAuto: true});
        expect(initialKeepOn({remainingSeconds: 0, activeTimeout: 0}, keepOnLimits(2 * HOUR))).toEqual({unit: "h", minutes: 120, days: 1, noAuto: false});
    });
    test("시간 단위 범위로 자른다", () => {
        expect(initialKeepOn({remainingSeconds: 5 * HOUR, activeTimeout: 5 * HOUR}, keepOnLimits(2 * HOUR))).toMatchObject({unit: "h", minutes: 120});
    });
});

describe("switchUnit·stepKeepOn·keepOnSeconds (FR-10·FR-13·FR-18·AC-5·AC-11)", () => {
    const limits = keepOnLimits(3 * DAY);
    const state: KeepOnState = {unit: "h", minutes: 90, days: 1, noAuto: false};
    test("시간 → 일은 올림한 일 수, 일 → 시간은 24시간(범위 안으로 자름)", () => {
        expect(switchUnit(state, "d", limits)).toMatchObject({unit: "d", days: 1});
        expect(switchUnit({...state, minutes: 1441}, "d", limits)).toMatchObject({unit: "d", days: 2});
        expect(switchUnit({...state, unit: "d", days: 3}, "h", keepOnLimits(12 * HOUR))).toMatchObject({unit: "h", minutes: 720});
        expect(switchUnit({...state, unit: "d", days: 2}, "h", limits)).toMatchObject({unit: "h", minutes: 1440});
    });
    test("−/+ 는 시간 단위 1분, 일 단위 1일씩이고 범위 끝에서 멈춘다", () => {
        expect(stepKeepOn(state, 1, limits).minutes).toBe(91);
        expect(stepKeepOn({...state, minutes: 1}, -1, limits).minutes).toBe(1);
        expect(stepKeepOn({...state, minutes: 1440}, 1, limits).minutes).toBe(1440);
        expect(stepKeepOn({...state, unit: "d", days: 3}, 1, limits).days).toBe(3);
        expect(stepKeepOn({...state, unit: "d", days: 2}, -1, limits).days).toBe(1);
    });
    test("보낼 값은 초다. 자동으로 끄지 않기는 0, 고정 초는 그 초다", () => {
        expect(keepOnSeconds(state, limits)).toBe(5400);
        expect(keepOnSeconds({...state, unit: "d", days: 2}, limits)).toBe(2 * DAY);
        expect(keepOnSeconds({...state, noAuto: true}, keepOnLimits(null))).toBe(0);
        expect(keepOnSeconds(state, keepOnLimits(59))).toBe(59);
    });
});

describe("capSecondsOf (FR-1·§7 호환)", () => {
    const me = (role: "regular" | "superuser", maxMs: number) => ({user: {role}, group: {attributes: {max_tunnel_duration_ms: maxMs}}});
    test("상태 응답의 timeoutCapSeconds 가 있으면 그 값(null 포함)을 쓴다", () => {
        expect(capSecondsOf({timeoutCapSeconds: 21_600}, me("regular", 0))).toBe(21_600);
        expect(capSecondsOf({timeoutCapSeconds: null}, me("regular", 7_200_000))).toBeNull();
    });
    test("옛 서버(필드 없음)면 자기 그룹 상한으로 계산하고, 슈퍼유저와 0 은 상한이 없다", () => {
        expect(capSecondsOf({}, me("regular", 7_200_000))).toBe(7200);
        expect(capSecondsOf({}, me("regular", 1500))).toBe(2);
        expect(capSecondsOf({}, me("regular", 0))).toBeNull();
        expect(capSecondsOf({}, me("superuser", 7_200_000))).toBeNull();
        expect(capSecondsOf({}, undefined)).toBeNull();
    });
});

test("AC-8 창 제목은 한국어 '켜 둘 시간', 영어 'Keep it on for' 이고 상태 영역 이름은 '자동 꺼짐까지'다", () => {
    expect(ko.t("timer.title")).toBe("켜 둘 시간");
    expect(en.t("timer.title")).toBe("Keep it on for");
    expect(ko.t("tunnelStatus.timeLimit")).toBe("자동 꺼짐까지");
    expect(en.t("tunnelStatus.timeLimit")).toBe("Turns off in");
});

describe("endsAtSentence — 꺼지는 시각 안내 문장 (FR-20·검토 H-1)", () => {
    // 시각은 실행 환경의 시간대로 보인다. 기준 시각을 그 시간대의 2027-01-15 17:00 으로 만들어 어느 시간대에서도 같은 결과를 얻는다.
    const NOW = new Date(2027, 0, 15, 17, 0, 0).getTime();
    test("오늘이면 시:분만, 다른 날이면 월·일을 붙인다. '종료'·'ends' 를 붙이지 않는다", () => {
        expect(endsAtSentence("1시간", NOW + HOUR * 1000, NOW, ko)).toBe("지금부터 1시간 뒤, 18:00에 꺼집니다.");
        expect(endsAtSentence("1일", NOW + DAY * 1000, NOW, ko)).toBe("지금부터 1일 뒤, 1월 16일 17:00에 꺼집니다.");
        expect(endsAtSentence("1 h", NOW + HOUR * 1000, NOW, en)).toBe("Turns off at 18:00 (1 h from now).");
        expect(endsAtSentence("1 day", NOW + DAY * 1000, NOW, en)).toBe("Turns off at 1/16 17:00 (1 day from now).");
    });
});

describe("fixedReasonOf — 값이 하나뿐인 이유 (FR-19·검토 M-1)", () => {
    const hours: KeepOnState = {unit: "h", minutes: 60, days: 1, noAuto: false};
    const days: KeepOnState = {...hours, unit: "d"};
    test("일 단위 최대가 1일이면 일 단위에서만 '1일만' 이유를 보인다", () => {
        expect(fixedReasonOf(days, keepOnLimits(DAY + 12 * HOUR), ko)).toBe("일 단위로는 1일만 고를 수 있습니다.");
        expect(fixedReasonOf(days, keepOnLimits(DAY + 12 * HOUR), en)).toBe("In days, only 1 day is possible.");
        expect(fixedReasonOf(hours, keepOnLimits(DAY + 12 * HOUR), ko)).toBeUndefined();
    });
    test("상한이 1분보다 짧으면 상한 이유를 보인다", () => {
        expect(fixedReasonOf(hours, keepOnLimits(59), ko)).toBe("켜 둘 수 있는 최대 시간이 1분보다 짧아 이 값으로만 켤 수 있습니다.");
        expect(fixedReasonOf(hours, keepOnLimits(59), en)).toBe("The longest allowed time is under 1 minute, so only this value is available.");
    });
    test("고를 값이 여럿이면 이유가 없다", () => {
        expect(fixedReasonOf(days, keepOnLimits(3 * DAY), ko)).toBeUndefined();
        expect(fixedReasonOf(days, keepOnLimits(null), ko)).toBeUndefined();
        expect(fixedReasonOf(hours, keepOnLimits(2 * HOUR), ko)).toBeUndefined();
    });
});

describe("formatCap — 상한 안내의 시간 (FR-21)", () => {
    test("일과 나머지 시간·분으로 적는다. 1분 미만은 초다", () => {
        expect([DAY + 12 * HOUR, 12 * HOUR, 3 * DAY, 2 * HOUR, DAY + HOUR + 61, 59].map((cap) => formatCap(cap, ko)))
            .toEqual(["1일 12시간", "12시간", "3일", "2시간", "1일 1시간 1분", "59초"]);
        expect([DAY + 12 * HOUR, 3 * DAY, 12 * HOUR].map((cap) => formatCap(cap, en))).toEqual(["1 day 12 h", "3 days", "12 h"]);
    });
});

describe("scaleOf — 슬라이더 양 끝 글자", () => {
    test("시간 단위는 1분과 시간 최댓값, 일 단위는 1일과 일 최댓값이다", () => {
        expect(scaleOf("h", keepOnLimits(null), ko)).toEqual({min: "1분", max: "24시간"});
        expect(scaleOf("h", keepOnLimits(12 * HOUR), ko)).toEqual({min: "1분", max: "12시간"});
        expect(scaleOf("d", keepOnLimits(3 * DAY), ko)).toEqual({min: "1일", max: "3일"});
        expect(scaleOf("d", keepOnLimits(3 * DAY), en)).toEqual({min: "1 day", max: "3 days"});
    });
});

describe("stepNames — −/+ 버튼 이름에 단위를 넣는다", () => {
    test("시간 단위는 1분, 일 단위는 1일", () => {
        expect(stepNames("h", ko)).toEqual({less: "1분 줄이기", more: "1분 늘리기"});
        expect(stepNames("d", ko)).toEqual({less: "1일 줄이기", more: "1일 늘리기"});
        expect(stepNames("h", en)).toEqual({less: "1 min shorter", more: "1 min longer"});
        expect(stepNames("d", en)).toEqual({less: "1 day shorter", more: "1 day longer"});
    });
});
