import {i18n, type Translator} from '../../i18n';

// 이슈 370 C-2: 연결 횟수 제한 칸의 범위와 범위 밖 오류 문구. tr 을 생략하면 앱의 언어다.

/** 측정 구간(초)·IP당 최대 연결 횟수·차단 시간(분)의 범위. */
export const RATE_RANGES = {window: [1, 3600], max: [1, 100000], ban: [1, 1440]} as const;

/** 범위 밖 값의 오류 문구. 영어는 지금처럼 '1..3600' 이다. */
export const rateRangeError = ([min, max]: readonly [number, number], tr: Translator = i18n()): string =>
    tr.t('tunnelEdit.rangeInvalid', {min, max});
