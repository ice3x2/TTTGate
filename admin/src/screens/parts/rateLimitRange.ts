import {i18n, type Translator} from '../../i18n';
import {groupedNumber} from './units';

// 이슈 370 C-2: 연결 횟수 제한 칸의 범위와 범위 밖 오류 문구. tr 을 생략하면 앱의 언어다.

/** 측정 구간(초)·IP당 최대 연결 횟수·차단 시간(분)의 범위. */
export const RATE_RANGES = {window: [1, 3600], max: [1, 100000], ban: [1, 1440]} as const;

/**
 * 범위 밖 값의 오류 문구. 한국어는 server.millisecondsRequired 처럼 자릿점을 붙인다('1~3,600').
 * 영어는 지금 표기('1..3600')를 그대로 둔다.
 */
export const rateRangeError = ([min, max]: readonly [number, number], tr: Translator = i18n()): string => {
    const format = (value: number) => tr.locale === 'en' ? String(value) : groupedNumber(value, tr);
    return tr.t('tunnelEdit.rangeInvalid', {min: format(min), max: format(max)});
};
