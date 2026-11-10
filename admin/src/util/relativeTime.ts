import {i18n, type Translator} from '../i18n';

// U4-06: 세션·감사 화면의 시각 표기. Jest(CommonJS 변환)로 직접 테스트하므로 순수 함수와 export 만 둔다.
// 이슈 349 FR-6: 문구는 리소스, 숫자는 Intl 이다. tr 을 생략하면 앱의 언어다.

export function relativeTime(fromMs: number, nowMs: number, tr: Translator = i18n()): string {
    const seconds = Math.floor(Math.max(0, nowMs - fromMs) / 1000);
    if(seconds < 60) return tr.t('time.justNow');
    const minutes = Math.floor(seconds / 60);
    if(minutes < 60) return tr.t('time.minutesAgo', {count: tr.number(minutes, 0)});
    const hours = Math.floor(minutes / 60);
    if(hours < 24) return tr.t('time.hoursAgo', {count: tr.number(hours, 0)});
    return tr.t('time.daysAgo', {count: tr.number(Math.floor(hours / 24), 0)});
}

/** 로컬 시각을 YYYY-MM-DD HH:mm(:ss) 로 쓴다. 어느 언어든 같은 순서이고, 숫자는 Intl 이 그 언어로 적는다. */
export function formatLocal(ms: number, withSeconds: boolean, tr: Translator = i18n()): string {
    const parts = new Intl.DateTimeFormat(tr.intl, {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        second: withSeconds ? '2-digit' : undefined, hourCycle: 'h23'}).formatToParts(new Date(ms));
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? '';
    const time = `${part('hour')}:${part('minute')}` + (withSeconds ? `:${part('second')}` : '');
    return `${part('year')}-${part('month')}-${part('day')} ${time}`;
}
