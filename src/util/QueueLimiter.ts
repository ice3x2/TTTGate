type QueueLimitInput = {
    incomingSize: number;
    localBufferedBytes: number;
    localBufferedLimit: number;
    globalBufferedBytes: number;
    globalBufferedLimit: number;
}

type QueueLimiter = {
    shouldSpillToFile(input: QueueLimitInput): boolean;
}

const DefaultQueueLimiter: QueueLimiter = {
    shouldSpillToFile(input: QueueLimitInput): boolean {
        const overLocal = input.localBufferedLimit > 0 && input.localBufferedBytes + input.incomingSize > input.localBufferedLimit;
        const overGlobal = input.globalBufferedLimit > 0 && input.globalBufferedBytes + input.incomingSize > input.globalBufferedLimit;
        return overLocal || overGlobal;
    }
};

let activeQueueLimiter: QueueLimiter = DefaultQueueLimiter;

const QueueLimiterRegistry = {
    current(): QueueLimiter {
        return activeQueueLimiter;
    },
    configure(queueLimiter: QueueLimiter): void {
        activeQueueLimiter = queueLimiter;
    },
    reset(): void {
        activeQueueLimiter = DefaultQueueLimiter;
    }
};

export { DefaultQueueLimiter, QueueLimitInput, QueueLimiter, QueueLimiterRegistry };
