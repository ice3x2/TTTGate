import type {Role} from "../rbac/IdentityTypes";
import LoggerFactory from "../../util/logger/LoggerFactory";
import {redactSecrets} from "../../util/SecretRedactor";

const logger = LoggerFactory.getLogger('server', 'AuditSink');

/** 행위자. 사용자 요청이 아닌 내부 가드가 남기는 이벤트는 'system' 을 쓴다. */
export type AuditActor = {userId: string; username: string; role?: Role} | {userId: 'system'};

export type AuditTargetKind = 'user' | 'group' | 'tunnel' | 'server' | 'session' | 'security';

export type AuditTarget = {kind: AuditTargetKind; id: string};

/** type 문자열 목록은 4 단위 설계 §2.2 가 확정하며 #109 (U4-01) 이 상수 파일로 옮긴다. */
export type AuditEvent = {
    at: number;
    actor: AuditActor;
    sessionIdHash?: string;
    ip?: string;
    type: string;
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
