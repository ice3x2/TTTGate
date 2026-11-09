import type {Options, TunnelingStatus} from '../../controller/Options';

// 이슈 338 — 터널 목록 한 줄(REQ-5·REQ-8)과 끄기를 되돌릴 때의 timeout(REQ-15). 화면은 이 결과를 그리기만 한다.

export type RowPart = {text: string; warn?: boolean; muted?: boolean; title?: string};
/** switch: 켜고 끌 수 있다. disabled: 스위치를 보이되 누를 수 없다. lock: 보기만 허락된 터널이다. */
export type RowControl = 'switch' | 'disabled' | 'lock';
export type RowView = {parts: RowPart[]; control: RowControl; checked: boolean};

const MIGRATED_OWNER_ID = 'system:migrated';
const CERT_UNVERIFIED_TITLE = 'The client does not verify the destination server certificate.';

export function tunnelTitle(option: Options): string {
    if(option.name) return option.name;
    const destination = option.destinationPort === undefined ? option.destinationAddress : `${option.destinationAddress}:${option.destinationPort}`;
    return `:${option.forwardPort} → ${destination}`;
}

export function formatLeft(seconds: number): string {
    if(seconds < 60) return '<1m left';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
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

const statePartsOf = (status: TunnelingStatus, serverTime: number): RowPart[] => {
    const offline = status.clientConnected === false;
    if(!status.active) return offline ? [{text: 'Off'}, {text: 'client offline'}] : [{text: 'Off'}];
    const parts: RowPart[] = [{text: 'On'}];
    if(offline) parts.push({text: 'client offline', warn: true});
    if(status.sessions > 0) parts.push({text: `${status.sessions} connection${status.sessions === 1 ? '' : 's'}`});
    const remainingMs = remainingMsOf(status, serverTime);
    if(remainingMs !== undefined) parts.push({text: formatLeft(Math.max(0, Math.floor(remainingMs / 1000)))});
    return parts;
};

const baseOf = (input: {option: Options; status?: TunnelingStatus; loaded: boolean; serverTime: number}): RowView => {
    const {option, status, loaded, serverTime} = input;
    if(!loaded) return {parts: [{text: 'Checking…', muted: true}], control: 'disabled', checked: false};
    if(option.editable === false) {
        const parts = status?.online ? [{text: status.active ? 'On' : 'Off'}] : [{text: 'Unavailable'}];
        return {parts: [...parts, {text: 'view only'}], control: 'lock', checked: status?.online === true && status.active};
    }
    if(!status) return {parts: [{text: 'Not running', warn: true}], control: 'disabled', checked: false};
    if(!status.online) return {parts: [{text: `Can't open port ${option.forwardPort}`, warn: true}], control: 'disabled', checked: false};
    return {parts: statePartsOf(status, serverTime), control: 'switch', checked: status.active};
};

export function tunnelRowView(input: {option: Options; status?: TunnelingStatus; loaded: boolean; meId: string; serverTime: number}): RowView {
    const base = baseOf(input);
    if(!input.loaded) return base;
    const extra: RowPart[] = [];
    const owner = ownerPart(input.option, input.meId);
    if(owner) extra.push(owner);
    if(input.option.tls === true && input.option.allowSelfSignedDestinationCert === true) {
        extra.push({text: 'cert not verified', warn: true, title: CERT_UNVERIFIED_TITLE});
    }
    return {...base, parts: [...base.parts, ...extra]};
}
