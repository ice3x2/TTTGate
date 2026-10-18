type TunnelHandshakePolicy = {
    /** 바인드 시각부터 인증까지의 절대 기한(ms). 유휴 시간이 아니다. */
    timeoutMs: number;
    /** 프로세스 전체의 미인증 연결 상한. */
    maxUnauthenticatedConnections: number;
    /** 원격 주소 하나가 차지할 수 있는 미인증 연결 상한. 한 주소가 전체 슬롯을 차지하지 못하게 한다(#157). */
    maxUnauthenticatedPerAddress: number;
    /**
     * 아직 세션에 붙지 않은 데이터 연결의 상한(전체·주소별). 데이터 연결은 첫 바이트('D')로 구분되는 순간 제어 예산에서 빠져
     * 이 예산으로 옮긴다. 미인증 제어 연결이 슬롯을 채워도 정상 세션의 데이터 연결이 막히지 않게 한다(#157).
     */
    maxPendingDataConnections: number;
    maxPendingDataPerAddress: number;
    /**
     * 세션을 연 뒤 데이터 연결과 엔드포인트 연결 결과를 기다리는 기한(ms). 데이터 연결이 끝내 오지 않으면
     * 세션 TTL(기본 1시간)까지 외부 연결이 남으므로 이 기한에 정리한다(#174).
     */
    pendingSessionOpenTimeoutMs: number;
};

type PartialTunnelHandshakePolicy = Partial<TunnelHandshakePolicy>;

const DEFAULT_TUNNEL_HANDSHAKE_POLICY: TunnelHandshakePolicy = {
    timeoutMs: 5000,
    maxUnauthenticatedConnections: 256,
    maxUnauthenticatedPerAddress: 32,
    maxPendingDataConnections: 1024,
    maxPendingDataPerAddress: 256,
    pendingSessionOpenTimeoutMs: 30_000
};

let overrides: PartialTunnelHandshakePolicy = {};

const normalizePositiveInt = (value: number, fallback: number): number => {
    if(!Number.isFinite(value) || value <= 0) {
        return fallback;
    }
    return Math.floor(value);
};

const TunnelHandshakePolicyRegistry = {
    current(): TunnelHandshakePolicy {
        return {
            timeoutMs: normalizePositiveInt(overrides.timeoutMs ?? DEFAULT_TUNNEL_HANDSHAKE_POLICY.timeoutMs, DEFAULT_TUNNEL_HANDSHAKE_POLICY.timeoutMs),
            maxUnauthenticatedConnections: normalizePositiveInt(
                overrides.maxUnauthenticatedConnections ?? DEFAULT_TUNNEL_HANDSHAKE_POLICY.maxUnauthenticatedConnections,
                DEFAULT_TUNNEL_HANDSHAKE_POLICY.maxUnauthenticatedConnections
            ),
            maxUnauthenticatedPerAddress: normalizePositiveInt(
                overrides.maxUnauthenticatedPerAddress ?? DEFAULT_TUNNEL_HANDSHAKE_POLICY.maxUnauthenticatedPerAddress,
                DEFAULT_TUNNEL_HANDSHAKE_POLICY.maxUnauthenticatedPerAddress
            ),
            maxPendingDataConnections: normalizePositiveInt(
                overrides.maxPendingDataConnections ?? DEFAULT_TUNNEL_HANDSHAKE_POLICY.maxPendingDataConnections,
                DEFAULT_TUNNEL_HANDSHAKE_POLICY.maxPendingDataConnections
            ),
            maxPendingDataPerAddress: normalizePositiveInt(
                overrides.maxPendingDataPerAddress ?? DEFAULT_TUNNEL_HANDSHAKE_POLICY.maxPendingDataPerAddress,
                DEFAULT_TUNNEL_HANDSHAKE_POLICY.maxPendingDataPerAddress
            ),
            pendingSessionOpenTimeoutMs: normalizePositiveInt(
                overrides.pendingSessionOpenTimeoutMs ?? DEFAULT_TUNNEL_HANDSHAKE_POLICY.pendingSessionOpenTimeoutMs,
                DEFAULT_TUNNEL_HANDSHAKE_POLICY.pendingSessionOpenTimeoutMs
            )
        };
    },
    configure(policy: PartialTunnelHandshakePolicy): void {
        overrides = {
            ...overrides,
            ...policy
        };
    },
    reset(): void {
        overrides = {};
    }
};

export {
    DEFAULT_TUNNEL_HANDSHAKE_POLICY,
    PartialTunnelHandshakePolicy,
    TunnelHandshakePolicy,
    TunnelHandshakePolicyRegistry
};
