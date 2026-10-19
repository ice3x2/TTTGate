import LoggerFactory from "./logger/LoggerFactory";

type ResourcePolicy = {
    defaultPoolQueueLimitBytes: number;
    /** 모든 클라이언트 풀의 대기열(열리는 중인 세션) 합의 상한(#183). 넘기는 세션을 닫고, 상단 워터마크에서 원천 읽기를 멈춘다. */
    globalPoolQueueLimitBytes: number;
    /** 모든 세션의 대역폭 큐 합의 상한(#183). 상단 워터마크에서 대역폭 정책이 걸린 세션의 원천 읽기를 멈춘다. */
    globalBandwidthQueueLimitBytes: number;
    /** 동시에 본문을 재작성하는 HTTP 응답들이 미리 잡는 바이트 합의 상한(#183). 넘으면 그 응답은 재작성하지 않고 그대로 보낸다. */
    globalHttpRewriteBytes: number;
    fileCachePerHandlerLimitBytes: number;
    fileCacheGlobalLimitBytes: number;
    highWatermarkRatio: number;
    lowWatermarkRatio: number;
    httpRewriteDecompressLimitBytes: number;
};

type PartialResourcePolicy = Partial<ResourcePolicy>;

const DEFAULT_RESOURCE_POLICY: ResourcePolicy = {
    // 풀(클라이언트) 하나가 전체 대기열 예산을 다 차지하지 못하게 전체의 절반으로 둔다(#183).
    defaultPoolQueueLimitBytes: 32 * 1024 * 1024,
    // 512MB 서버 기준(#183): 소켓 메모리 버퍼 128MiB + 대기열 64MiB + 대역폭 큐 64MiB + Node 기본 사용량 안에 든다.
    globalPoolQueueLimitBytes: 64 * 1024 * 1024,
    globalBandwidthQueueLimitBytes: 64 * 1024 * 1024,
    // 재작성 중에는 본문·압축 해제·복사본이 함께 잡히므로 예약 합을 작게 둔다(최대 크기 응답 2개).
    globalHttpRewriteBytes: 32 * 1024 * 1024,
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
            globalPoolQueueLimitBytes: normalizeByteLimit(
                overrides.globalPoolQueueLimitBytes ?? DEFAULT_RESOURCE_POLICY.globalPoolQueueLimitBytes,
                DEFAULT_RESOURCE_POLICY.globalPoolQueueLimitBytes,
                "globalPoolQueueLimitBytes"
            ),
            globalBandwidthQueueLimitBytes: normalizeByteLimit(
                overrides.globalBandwidthQueueLimitBytes ?? DEFAULT_RESOURCE_POLICY.globalBandwidthQueueLimitBytes,
                DEFAULT_RESOURCE_POLICY.globalBandwidthQueueLimitBytes,
                "globalBandwidthQueueLimitBytes"
            ),
            globalHttpRewriteBytes: normalizeByteLimit(
                overrides.globalHttpRewriteBytes ?? DEFAULT_RESOURCE_POLICY.globalHttpRewriteBytes,
                DEFAULT_RESOURCE_POLICY.globalHttpRewriteBytes,
                "globalHttpRewriteBytes"
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
