import type {Role, UserStatus} from "./IdentityTypes";

// 이슈 347 — 터널 공유 목록의 읽기·검증 규칙. 저장소를 모르는 순수 함수만 둔다.

/** 한 터널을 공유할 수 있는 사용자 수의 상한(FR-5). 화면의 admin/src/screens/parts/shareUsers.ts 가 같은 값을 쓴다. */
export const MAX_SHARED_USERS = 50;

export type SharingFailure = {success: false; status: 422; code: string; message: string};
export type SharingResult = {success: true; ids: string[]} | SharingFailure;

const invalid = (code: string, message: string): SharingFailure => ({success: false, status: 422, code, message});

/** 저장된 공유 목록. 옛 설정에는 없으므로 빈 목록으로 읽고, 손으로 고친 파일의 문자열 아닌 항목은 버린다. */
export function sharedUserIdsOf(option: {sharedUserIds?: unknown}): string[] {
    const value = option.sharedUserIds;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/** 중복과 소유자 자신을 뺀다. 저장과 소유자 재할당이 이 함수 하나를 쓴다. */
export function normalizeSharedUserIds(ids: readonly string[], ownerId: string): string[] {
    return [...new Set(ids)].filter((id) => id !== ownerId);
}

/** 공유 판정에 필요한 사용자 속성. 없으면 사라진(삭제된) 사용자다. */
export type ShareCandidate = {role: Role; status: UserStatus};

/**
 * 저장할 공유 목록을 정한다. 본문에 없으면(requested === undefined) 저장된 목록을 쓴다. 상한은 정규화한 뒤의 수로 센다.
 * - 저장된 id 가 사라진 사용자면 거절하지 않고 조용히 뺀다(사용자 삭제 정리가 빠졌거나 옛 버전이 남긴 id).
 * - 새로 넣는 id 는 활성 일반 사용자여야 한다. 슈퍼유저는 공유 없이 모든 터널을 켜고, 검색에서도 숨기므로 받지 않는다.
 *   이미 저장된 슈퍼유저·비활성 사용자 id 는 그대로 둔다.
 */
export function resolveSharedUserIds(requested: unknown,
                                     context: {ownerId: string; stored: readonly string[]; userOf: (id: string) => ShareCandidate | undefined}): SharingResult {
    const source = requested === undefined ? context.stored : requested;
    if(!Array.isArray(source) || !source.every((id) => typeof id === 'string')) {
        return invalid('shared_users_invalid', 'sharedUserIds must be an array of user ids');
    }
    const ids = normalizeSharedUserIds(source, context.ownerId)
        .filter((id) => !context.stored.includes(id) || context.userOf(id) !== undefined);
    if(ids.length > MAX_SHARED_USERS) {
        return invalid('shared_users_too_many', `a tunnel can be shared with at most ${MAX_SHARED_USERS} users`);
    }
    const rejected = ids.find((id) => {
        if(context.stored.includes(id)) return false;
        const user = context.userOf(id);
        return user === undefined || user.role === 'superuser' || user.status !== 'active';
    });
    if(rejected !== undefined) {
        // 존재·역할·상태를 구별하지 않고 같은 코드로 답한다(어느 id 가 슈퍼유저인지 드러내지 않는다).
        return invalid('shared_user_not_found', `shared user not found: ${rejected}`);
    }
    return {success: true, ids};
}

/** 감사 detail 에 남길 변경분(FR-16). */
export function sharedUsersChange(before: readonly string[], after: readonly string[]): {added: string[]; removed: string[]} {
    return {added: after.filter((id) => !before.includes(id)), removed: before.filter((id) => !after.includes(id))};
}
