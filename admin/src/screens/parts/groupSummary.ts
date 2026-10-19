import type {GroupAttributes, TunnelProtocolName} from '../../controller/Types';

// U3-04: 그룹 카드 2행의 속성 요약. 프로토콜은 서버가 준 순서에 기대지 않고 고정 순서로 정렬한다.
const PROTOCOL_ORDER: ReadonlyArray<TunnelProtocolName> = ['TCP', 'HTTP', 'HTTPS', 'HTTP_REWRITE'];

export function summarizeAttributes(a: GroupAttributes): string {
    const ranges = a.allowed_port_range.length === 0 ? 'none' : a.allowed_port_range.map((range) => `${range.from}-${range.to}`).join(', ');
    const protocols = PROTOCOL_ORDER.filter((protocol) => a.allowed_protocols.includes(protocol));
    return [`crud=${a.tunnel_crud}`, `tunnels≤${a.max_tunnel_count}`, `ports ${ranges}`, protocols.length === 0 ? 'none' : protocols.join(',')].join(' · ');
}
