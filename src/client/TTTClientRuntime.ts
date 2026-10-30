import {Scheduler, SchedulerRegistry} from "../util/Scheduler";

type TTTClientRuntime = {
    reconnectIntervalMs: number;
    /** #255: 제어 연결 접속(TLS 핸드셰이크 포함)을 끝내야 하는 기한. */
    controlConnectTimeoutMs: number;
    /** #255: SyncCtrl 을 보낸 뒤 핸드셰이크(SyncCtrlAck 수신과 AckCtrl 전송)를 끝내야 하는 기한. */
    syncAckTimeoutMs: number;
    scheduler: Scheduler;
}

type PartialTTTClientRuntime = {
    reconnectIntervalMs?: number;
    controlConnectTimeoutMs?: number;
    syncAckTimeoutMs?: number;
    scheduler?: Scheduler;
}

const DEFAULT_RECONNECT_INTERVAL_MS = 5000;
const DEFAULT_CONTROL_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_SYNC_ACK_TIMEOUT_MS = 30_000;
let overrides: PartialTTTClientRuntime = {};

const TTTClientRuntimeRegistry = {
    current(): TTTClientRuntime {
        return {
            reconnectIntervalMs: overrides.reconnectIntervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS,
            controlConnectTimeoutMs: overrides.controlConnectTimeoutMs ?? DEFAULT_CONTROL_CONNECT_TIMEOUT_MS,
            syncAckTimeoutMs: overrides.syncAckTimeoutMs ?? DEFAULT_SYNC_ACK_TIMEOUT_MS,
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
