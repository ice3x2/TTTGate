import type {TunnelingStatus} from '../../controller/Options';
import {i18n, type Translator} from '../../i18n';
import {byteToUnit, startupTime} from './units';

// 이슈 369: 터널 목록 줄의 가동 정보·허용 클라이언트와 연결 창의 줄 순서(순수 함수). 화면은 그리기만 한다.

export type StatsView = {sessions: number; line: string};

/** 이슈 369(설계 반영): 켜진 터널은 "켜진 지 …", 옛 서버이거나 꺼진 터널은 리스너가 열린 뒤의 "가동 시간 …"이다. 편집 화면과 목록이 함께 쓴다. */
export function sinceText(status: TunnelingStatus, serverTime: number, tr: Translator = i18n()): string {
    return status.active && status.activatedAt !== undefined
        ? tr.t('tunnel.onFor', {duration: startupTime(status.activatedAt, tr, serverTime)})
        : tr.t('tunnel.uptimeFor', {duration: startupTime(status.uptime, tr, serverTime)});
}

/**
 * FR-1·FR-7: 켜진 터널의 가동 정보 줄. 켜진 시각(activatedAt)이 있으면 "켜진 지 …", 옛 서버면 지금처럼 "가동 시간 …"이다.
 * 크기는 바이트 단위 기호(KiB·MiB)로 적는다. 꺼졌거나 열리지 않은 터널은 없다(undefined).
 */
export function statsView(status: TunnelingStatus | undefined, serverTime: number, tr: Translator = i18n()): StatsView | undefined {
    if(!status || !status.online || !status.active) return undefined;
    const since = sinceText(status, serverTime, tr);
    // RX·TX 는 어느 언어든 같은 약어라 문구가 아니라 값으로 끼운다.
    return {sessions: status.sessions, line: tr.t('tunnel.statsLine', {since, rxLabel: 'RX', rx: byteToUnit(status.rx, false, tr), txLabel: 'TX',
        tx: byteToUnit(status.tx, false, tr)})};
}

export type AllowedClient = {clientId: string; name: string; connected: boolean};
export type ClientsView = {label: string; items: Array<{name: string; connected: boolean | undefined}>; more: string | undefined; title: string};

/** 줄에 이름을 보이는 클라이언트 수. 넘으면 "외 N" 으로 줄이고 전체는 title 에 둔다. */
const SHOWN_CLIENTS = 2;

/**
 * FR-3: 이 터널의 연결을 맡을 수 있는 클라이언트. 고른 클라이언트가 없으면 "모두", 옛 이름 규칙만 있으면 그 규칙이다.
 * 옛 서버 응답(allowedClients 없음)에는 보이지 않는다(undefined).
 */
export function clientsView(input: {allowedClients?: AllowedClient[]; allowedClientNames?: string[]}, tr: Translator = i18n()): ClientsView | undefined {
    if(input.allowedClients === undefined) return undefined;
    const label = tr.t('tunnel.clients');
    if(input.allowedClients.length === 0) {
        const rules = (input.allowedClientNames ?? []).filter((rule) => rule.trim() !== '');
        const text = rules.length > 0 ? tr.t('tunnel.clientsNameRule', {rule: rules.join(', ')}) : tr.t('tunnel.clientsAll');
        return {label, items: [{name: text, connected: undefined}], more: undefined, title: text};
    }
    const describe = (client: AllowedClient) => client.connected ? client.name
        : tr.t('tunnel.clientWithState', {name: client.name, state: tr.t('tunnel.clientNotConnected')});
    const rest = input.allowedClients.length - SHOWN_CLIENTS;
    return {
        label,
        items: input.allowedClients.slice(0, SHOWN_CLIENTS).map((client) => ({name: client.name, connected: client.connected})),
        more: rest > 0 ? tr.t('tunnel.clientsMore', {count: rest}) : undefined,
        title: input.allowedClients.map(describe).join(', '),
    };
}

export type ConnectionState = 'live' | 'ended' | 'closed' | 'blocked';
export type ConnectionRow = {id: number; remoteAddress: string | undefined; remotePort: number | undefined; connectedAt: number;
    rx: number; tx: number; country?: string; state: ConnectionState; isNew: boolean};
export type FetchedConnection = Omit<ConnectionRow, 'state' | 'isNew'>;

/**
 * 설계 반영: 창이 열린 동안 줄 순서를 지킨다. 누르려던 버튼이 손가락 밑에서 움직이지 않게 한다.
 * 기존 줄은 자리와 표시를 지키며 값만 고치고, 서버 목록에서 사라진 줄은 "끝남"으로 남긴다. 새 연결은 맨 아래에 "새"로 붙는다.
 * 처음 읽을 때(prev 가 비었을 때)는 서버 순서 그대로이고 새 표시가 없다.
 */
export function mergeConnections(prev: readonly ConnectionRow[], fetched: readonly FetchedConnection[]): ConnectionRow[] {
    if(prev.length === 0) return fetched.map((connection) => ({...connection, state: 'live', isNew: false}));
    const byId = new Map(fetched.map((connection) => [connection.id, connection]));
    const kept = prev.map((row): ConnectionRow => {
        const next = byId.get(row.id);
        if(row.state === 'closed' || row.state === 'blocked') return row;
        return next ? {...row, ...next, state: 'live'} : {...row, state: 'ended'};
    });
    const known = new Set(prev.map((row) => row.id));
    const added = fetched.filter((connection) => !known.has(connection.id)).map((connection): ConnectionRow => ({...connection, state: 'live', isNew: true}));
    return [...kept, ...added];
}
