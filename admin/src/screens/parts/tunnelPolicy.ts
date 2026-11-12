import type {GroupAttributes, MeResponse, TunnelProtocolName} from '../../controller/Types';

// U3-06: 터널 화면이 그룹 속성을 반영하는 규칙. 순수 모듈이라 .svelte 와 svelte 패키지를 import 하지 않는다
// (test/admin/tunnelPolicy.test.ts 가 ts-jest 로 직접 부른다). 서버가 최종 판정하므로 여기서는 표시와 기본값만 정한다.

export type HttpOptionLike = {
    replaceAccessControlAllowOrigin?: boolean;
    rewriteHostInTextBody?: boolean;
    customRequestHeaders?: Array<{name: string; value: string}>;
    customResponseHeaders?: Array<{name: string; value: string}>;
    bodyRewriteRules?: Array<{from: string; to: string}>;
};

export const PROTOCOLS: Array<{value: string; label: string}> = [
    {value: 'tcp', label: 'TCP'}, {value: 'http', label: 'HTTP (http/1.1)'}, {value: 'https', label: 'HTTPS (http/1.1)'},
];

const PROTOCOL_NAME: Record<string, TunnelProtocolName> = {tcp: 'TCP', http: 'HTTP', https: 'HTTPS'};

export type PortRange = {from: number; to: number};

/** 이슈 365 FR-6(설계 반영): 범위 안에서 usedPorts 에 없는 가장 작은 포트. 다 쓰였으면 null 이다. 최종 판정은 서버가 한다. */
export function suggestPort(range: PortRange, usedPorts: readonly number[]): number | null {
    const used = new Set(usedPorts);
    for(let port = range.from; port <= range.to; port++) {
        if(!used.has(port)) return port;
    }
    return null;
}

/** 이슈 365: 칩 하나의 글자와 누르면 넣을 포트. port 가 null 이면 범위를 모두 써서 잠근 칩이다. */
export type RangeChip = {label: string; port: number | null};

export function rangeChips(ranges: ReadonlyArray<PortRange>, usedPorts: readonly number[]): RangeChip[] {
    return ranges.map((range) => ({label: `${range.from}–${range.to}`, port: suggestPort(range, usedPorts)}));
}

/** 같은 범위가 두 번 저장된 그룹도 있다(서버가 막지 않는다). 처음 나온 순서로 한 번씩만 남긴다. */
const distinctRanges = (ranges: ReadonlyArray<PortRange>): PortRange[] => {
    const seen = new Set<string>();
    return ranges.filter((range) => {
        const key = `${range.from}-${range.to}`;
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
    }).map((range) => ({from: range.from, to: range.to}));
};

export type TunnelPolicy = {
    restricted: boolean;
    canCreate(ownedCount: number): boolean;
    limitReached(ownedCount: number): boolean;
    maxTunnelCount: number;
    /** 이슈 365: 새 터널의 처음 포트. 목록의 터널이 쓰는 포트(usedPorts)는 건너뛴다. 모두 쓰였으면 첫 범위의 첫 포트다. */
    initialPort(usedPorts?: readonly number[]): number | null;
    /** 이슈 365 FR-6: 칩으로 보일 그룹의 허용 범위. 같은 범위는 한 번만 담는다. 제한이 없으면 빈 목록이다. */
    portRanges: ReadonlyArray<PortRange>;
    isPortAllowed(port: number): boolean;
    protocolOptions(current: 'tcp' | 'http' | 'https'): Array<{value: string; label: string}>;
    showHttpOptions: boolean;
    rewrite: {cors: boolean; host: boolean; header: boolean; body: boolean};
    trustedClients: string[];
    normalizeHttpOption(option: {protocol?: string; httpOption?: HttpOptionLike}): void;
};

const UNRESTRICTED: TunnelPolicy = {
    restricted: false,
    canCreate: () => true,
    limitReached: () => false,
    maxTunnelCount: 0,
    initialPort: () => null,
    portRanges: [],
    isPortAllowed: () => true,
    protocolOptions: () => PROTOCOLS,
    showHttpOptions: true,
    rewrite: {cors: true, host: true, header: true, body: true},
    trustedClients: [],
    normalizeHttpOption: () => {},
};

function restrictedPolicy(attributes: GroupAttributes): TunnelPolicy {
    const ranges = attributes.allowed_port_range;
    const max = attributes.max_tunnel_count;
    const full = attributes.tunnel_crud === 'full';
    const rewrite = {...attributes.http_tunnel_rewrite_permissions};
    return {
        restricted: true,
        canCreate: (ownedCount) => full && max > 0 && ownedCount < max,
        limitReached: (ownedCount) => full && max > 0 && ownedCount >= max,
        maxTunnelCount: max,
        initialPort: (usedPorts = []) => {
            if(ranges.length === 0) return null;
            for(const range of ranges) {
                const port = suggestPort(range, usedPorts);
                if(port !== null) return port;
            }
            return ranges[0].from;
        },
        portRanges: distinctRanges(ranges),
        isPortAllowed: (port) => ranges.some((range) => port >= range.from && port <= range.to),
        protocolOptions: (current) => {
            const allowed = PROTOCOLS.filter((protocol) => attributes.allowed_protocols.includes(PROTOCOL_NAME[protocol.value]));
            if(allowed.some((protocol) => protocol.value === current)) return allowed;
            // 기존 터널의 실제 값은 허용 밖이어도 보이게 맨 앞에 둔다.
            const own = PROTOCOLS.find((protocol) => protocol.value === current);
            return own ? [own, ...allowed] : allowed;
        },
        showHttpOptions: attributes.allowed_protocols.includes('HTTP_REWRITE'),
        rewrite,
        trustedClients: [...attributes.allowed_trusted_clients],
        normalizeHttpOption: (option) => {
            const http = option.httpOption;
            if(!http) return;
            // 서버는 프로토콜과 무관하게 리라이트 플래그로 HTTP_REWRITE 를 요구한다. TCP 는 넷 다 끈다.
            const tcp = option.protocol === 'tcp';
            if(tcp || !rewrite.cors) http.replaceAccessControlAllowOrigin = false;
            if(tcp || !rewrite.host) http.rewriteHostInTextBody = false;
            if(tcp || !rewrite.header) {
                http.customRequestHeaders = [];
                http.customResponseHeaders = [];
            }
            if(tcp || !rewrite.body) http.bodyRewriteRules = [];
        },
    };
}

export function tunnelPolicy(me: MeResponse): TunnelPolicy {
    return me.user.role === 'superuser' ? UNRESTRICTED : restrictedPolicy(me.group.attributes);
}

