import {ADMIT, AdmissionDecision} from "./AdmissionPolicy";

// U5-08 / #123 — PRD 속성 6 max_concurrent_connections. 수락 판정의 마지막 단계다.
// 판정 시점에 소유자·그룹을 읽는다. 소유자 이전·그룹 속성 변경이 configureTunnel 을 거치지 않으므로 캐시를 두지 않는다.

export type ConcurrencyContext = {
    ownerOf(port: number): {userId: string; groupId: string; role: 'superuser' | 'regular'} | undefined;
    groupAttributes(groupId: string): {max_concurrent_connections: number};
    portsOfGroup(groupId: string): number[];
};

export type ConcurrencyDenial = {groupId: string; limit: number; sessions: number};

const CONCURRENCY_LIMIT: AdmissionDecision = Object.freeze({allowed: false, reason: 'concurrency-limit'});

export class ConcurrencyLimiter {
    private readonly _context: ConcurrencyContext;
    private readonly _sessionsOf: (port: number) => number;

    public constructor(context: ConcurrencyContext, sessionsOf: (port: number) => number) {
        this._context = context;
        this._sessionsOf = sessionsOf;
    }

    /** 일반 유저 그룹의 모든 터널 세션 합이 상한에 이르면 거절한다. 상한 0 은 무제한(max_tunnel_duration_ms 와 같은 규약). */
    public decide(port: number): {decision: AdmissionDecision; denial?: ConcurrencyDenial} {
        const owner = this._context.ownerOf(port);
        if(owner === undefined || owner.role === 'superuser') return {decision: ADMIT};
        const limit = this._context.groupAttributes(owner.groupId).max_concurrent_connections;
        if(!(limit > 0)) return {decision: ADMIT};
        let sessions = 0;
        for(const groupPort of this._context.portsOfGroup(owner.groupId)) sessions += this._sessionsOf(groupPort);
        if(sessions >= limit) return {decision: CONCURRENCY_LIMIT, denial: {groupId: owner.groupId, limit, sessions}};
        return {decision: ADMIT};
    }
}
