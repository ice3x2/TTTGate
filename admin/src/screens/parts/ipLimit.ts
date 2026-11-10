import type {Options, TunnelingStatus} from '../../controller/Options';

// 이슈 348 — 터널 목록 줄의 IP 제한 토글과 내 IP 갱신 버튼(FR-16·FR-17·FR-18). 화면은 이 결과를 그리기만 한다.
// 토글은 터널의 켜짐·꺼짐과 독립이다. 터널이 꺼졌거나 리스너가 없어도 같은 규칙으로 보인다(FR-2a).

export type IpLimitView = {
    on: boolean;
    /** 버튼 안의 글자. 켜져 있으면 내 허용 IP 다(긴 IPv6 는 CSS 가 줄임표로 줄인다). */
    text: string;
    /** 다른 사용자 항목 수(+N). 없으면 undefined. */
    extra?: string;
    /** 켜져 있는데 내 항목이 없다(경고색). */
    warn: boolean;
    /** 눌러서 요청을 보낼 수 있는가. */
    pressable: boolean;
    /** 켜져 있지만 켜기 권한만 있어 끌 수 없다(잠긴 켜짐). 흐리게 보이지 않는다. */
    locked: boolean;
    /** 보조 기술용 이름. title 도 같은 값이다(전체 주소를 담는다). */
    label: string;
    title: string;
    refresh: {enabled: boolean; emphasized: boolean; label: string};
};

const REFRESH_LABEL = 'Update to my IP';

export function ipLimitView(input: {option: Options; status?: TunnelingStatus; requesterIp: string | null; busy?: boolean}): IpLimitView | undefined {
    const {option, status, requesterIp, busy = false} = input;
    // 켜기 권한이 없는 줄(자물쇠)에는 없다. 옛 서버 응답에는 toggleable 이 없으므로 editable 을 따른다.
    if((option.toggleable ?? option.editable) === false) return undefined;
    const editable = option.editable !== false;
    const on = status?.activatorIpOnly ?? option.activatorIpOnly ?? false;
    const myIp = status?.myAllowedIp ?? null;
    const others = Math.max(0, (status?.allowedIpCount ?? 0) - (myIp === null ? 0 : 1));
    // 끄기는 고치기 권한이 필요하다. 켜기 권한만 있으면 켜진 토글은 잠긴 켜짐이다(FR-12).
    const locked = on && !editable;
    // 상태를 아직 못 읽었으면 내 항목을 모르므로 경고·강조하지 않는다.
    const refresh = {enabled: on && !busy, emphasized: on && status !== undefined && requesterIp !== null && requesterIp !== myIp, label: REFRESH_LABEL};
    if(!on) {
        return {on, text: 'IP limit off', extra: undefined, warn: false, pressable: !busy, locked: false, label: 'IP limit, off', title: 'IP limit, off', refresh};
    }
    if(status === undefined) {
        const label = ['IP limit, on', ...(locked ? ["can't turn off"] : [])].join(', ');
        return {on, text: 'IP limit on', extra: undefined, warn: false, pressable: !locked && !busy, locked, label, title: label, refresh};
    }
    const label = ['IP limit, on', myIp === null ? 'your IP is not allowed' : `allowed IP ${myIp}`,
        ...(others > 0 ? [`and ${others} more`] : []), ...(locked ? ["can't turn off"] : [])].join(', ');
    return {on, text: myIp ?? 'My IP not set', extra: others > 0 ? `+${others}` : undefined, warn: myIp === null,
        pressable: !locked && !busy, locked, label, title: label, refresh};
}

/**
 * IP 제한·갱신 요청이 성공한 뒤의 목록과 상태. 상태 항목이 있으면 그 항목에 결과를 덮는다(없으면 만들지 않는다).
 * IP 제한을 바꾼 결과는 상태 항목이 아직 없어도 목록에 남겨, 다음 상태를 읽기 전에도 토글이 새 값을 보이게 한다.
 */
export function withIpResult(current: {options: Options[]; statuses: Record<number, TunnelingStatus>}, port: number,
                             applied: Partial<TunnelingStatus>): {options: Options[]; statuses: Record<number, TunnelingStatus>} {
    const before = current.statuses[port];
    const statuses = before ? {...current.statuses, [port]: {...before, ...applied}} : current.statuses;
    const next = applied.activatorIpOnly;
    const options = next === undefined ? current.options
        : current.options.map((option) => option.forwardPort === port ? {...option, activatorIpOnly: next} : option);
    return {options, statuses};
}
