import type {Role} from "../rbac/IdentityTypes";
import type {AuditEventType} from "./AuditEventTypes";
import LoggerFactory from "../../util/logger/LoggerFactory";
import {redactSecrets} from "../../util/SecretRedactor";

const logger = LoggerFactory.getLogger('server', 'AuditSink');

/** 행위자. 사용자 요청이 아닌 내부 가드가 남기는 이벤트는 'system' 을 쓴다. */
export type AuditActor = {userId: string; username: string; role?: Role} | {userId: 'system'};

export type AuditTargetKind = 'user' | 'group' | 'tunnel' | 'server' | 'session' | 'security';

export type AuditTarget = {kind: AuditTargetKind; id: string};

/** type 이름은 AuditEventTypes.ts 의 표가 확정한다(설계 §2.2). */
export type AuditEvent = {
    at: number;
    actor: AuditActor;
    sessionIdHash?: string;
    ip?: string;
    type: AuditEventType;
    target?: AuditTarget;
    outcome: 'success' | 'failure';
    summary: string;
    detail?: Record<string, unknown>;
};

export interface AuditSink {
    /**
     * 기록할 자리가 있으면 true. false 면 호출자는 작업을 실행하지 않는다.
     * 드롭 금지(NFR-PERF-AUDIT-WRITE-001)를 배압으로 표현하는 유일한 지점이다.
     */
    reserve(): boolean;
    record(event: AuditEvent): Promise<void>;
}

/** 기본 싱크. 파일 저장은 #109 (U4-01) 의 FileAuditSink 가 맡는다. */
export class LoggerAuditSink implements AuditSink {
    private readonly _write: (line: string) => void;

    public constructor(write: (line: string) => void = (line) => logger.info(line)) {
        this._write = write;
    }

    public reserve(): boolean {
        return true;
    }

    public record(event: AuditEvent): Promise<void> {
        this._write(`audit ${JSON.stringify(redactSecrets(event))}`);
        return Promise.resolve();
    }
}

let currentSink: AuditSink = new LoggerAuditSink();

/**
 * 감사 이벤트를 싱크로 보내는 유일한 진입점. detail 마스킹은 여기서만 한다.
 * sink.record 를 직접 부르면 그 마스킹을 건너뛰므로, 기록은 반드시 이 함수를 거친다.
 * (마스킹은 마지막 안전망이지 detail 에 비밀값을 담아도 된다는 허가가 아니다.)
 */
export function recordAuditEvent(event: AuditEvent, sink: AuditSink = AuditSinkRegistry.current()): Promise<void> {
    return sink.record(event.detail === undefined ? event : {...event, detail: redactSecrets(event.detail)});
}

export const AuditSinkRegistry = {
    current(): AuditSink {
        return currentSink;
    },
    set(sink: AuditSink): void {
        currentSink = sink;
    },
    reset(): void {
        currentSink = new LoggerAuditSink();
    }
};
