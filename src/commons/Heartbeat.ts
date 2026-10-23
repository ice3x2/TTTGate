import {CtrlCmd, CtrlPacket} from "./CtrlPacket";

/**
 * 제어 연결 heartbeat(#230).
 *
 * TCP keepalive 는 첫 확인 시점만 정할 수 있고 재시도는 OS 기본값(Linux 약 11분)을 따른다. 중간 장비가 탐침에
 * 대신 답하면 끊김을 아예 알아채지 못한다. 그래서 클라이언트가 intervalMs 마다 ping 을 보내고 서버가 pong 으로
 * 답한다. 양쪽은 timeoutMs 동안 아무 제어 패킷도 받지 못하면 그 연결을 끊는다.
 * 상대가 heartbeat capability 를 알렸을 때만 시간 초과를 적용한다(구버전은 모르는 Message 를 무시한다).
 */
const HEARTBEAT_CAPABILITY = "heartbeat";

type HeartbeatPolicy = {intervalMs: number, timeoutMs: number};

const DEFAULT_HEARTBEAT_POLICY: Readonly<HeartbeatPolicy> = Object.freeze({intervalMs: 10_000, timeoutMs: 30_000});
const MIN_HEARTBEAT_INTERVAL_MS = 50;

/** 테스트용 조정 값(TTTGATE_HEARTBEAT_INTERVAL_MS, TTTGATE_HEARTBEAT_TIMEOUT_MS). 틀리면 기본값을 쓴다. */
const resolveHeartbeatPolicy = (env: {[key: string]: string | undefined}): HeartbeatPolicy => {
    const read = (name: string, fallback: number): number | undefined => {
        const raw = env[name];
        if(raw === undefined || raw.trim() === "") return fallback;
        return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : undefined;
    };
    const intervalMs = read("TTTGATE_HEARTBEAT_INTERVAL_MS", DEFAULT_HEARTBEAT_POLICY.intervalMs);
    const timeoutMs = read("TTTGATE_HEARTBEAT_TIMEOUT_MS", DEFAULT_HEARTBEAT_POLICY.timeoutMs);
    if(intervalMs === undefined || timeoutMs === undefined || intervalMs < MIN_HEARTBEAT_INTERVAL_MS || timeoutMs <= intervalMs) {
        return {...DEFAULT_HEARTBEAT_POLICY};
    }
    return {intervalMs, timeoutMs};
};

let activePolicy: HeartbeatPolicy = resolveHeartbeatPolicy(process.env);

const HeartbeatPolicyRegistry = {
    current(): HeartbeatPolicy {
        return activePolicy;
    },
    configure(policy: HeartbeatPolicy): void {
        activePolicy = {...policy};
    },
    reset(): void {
        activePolicy = resolveHeartbeatPolicy(process.env);
    }
};

/** heartbeat 메시지면 그 종류, 아니면 undefined. */
const heartbeatKindOf = (packet: CtrlPacket): "ping" | "pong" | undefined => {
    if(packet.cmd !== CtrlCmd.Message) return undefined;
    const meta = packet.messageMetaResult;
    if(meta.kind !== "valid") return undefined;
    return meta.value.type === "ping" || meta.value.type === "pong" ? meta.value.type : undefined;
};

const heartbeatPacket = (id: number, kind: "ping" | "pong"): Buffer => CtrlPacket.message(id, {type: kind, payload: {}}).toBuffer();

export {
    HEARTBEAT_CAPABILITY,
    HeartbeatPolicy,
    DEFAULT_HEARTBEAT_POLICY,
    resolveHeartbeatPolicy,
    HeartbeatPolicyRegistry,
    heartbeatKindOf,
    heartbeatPacket
};
