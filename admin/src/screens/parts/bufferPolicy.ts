import type {MeResponse} from '../../controller/Types';

// 이슈 366: 그룹 연결당 버퍼 최댓값(max_session_buffer_mib)을 터널 편집 화면에 안내하는 규칙. 최종 판정은 서버가 한다.

/** 새 터널의 기본 버퍼(MiB). 그룹 상한이 이보다 작으면 상한을 쓴다. */
const DEFAULT_BUFFER_MIB = 10;

/** 이 사용자에게 걸리는 그룹 버퍼 상한(MiB). 슈퍼유저와 상한 0(없음)은 null 이다. */
export function groupBufferCap(me: MeResponse): number | null {
    if(me.user.role === 'superuser') return null;
    const cap = me.group.attributes.max_session_buffer_mib;
    return typeof cap === 'number' && cap > 0 ? cap : null;
}

/** 이슈 366 FR-11: 새 터널의 기본 버퍼. 기본값 그대로 저장했는데 거부되는 일을 막는다. */
export function defaultBuffer(cap: number | null): number {
    return cap === null ? DEFAULT_BUFFER_MIB : Math.min(DEFAULT_BUFFER_MIB, cap);
}

/** 버퍼 칸의 상태. 'over'·'unlimited' 는 저장을 막고, 'stored-over' 는 경고만 한다. */
export type BufferIssue = 'over' | 'unlimited' | 'stored-over';

/**
 * 버퍼 칸의 상태. 상한을 넘는 새 값은 'over', 새로 넣은 클라이언트 버퍼 1 미만(제한 없음)은 'unlimited' 다(둘 다 저장을 막는다).
 * 상한을 넘지만 저장된 값을 그대로 두면 'stored-over'(경고만), 그 밖은 undefined 다. 비어 있는 칸은 다른 검사가 맡는다.
 */
export function bufferIssue(kind: 'server' | 'client', value: number | null | undefined, stored: number | undefined,
    cap: number | null): BufferIssue | undefined {
    if(cap === null || typeof value !== 'number') return undefined;
    const unlimited = kind === 'client' && value < 1;
    if(!unlimited && value <= cap) return undefined;
    if(stored !== undefined && value === stored) return 'stored-over';
    return unlimited ? 'unlimited' : 'over';
}
