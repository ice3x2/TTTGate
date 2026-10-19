import type {Role} from "../rbac/IdentityTypes";

// U5-07 / #122 — PRD 속성 3 max_tunnel_duration_ms 의 집행 값. 시계를 읽지 않는 순수 함수다.

export type LifetimeContext = {
    ownerOf(port: number): {userId: string; groupId: string; role: Role} | undefined;
    groupAttributes(groupId: string): {max_tunnel_duration_ms: number};
};

/**
 * 포트의 최대 활성 시간(초). 상한이 없으면 undefined 다.
 * system:migrated·슈퍼유저 소유는 상한이 없고, 그룹 값이 0 이하여도 없다.
 * active(port, timeout) 의 timeout 은 초 단위 정수라 올림한다. 내림하면 1..999ms 상한이 0(= 타이머 없음)이 된다.
 */
export function maxActiveSeconds(port: number, context: LifetimeContext): number | undefined {
    const owner = context.ownerOf(port);
    if(owner === undefined || owner.role === 'superuser') return undefined;
    const limitMs = context.groupAttributes(owner.groupId).max_tunnel_duration_ms;
    if(!(limitMs > 0)) return undefined;
    return Math.max(1, Math.ceil(limitMs / 1000));
}
