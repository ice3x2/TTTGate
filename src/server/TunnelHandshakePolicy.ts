type TunnelHandshakePolicy = {
    timeoutMs: number;
    maxUnauthenticatedConnections: number;
};

type PartialTunnelHandshakePolicy = Partial<TunnelHandshakePolicy>;

const DEFAULT_TUNNEL_HANDSHAKE_POLICY: TunnelHandshakePolicy = {
    timeoutMs: 5000,
    maxUnauthenticatedConnections: 32
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
