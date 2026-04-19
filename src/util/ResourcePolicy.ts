type ResourcePolicy = {
    defaultPoolQueueLimitBytes: number;
    fileCachePerHandlerLimitBytes: number;
    fileCacheGlobalLimitBytes: number;
    highWatermarkRatio: number;
    lowWatermarkRatio: number;
    httpRewriteDecompressLimitBytes: number;
};

type PartialResourcePolicy = Partial<ResourcePolicy>;

const DEFAULT_RESOURCE_POLICY: ResourcePolicy = {
    defaultPoolQueueLimitBytes: 64 * 1024 * 1024,
    fileCachePerHandlerLimitBytes: 32 * 1024 * 1024,
    fileCacheGlobalLimitBytes: 256 * 1024 * 1024,
    highWatermarkRatio: 0.75,
    lowWatermarkRatio: 0.5,
    httpRewriteDecompressLimitBytes: 8 * 1024 * 1024
};

let overrides: PartialResourcePolicy = {};

const clampRatio = (value: number, fallback: number): number => {
    if(!Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(0.95, Math.max(0.05, value));
};

const normalizeByteLimit = (value: number, fallback: number): number => {
    if(!Number.isFinite(value) || value <= 0) {
        return fallback;
    }
    return Math.floor(value);
};

const ResourcePolicyRegistry = {
    current(): ResourcePolicy {
        const highRatio = clampRatio(overrides.highWatermarkRatio ?? DEFAULT_RESOURCE_POLICY.highWatermarkRatio, DEFAULT_RESOURCE_POLICY.highWatermarkRatio);
        const lowRatioCandidate = clampRatio(overrides.lowWatermarkRatio ?? DEFAULT_RESOURCE_POLICY.lowWatermarkRatio, DEFAULT_RESOURCE_POLICY.lowWatermarkRatio);
        const lowRatio = Math.min(highRatio, lowRatioCandidate);

        return {
            defaultPoolQueueLimitBytes: normalizeByteLimit(
                overrides.defaultPoolQueueLimitBytes ?? DEFAULT_RESOURCE_POLICY.defaultPoolQueueLimitBytes,
                DEFAULT_RESOURCE_POLICY.defaultPoolQueueLimitBytes
            ),
            fileCachePerHandlerLimitBytes: normalizeByteLimit(
                overrides.fileCachePerHandlerLimitBytes ?? DEFAULT_RESOURCE_POLICY.fileCachePerHandlerLimitBytes,
                DEFAULT_RESOURCE_POLICY.fileCachePerHandlerLimitBytes
            ),
            fileCacheGlobalLimitBytes: normalizeByteLimit(
                overrides.fileCacheGlobalLimitBytes ?? DEFAULT_RESOURCE_POLICY.fileCacheGlobalLimitBytes,
                DEFAULT_RESOURCE_POLICY.fileCacheGlobalLimitBytes
            ),
            highWatermarkRatio: highRatio,
            lowWatermarkRatio: lowRatio,
            httpRewriteDecompressLimitBytes: normalizeByteLimit(
                overrides.httpRewriteDecompressLimitBytes ?? DEFAULT_RESOURCE_POLICY.httpRewriteDecompressLimitBytes,
                DEFAULT_RESOURCE_POLICY.httpRewriteDecompressLimitBytes
            )
        };
    },
    configure(policy: PartialResourcePolicy): void {
        overrides = {
            ...overrides,
            ...policy
        };
    },
    reset(): void {
        overrides = {};
    }
};

const computeWatermarkBytes = (limitBytes: number): {high: number, low: number} => {
    if(limitBytes <= 0) {
        return {high: Number.MAX_SAFE_INTEGER, low: Number.MAX_SAFE_INTEGER};
    }
    const policy = ResourcePolicyRegistry.current();
    const high = Math.max(1, Math.floor(limitBytes * policy.highWatermarkRatio));
    const low = Math.max(0, Math.floor(limitBytes * policy.lowWatermarkRatio));
    return {
        high,
        low: Math.min(high, low)
    };
};

export {
    computeWatermarkBytes,
    DEFAULT_RESOURCE_POLICY,
    PartialResourcePolicy,
    ResourcePolicy,
    ResourcePolicyRegistry
};
