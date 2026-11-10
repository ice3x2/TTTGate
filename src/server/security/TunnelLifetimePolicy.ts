import type {Role} from "../rbac/IdentityTypes";

// U5-07 / #122 — PRD 속성 3 max_tunnel_duration_ms 의 집행 값. 시계를 읽지 않는 순수 함수다.

type Subject = {groupId: string; role: Role};

export type LifetimeContext = {
    ownerOf(port: number): {userId: string; groupId: string; role: Role} | undefined;
    groupAttributes(groupId: string): {max_tunnel_duration_ms: number};
    /** 이슈 347: 켠 사람. 삭제되었거나 그 포트의 켜기 권한을 잃었으면 undefined 다. */
    activatorOf(userId: string, port: number): Subject | undefined;
};

/** 한 사람의 그룹 상한(ms). 슈퍼유저와 0 이하는 상한이 없다. */
function limitMsOf(subject: Subject | undefined, context: LifetimeContext): number | undefined {
    if(subject === undefined || subject.role === 'superuser') return undefined;
    const limitMs = context.groupAttributes(subject.groupId).max_tunnel_duration_ms;
    return limitMs > 0 ? limitMs : undefined;
}

/**
 * 포트의 최대 활성 시간(초). 상한이 없으면 undefined 다.
 * 이슈 347: 소유자 그룹 상한과 켠 사람 그룹 상한 중 짧은 값이다. 상한이 없는 쪽(system:migrated·슈퍼유저·0)은 비교에서 뺀다.
 * active(port, timeout) 의 timeout 은 초 단위 정수라 올림한다. 내림하면 1..999ms 상한이 0(= 타이머 없음)이 된다.
 */
export function maxActiveSeconds(port: number, context: LifetimeContext, activatorId?: string): number | undefined {
    const limits = [limitMsOf(context.ownerOf(port), context),
        activatorId === undefined ? undefined : limitMsOf(context.activatorOf(activatorId, port), context)]
        .filter((limit): limit is number => limit !== undefined);
    if(limits.length === 0) return undefined;
    return Math.max(1, Math.ceil(Math.min(...limits) / 1000));
}
