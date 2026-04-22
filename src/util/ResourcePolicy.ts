import LoggerFactory from "./logger/LoggerFactory";

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

// R2-REQ-06: strict 모드 — 잘못된 입력 시 throw. 기본은 WARN + clamp(하위 호환).
let strict: boolean = process.env.RESOURCE_POLICY_STRICT === "1";

const getLogger = () => {
    try {
        return LoggerFactory.getLogger("boot", "ResourcePolicy");
    } catch {
        return undefined;
    }
};

const warn = (msg: string): void => {
    const logger = getLogger();
    if(logger) {
        logger.warn(msg);
    } else {
        console.warn(msg);
    }
};

const clampRatio = (value: number, fallback: number, fieldName: string): number => {
    if(!Number.isFinite(value)) {
        const msg = `ResourcePolicy: invalid ${fieldName}=${String(value)}, clamped to ${fallback}`;
        if(strict) throw new RangeError(msg);
        warn(msg);
        return fallback;
    }
    if(value > 0.95 || value < 0.05) {
        const msg = `ResourcePolicy: ${fieldName}=${value} out of range [0.05, 0.95]`;
        if(strict) throw new RangeError(msg);
        warn(msg);
    }
    return Math.min(0.95, Math.max(0.05, value));
};

const normalizeByteLimit = (value: number, fallback: number, fieldName: string): number => {
    if(!Number.isFinite(value) || value <= 0) {
        const msg = `ResourcePolicy: invalid ${fieldName}=${String(value)}, clamped to ${fallback}`;
        if(strict) throw new RangeError(msg);
        warn(msg);
        return fallback;
    }
    return Math.floor(value);
};

const ResourcePolicyRegistry = {
    current(): ResourcePolicy {
        const highRatio = clampRatio(
            overrides.highWatermarkRatio ?? DEFAULT_RESOURCE_POLICY.highWatermarkRatio,
            DEFAULT_RESOURCE_POLICY.highWatermarkRatio,
            "highWatermarkRatio"
        );
        const lowRatioCandidate = clampRatio(
            overrides.lowWatermarkRatio ?? DEFAULT_RESOURCE_POLICY.lowWatermarkRatio,
            DEFAULT_RESOURCE_POLICY.lowWatermarkRatio,
            "lowWatermarkRatio"
        );
        const lowRatio = Math.min(highRatio, lowRatioCandidate);

        return {
            defaultPoolQueueLimitBytes: normalizeByteLimit(
                overrides.defaultPoolQueueLimitBytes ?? DEFAULT_RESOURCE_POLICY.defaultPoolQueueLimitBytes,
                DEFAULT_RESOURCE_POLICY.defaultPoolQueueLimitBytes,
                "defaultPoolQueueLimitBytes"
            ),
            fileCachePerHandlerLimitBytes: normalizeByteLimit(
                overrides.fileCachePerHandlerLimitBytes ?? DEFAULT_RESOURCE_POLICY.fileCachePerHandlerLimitBytes,
                DEFAULT_RESOURCE_POLICY.fileCachePerHandlerLimitBytes,
                "fileCachePerHandlerLimitBytes"
            ),
            fileCacheGlobalLimitBytes: normalizeByteLimit(
                overrides.fileCacheGlobalLimitBytes ?? DEFAULT_RESOURCE_POLICY.fileCacheGlobalLimitBytes,
                DEFAULT_RESOURCE_POLICY.fileCacheGlobalLimitBytes,
                "fileCacheGlobalLimitBytes"
            ),
            highWatermarkRatio: highRatio,
            lowWatermarkRatio: lowRatio,
            httpRewriteDecompressLimitBytes: normalizeByteLimit(
                overrides.httpRewriteDecompressLimitBytes ?? DEFAULT_RESOURCE_POLICY.httpRewriteDecompressLimitBytes,
                DEFAULT_RESOURCE_POLICY.httpRewriteDecompressLimitBytes,
                "httpRewriteDecompressLimitBytes"
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
    },
    /**
     * R2-REQ-06: strict 모드 토글. strict=true일 때 부적합 입력은 RangeError throw.
     * 기본값은 `process.env.RESOURCE_POLICY_STRICT === "1"`.
     */
    configureStrict(on: boolean): void {
        strict = on;
    },
    isStrict(): boolean {
        return strict;
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
