type TimeoutHandle = ReturnType<typeof setTimeout>;
type IntervalHandle = ReturnType<typeof setInterval>;
type ImmediateHandle = ReturnType<typeof setImmediate>;

type Scheduler = {
    setTimeout(handler: () => void, timeoutMs: number): TimeoutHandle;
    clearTimeout(handle: TimeoutHandle | undefined): void;
    setInterval(handler: () => void, timeoutMs: number): IntervalHandle;
    clearInterval(handle: IntervalHandle | undefined): void;
    setImmediate(handler: () => void): ImmediateHandle;
}

const DefaultScheduler: Scheduler = {
    setTimeout(handler: () => void, timeoutMs: number): TimeoutHandle {
        return setTimeout(handler, timeoutMs);
    },
    clearTimeout(handle: TimeoutHandle | undefined): void {
        if(handle) {
            clearTimeout(handle);
        }
    },
    setInterval(handler: () => void, timeoutMs: number): IntervalHandle {
        return setInterval(handler, timeoutMs);
    },
    clearInterval(handle: IntervalHandle | undefined): void {
        if(handle) {
            clearInterval(handle);
        }
    },
    setImmediate(handler: () => void): ImmediateHandle {
        return setImmediate(handler);
    }
};

let activeScheduler: Scheduler = DefaultScheduler;

const SchedulerRegistry = {
    current(): Scheduler {
        return activeScheduler;
    },
    configure(scheduler: Scheduler): void {
        activeScheduler = scheduler;
    },
    reset(): void {
        activeScheduler = DefaultScheduler;
    }
};

export { DefaultScheduler, IntervalHandle, ImmediateHandle, Scheduler, SchedulerRegistry, TimeoutHandle };
