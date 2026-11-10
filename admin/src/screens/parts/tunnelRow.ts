import type {Options, TunnelingStatus} from '../../controller/Options';
import {i18n, type Translator} from '../../i18n';
import {wholeNumber} from './units';

// 이슈 338 — 터널 목록 한 줄(REQ-5·REQ-8)과 끄기를 되돌릴 때의 timeout(REQ-15). 화면은 이 결과를 그리기만 한다.

export type RowPart = {text: string; warn?: boolean; muted?: boolean; title?: string};
/** switch: 켜고 끌 수 있다. disabled: 스위치를 보이되 누를 수 없다. lock: 보기만 허락된 터널이다. */
export type RowControl = 'switch' | 'disabled' | 'lock';
/** #344 켜진 터널의 시계. limited 는 남은 비율(0~1)과 숫자를, unlimited 는 도는 시계만 보인다. */
export type ClockView =
    | {kind: 'limited'; fraction: number; left: string; ends: string; warn: boolean; label: string}
    | {kind: 'unlimited'; label: string};
/** link: 줄을 누르면 편집 화면으로 가는가. 고칠 수 있을 때만이다(이슈 347). */
export type RowView = {parts: RowPart[]; control: RowControl; checked: boolean; clock?: ClockView; link: boolean};
type BaseView = Omit<RowView, 'link'>;

const MIGRATED_OWNER_ID = 'system:migrated';
const CERT_UNVERIFIED_TITLE = 'The client does not verify the destination server certificate.';

export function tunnelTitle(option: Options): string {
    if(option.name) return option.name;
    const destination = option.destinationPort === undefined ? option.destinationAddress : `${option.destinationAddress}:${option.destinationPort}`;
    return `:${option.forwardPort} → ${destination}`;
}

