import {i18n, type Translator} from '../../i18n';

// 이슈 368: "켜 둘 시간" 창의 범위·값 문구·처음 값·단위 바꾸기·보낼 값(순수 함수). 화면은 그리기만 한다.

const MINUTE = 60;
const HOUR_MINUTES = 60;
const DAY = 86_400;
const DAY_MINUTES = 1440;
/** 시간 단위 최대(24시간)와 일 단위 최대(30일). 그보다 긴 기간은 막대 칸이 너무 촘촘해진다. */
const HOUR_UNIT_MAX_MINUTES = DAY_MINUTES;
const DAY_UNIT_MAX = 30;

export type KeepOnUnit = 'h' | 'd';
export type KeepOnState = {unit: KeepOnUnit; minutes: number; days: number; noAuto: boolean};
export type KeepOnLimits = {
    /** 시간 단위 슬라이더 최댓값(분). 최솟값은 1분이다. */
    hourMaxMinutes: number;
    /** 일 단위 슬라이더 최댓값(일). 0 이면 일 단위를 쓰지 않는다. */
    dayMax: number;
    /** 시간·일 단위 버튼을 보이는가. 적용 상한이 하루보다 짧으면 숨긴다(FR-5). */
    showUnits: boolean;
    /** "자동으로 끄지 않기"를 보이는가. 적용 상한이 없을 때만 보인다(FR-11). */
    showNoAuto: boolean;
    /** 적용 상한이 1분보다 짧으면 고를 수 있는 값은 그 초 하나다(FR-19). */
    fixedSeconds: number | undefined;
};

/** 적용 상한(초, 없으면 null)으로 정한 범위. 서버가 같은 상한으로 자르므로 범위가 같아야 말없이 잘리는 일이 없다. */
export function keepOnLimits(capSeconds: number | null): KeepOnLimits {
    if(capSeconds === null) {
        return {hourMaxMinutes: HOUR_UNIT_MAX_MINUTES, dayMax: DAY_UNIT_MAX, showUnits: true, showNoAuto: true, fixedSeconds: undefined};
    }
    if(capSeconds < MINUTE) return {hourMaxMinutes: 0, dayMax: 0, showUnits: false, showNoAuto: false, fixedSeconds: capSeconds};
    const showUnits = capSeconds >= DAY;
    return {
        hourMaxMinutes: Math.min(HOUR_UNIT_MAX_MINUTES, Math.floor(capSeconds / MINUTE)),
        dayMax: showUnits ? Math.min(DAY_UNIT_MAX, Math.floor(capSeconds / DAY)) : 0,
        showUnits,
        showNoAuto: false,
        fixedSeconds: undefined,
    };
}

/** FR-7: 1시간 미만은 "n분", 그 이상은 "n시간 m분"(m 이 0 이면 "n시간"). */
export function formatSpan(minutes: number, tr: Translator = i18n()): string {
    if(minutes < HOUR_MINUTES) return tr.t('timer.spanMinutes', {m: tr.number(minutes, 0)});
    const h = Math.floor(minutes / HOUR_MINUTES);
    const m = minutes % HOUR_MINUTES;
    return m === 0 ? tr.t('timer.spanHours', {h: tr.number(h, 0)}) : tr.t('timer.spanHoursMinutes', {h: tr.number(h, 0), m: tr.number(m, 0)});
}

/** FR-9: "n일" / "1 day", "n days". */
export function formatDays(days: number, tr: Translator = i18n()): string {
    return tr.plural('timer.spanDays', days);
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * FR-12: 창을 열 때의 값은 지금 남은 시간이다(보낸 값이 "지금부터"이기 때문). 1분 미만은 1분이다.
 * 하루 이상 남았고 일 단위를 쓸 수 있으면 일 단위(반올림), 그 밖에는 시간 단위다.
 * 자동으로 끄지 않는 터널은 스위치를 켠 채로 연다. 스위치가 없으면(상한 있음) 시간 단위 최댓값으로 연다.
 */
export function initialKeepOn(input: {remainingSeconds: number; activeTimeout: number}, limits: KeepOnLimits): KeepOnState {
    const hourMax = Math.max(1, limits.hourMaxMinutes);
    if(input.activeTimeout <= 0) {
        return limits.showNoAuto ? {unit: 'h', minutes: hourMax, days: 1, noAuto: true} : {unit: 'h', minutes: hourMax, days: 1, noAuto: false};
    }
    if(input.remainingSeconds >= DAY && limits.dayMax >= 1) {
        return {unit: 'd', minutes: hourMax, days: clamp(Math.round(input.remainingSeconds / DAY), 1, limits.dayMax), noAuto: false};
    }
    return {unit: 'h', minutes: clamp(Math.ceil(input.remainingSeconds / MINUTE), 1, hourMax), days: 1, noAuto: false};
}

/** FR-10: 시간 → 일은 올림한 일 수, 일 → 시간은 24시간. 둘 다 새 단위 범위 안으로 자른다. */
export function switchUnit(state: KeepOnState, unit: KeepOnUnit, limits: KeepOnLimits): KeepOnState {
    if(unit === state.unit) return state;
    if(unit === 'd') return {...state, unit, days: clamp(Math.ceil(state.minutes / DAY_MINUTES), 1, Math.max(1, limits.dayMax))};
    return {...state, unit, minutes: clamp(DAY_MINUTES, 1, Math.max(1, limits.hourMaxMinutes))};
}

/** FR-18: −/+ 버튼. 시간 단위는 1분, 일 단위는 1일씩 바꾸고 범위 끝에서 멈춘다. */
export function stepKeepOn(state: KeepOnState, delta: number, limits: KeepOnLimits): KeepOnState {
    if(state.unit === 'd') return {...state, days: clamp(state.days + delta, 1, Math.max(1, limits.dayMax))};
    return {...state, minutes: clamp(state.minutes + delta, 1, Math.max(1, limits.hourMaxMinutes))};
}

/** FR-13: 보낼 값(초). 자동으로 끄지 않기는 0, 고정 초는 그 초다. */
export function keepOnSeconds(state: KeepOnState, limits: KeepOnLimits): number {
    if(limits.fixedSeconds !== undefined) return limits.fixedSeconds;
    if(state.noAuto && limits.showNoAuto) return 0;
    return state.unit === 'd' ? state.days * DAY : state.minutes * MINUTE;
}

/**
 * FR-1·§7: 적용 상한(초). 상태 응답의 timeoutCapSeconds(요청자를 켠 사람으로 놓고 서버가 계산한 값)를 쓴다.
 * 옛 서버 응답에는 없으므로 자기 그룹 상한으로 계산한다. 슈퍼유저와 0 은 상한이 없다(null).
 */
export function capSecondsOf(status: {timeoutCapSeconds?: number | null},
    me: {user: {role: string}; group: {attributes: {max_tunnel_duration_ms: number}}} | undefined): number | null {
    if(status.timeoutCapSeconds !== undefined) return status.timeoutCapSeconds;
    if(!me || me.user.role === 'superuser') return null;
    const limitMs = me.group.attributes.max_tunnel_duration_ms;
    return limitMs > 0 ? Math.max(1, Math.ceil(limitMs / 1000)) : null;
}
