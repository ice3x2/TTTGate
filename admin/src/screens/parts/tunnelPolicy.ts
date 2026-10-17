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

export type TunnelPolicy = {
    restricted: boolean;
    canCreate(ownedCount: number): boolean;
    limitReached(ownedCount: number): boolean;
    maxTunnelCount: number;
    portHint(): string;
    initialPort(): number | null;
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
    portHint: () => '',
    initialPort: () => null,
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
        portHint: () => ranges.length === 0 ? 'No ports are allowed for your group.'
            : 'Allowed ranges: ' + ranges.map((range) => `${range.from}–${range.to}`).join(', '),
        initialPort: () => ranges.length === 0 ? null : ranges[0].from,
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

const ERROR_MESSAGES: Record<string, string> = {
    port_not_allowed: "This port is outside your group's allowed ranges.",
    protocol_not_allowed: 'This protocol is not allowed for your group.',
    rewrite_not_allowed: 'HTTP rewrite options are not allowed for your group.',
    trusted_client_not_allowed: 'One of the selected trusted clients is not allowed for your group.',
    tunnel_count_exceeded: 'You have reached your tunnel limit.',
};

export function tunnelErrorMessage(code: string | undefined, fallback: string): string {
    return (code !== undefined && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)) ? ERROR_MESSAGES[code] : fallback;
}