const WARN_SECONDS = 10 * 60;
const pad2 = (value: number) => String(value).padStart(2, '0');
const ENDS_TIME: Intl.DateTimeFormatOptions = {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'};

/**
 * #344 남은 시간. 1시간 미만은 분·초, 24시간 미만은 시·분, 그 이상은 일·시다. 0 이하는 0m 00s 다.
 * 이슈 349 FR-6: 문구는 리소스, 숫자는 Intl 이다. tr 을 생략하면 앱의 언어다.
 */
export function formatRemaining(seconds: number, tr: Translator = i18n()): string {
    const left = Math.max(0, Math.floor(seconds));
    if(left < 3600) return tr.t('clock.leftMinutes', {minutes: wholeNumber(left / 60, tr), seconds: pad2(left % 60)});
    if(left < 86_400) return tr.t('clock.leftHours', {hours: wholeNumber(left / 3600, tr), minutes: wholeNumber((left % 3600) / 60, tr)});
    return tr.t('clock.leftDays', {days: wholeNumber(left / 86_400, tr), hours: wholeNumber((left % 86_400) / 3600, tr)});
}

/** #344 종료 시각. 브라우저 시간대로 보이고, now(서버 시각)와 날짜가 다르면 월·일을 붙인다. 시:분은 Intl 의 24시간 표기다. */
export function formatEnds(endsAt: number, now: number, tr: Translator = i18n()): string {
    const end = new Date(endsAt);
    const today = new Date(now);
    const time = tr.dateTime(ENDS_TIME).format(end);
    const sameDay = end.getFullYear() === today.getFullYear() && end.getMonth() === today.getMonth() && end.getDate() === today.getDate();
    return sameDay ? tr.t('clock.endsToday', {time})
        : tr.t('clock.endsOtherDay', {month: tr.number(end.getMonth() + 1, 0), day: tr.number(end.getDate(), 0), time});
}

/** #344 켜진 터널의 시계. 꺼졌거나 열리지 않았으면 없다. 시각은 서버 시각(serverTime)만 쓴다. */
export function clockOf(status: TunnelingStatus | undefined, serverTime: number, tr: Translator = i18n()): ClockView | undefined {
    if(!status || !status.online || !status.active) return undefined;
    if(!(status.activeTimeout > 0)) return {kind: 'unlimited', label: tr.t('clock.noLimit')};
    const endsAt = status.activeStart + status.activeTimeout * 1000;
    const leftSeconds = Math.max(0, Math.floor((endsAt - serverTime) / 1000));
    const left = formatRemaining(leftSeconds, tr);
    const ends = formatEnds(endsAt, serverTime, tr);
    const warn = leftSeconds <= WARN_SECONDS;
    // 경고색은 눈으로만 보이므로 보조 기술용 이름에 같은 뜻을 붙인다.
    return {kind: 'limited', fraction: Math.min(1, leftSeconds / status.activeTimeout), left, ends, warn,
        label: tr.t(warn ? 'clock.labelEndingSoon' : 'clock.label', {left, ends})};
}

/** 기한까지 남은 밀리초. 기한이 없으면 undefined. */
export const remainingMsOf = (status: TunnelingStatus, serverTime: number): number | undefined =>
    status.activeTimeout > 0 ? status.activeStart + status.activeTimeout * 1000 - serverTime : undefined;

/** 끄기를 되돌릴 때 보낼 timeout(초). 기한이 없었으면 0, 기한이 지났으면 되돌리지 않는다(undefined, 0 은 무기한이기 때문이다). */
export function undoTimeoutOf(status: TunnelingStatus, serverTime: number): number | undefined {
    const remainingMs = remainingMsOf(status, serverTime);
    if(remainingMs === undefined) return 0;
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : undefined;
}

const ownerPart = (option: Options, meId: string): RowPart | undefined => {
    const owner = option.owner;
    if(!owner || owner.id === meId) return undefined;
    if(owner.id === MIGRATED_OWNER_ID) return {text: 'migrated'};
    return {text: owner.username !== undefined ? `@${owner.username}` : owner.id};
};

const statePartsOf = (status: TunnelingStatus, tr: Translator = i18n()): RowPart[] => {
    const offline = status.clientConnected === false;
    if(!status.active) return offline ? [{text: 'Off'}, {text: 'client offline'}] : [{text: 'Off'}];
    const parts: RowPart[] = [{text: 'On'}];
    if(offline) parts.push({text: 'client offline', warn: true});
    if(status.sessions > 0) parts.push({text: tr.plural('tunnel.connections', status.sessions)});
    return parts;
};

const baseOf = (input: {option: Options; status?: TunnelingStatus; loaded: boolean; serverTime: number}): BaseView => {
    const {option, status, loaded, serverTime} = input;
    if(!loaded) return {parts: [{text: 'Checking…', muted: true}], control: 'disabled', checked: false};
    // 이슈 347: 스위치는 켜기 권한(toggleable)으로 정한다. 옛 서버 응답에는 없으므로 editable 을 따른다.
    if((option.toggleable ?? option.editable) === false) {
        const parts = status?.online ? [{text: status.active ? 'On' : 'Off'}] : [{text: 'Unavailable'}];
        return {parts: [...parts, {text: 'view only'}], control: 'lock', checked: status?.online === true && status.active, clock: clockOf(status, serverTime)};
    }
    if(!status) return {parts: [{text: 'Not running', warn: true}], control: 'disabled', checked: false};
    if(!status.online) return {parts: [{text: `Can't open port ${option.forwardPort}`, warn: true}], control: 'disabled', checked: false};
    return {parts: statePartsOf(status), control: 'switch', checked: status.active, clock: clockOf(status, serverTime)};
};

export function tunnelRowView(input: {option: Options; status?: TunnelingStatus; loaded: boolean; meId: string; serverTime: number}): RowView {
    const base = {...baseOf(input), link: input.option.editable !== false};
    if(!input.loaded) return base;
    const extra: RowPart[] = [];
    const owner = ownerPart(input.option, input.meId);
    if(owner) extra.push(owner);
    if(input.option.tls === true && input.option.allowSelfSignedDestinationCert === true) {
        extra.push({text: 'cert not verified', warn: true, title: CERT_UNVERIFIED_TITLE});
    }
    return {...base, parts: [...base.parts, ...extra]};
}
