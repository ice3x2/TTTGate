import ExMath from '../../controller/ExMath';
import {i18n, type Translator} from '../../i18n';

// 화면들이 함께 쓰는 표시 단위 변환. 옛 ServerStatusLayout 과 SysinfoPopup 에
// 같은 함수가 두 벌 있던 것을 한 곳으로 모았다.
// 이슈 349 FR-6: 숫자는 Intl 로, 시간 단위는 리소스로 적는다. 크기 단위 기호는 어느 언어든 같다. tr 을 생략하면 앱의 언어다.

/** 소수를 버린 정수를 그 언어로 적는다. */
export const wholeNumber = (value: number, tr: Translator = i18n()): string => tr.number(Math.floor(value), 0);

export const byteToUnit = (length: number, hideUnit = false, tr: Translator = i18n()): string => {
    const tib = 1024 * 1024 * 1024 * 1024;
    const gib = 1024 * 1024 * 1024;
    const mib = 1024 * 1024;
    const kib = 1024;
    if(length > tib) {
        return `${tr.number(ExMath.round(length / tib, 1), 1)}${hideUnit ? '' : 'TiB'}`;
    } else if(length > gib) {
        return `${tr.number(ExMath.round(length / gib, 1), 1)}${hideUnit ? '' : 'GiB'}`;
    } else if(length > mib) {
        return `${tr.number(ExMath.round(length / mib, 1), 1)}${hideUnit ? '' : 'MiB'}`;
    } else if(length > kib) {
        return `${tr.number(ExMath.round(length / kib, 1), 1)}${hideUnit ? '' : 'KiB'}`;
    } else {
        return `${tr.number(length, 1)}${hideUnit ? '' : 'B'}`;
    }
};

export const timeToDMH = (ms: number, tr: Translator = i18n()): string => {
    const time = ms / 1000;
    const day = Math.floor(time / (24 * 60 * 60));
    const hour = Math.floor((time % (24 * 60 * 60)) / (60 * 60));
    const min = Math.floor((time % (60 * 60)) / 60);
    const sec = Math.floor(time % 60);
    return tr.t('time.daysHoursMinutesSeconds', {days: tr.number(day, 0), hours: tr.number(hour, 0), minutes: tr.number(min, 0), seconds: tr.number(sec, 0)});
};

// 옛 TunnelOptionSetLayout 의 _startupTime 을 옮겼다. 시작 시각에서 지금까지 흐른 시간을 가장 큰 두 단위로 적는다.
// 경과 시간의 0 하한만 원본과 다르다. uptime 은 서버 시각인데 빼는 쪽은 클라이언트 시계라서,
// 클라이언트 시계가 서버보다 늦으면 원본은 "-5s" 같은 음수를 찍었다.
export const startupTime = (uptime: number, tr: Translator = i18n()): string => {
    if(!uptime) {
        return tr.t('time.uptimeSeconds', {seconds: wholeNumber(0, tr)});
    }
    const time = Math.max(0, Date.now() - uptime);
    if(time > 1000 * 60 * 60 * 24) {
        return tr.t('time.uptimeDays', {days: wholeNumber(time / (1000 * 60 * 60 * 24), tr), hours: wholeNumber((time % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60), tr)});
    } else if(time > 1000 * 60 * 60) {
        return tr.t('time.uptimeHours', {hours: wholeNumber(time / (1000 * 60 * 60), tr), minutes: wholeNumber((time % (1000 * 60 * 60)) / (1000 * 60), tr)});
    } else if(time > 1000 * 60) {
        return tr.t('time.uptimeMinutes', {minutes: wholeNumber(time / (1000 * 60), tr)});
    } else {
        return tr.t('time.uptimeSeconds', {seconds: wholeNumber(time / 1000, tr)});
    }
};

// 옛 TunnelOptionSetLayout 의 _toSize·_floorPoint 그대로. 소수 둘째 자리까지 내림한다.
export const toSize = (bytes: number, tr: Translator = i18n()): string => {
    if(bytes > 1024 * 1024 * 1024) {
        return tr.number(ExMath.floor(bytes / (1024 * 1024 * 1024), 2), 2) + 'Gb';
    } else if(bytes > 1024 * 1024) {
        return tr.number(ExMath.floor(bytes / (1024 * 1024), 2), 2) + 'Mb';
    } else if(bytes > 1024) {
        return tr.number(ExMath.floor(bytes / 1024, 2), 2) + 'Kb';
    } else {
        return tr.number(bytes, 2) + 'B';
    }
};
