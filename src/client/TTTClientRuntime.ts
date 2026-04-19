import {Scheduler, SchedulerRegistry} from "../util/Scheduler";

type TTTClientRuntime = {
    reconnectIntervalMs: number;
    scheduler: Scheduler;
}

type PartialTTTClientRuntime = {
    reconnectIntervalMs?: number;
    scheduler?: Scheduler;
}

const DEFAULT_RECONNECT_INTERVAL_MS = 5000;
let overrides: PartialTTTClientRuntime = {};

const TTTClientRuntimeRegistry = {
    current(): TTTClientRuntime {
        return {
            reconnectIntervalMs: overrides.reconnectIntervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS,
            scheduler: overrides.scheduler ?? SchedulerRegistry.current()
        };
    },
    configure(runtime: PartialTTTClientRuntime): void {
        overrides = {
            ...overrides,
            ...runtime
        };
    },
    reset(): void {
        overrides = {};
    }
};

export { DEFAULT_RECONNECT_INTERVAL_MS, TTTClientRuntime, TTTClientRuntimeRegistry };
