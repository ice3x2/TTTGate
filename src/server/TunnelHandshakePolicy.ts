type TunnelHandshakePolicy = {
    /** 바인드 시각부터 인증까지의 절대 기한(ms). 유휴 시간이 아니다. */
    timeoutMs: number;
    /**
     * 미인증 슬롯이 절반 넘게 찼을 때 새 연결에 주는 기한(ms). 평소에는 약한 서버를 위해 넉넉한 timeoutMs 를 주고,
     * 슬롯을 채우는 공격이 오면 이 값으로 줄여 슬롯 점유 비용을 다시 높인다(#181).
     */
    underPressureTimeoutMs: number;
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

/**
 * 기본값은 운영 서버(0.5코어·512MB, 스왑 사용) 기준이다(#181). 스왑 멈춤이 몇 초씩 걸려도 정상 클라이언트의
 * TLS·v2 핸드셰이크가 잘리지 않게 15초를 둔다. 미인증 연결의 개수 상한은 그대로라 슬롯 점유의 상한은 같다.
 */
const DEFAULT_TUNNEL_HANDSHAKE_POLICY: TunnelHandshakePolicy = {
    timeoutMs: 15_000,
    underPressureTimeoutMs: 5_000,
    maxUnauthenticatedConnections: 256,
    maxUnauthenticatedPerAddress: 32,
    maxPendingDataConnections: 1024,
    maxPendingDataPerAddress: 256,
    // 클라이언트의 엔드포인트 연결 기한(45초, #179)보다 길어야 클라이언트가 먼저 실패를 알린다.
    pendingSessionOpenTimeoutMs: 60_000
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
            underPressureTimeoutMs: normalizePositiveInt(
                overrides.underPressureTimeoutMs ?? DEFAULT_TUNNEL_HANDSHAKE_POLICY.underPressureTimeoutMs,
                DEFAULT_TUNNEL_HANDSHAKE_POLICY.underPressureTimeoutMs
            ),
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
