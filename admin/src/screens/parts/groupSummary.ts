import type {GroupAttributes, TunnelProtocolName} from '../../controller/Types';
import {i18n, type Translator} from '../../i18n';

// U3-04: 그룹 카드 2행의 속성 요약. 프로토콜은 서버가 준 순서에 기대지 않고 고정 순서로 정렬한다.
const PROTOCOL_ORDER: ReadonlyArray<TunnelProtocolName> = ['TCP', 'HTTP', 'HTTPS', 'HTTP_REWRITE'];

// 이슈 349: 낱말은 정한 언어로 만들고 코드 값(crud=, 프로토콜 이름)은 그대로 둔다.
export function summarizeAttributes(a: GroupAttributes, tr: Translator = i18n()): string {
    const ranges = a.allowed_port_range.length === 0 ? tr.t('group.summaryNoPorts') : a.allowed_port_range.map((range) => `${range.from}-${range.to}`).join(', ');
    const protocols = PROTOCOL_ORDER.filter((protocol) => a.allowed_protocols.includes(protocol));
    return [`crud=${a.tunnel_crud}`, tr.t('group.summaryTunnels', {max: a.max_tunnel_count}), tr.t('group.summaryPorts', {ranges}),
        protocols.length === 0 ? tr.t('group.summaryNoProtocols') : protocols.join(',')].join(' · ');
}
