// 이슈 347 — 터널 공유 목록의 읽기·검증 규칙. 저장소를 모르는 순수 함수만 둔다.

/** 한 터널을 공유할 수 있는 사용자 수의 상한(FR-5). */
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

/** 저장 본문의 공유 목록을 검증하고 정규화한다. 상한은 정규화한 뒤의 수로 센다. */
export function resolveSharedUserIds(requested: unknown, ownerId: string, userExists: (id: string) => boolean): SharingResult {
    if(!Array.isArray(requested) || !requested.every((id) => typeof id === 'string')) {
        return invalid('shared_users_invalid', 'sharedUserIds must be an array of user ids');
    }
    const ids = normalizeSharedUserIds(requested, ownerId);
    if(ids.length > MAX_SHARED_USERS) {
        return invalid('shared_users_too_many', `a tunnel can be shared with at most ${MAX_SHARED_USERS} users`);
    }
    const unknown = ids.find((id) => !userExists(id));
    if(unknown !== undefined) {
        return invalid('shared_user_not_found', `shared user not found: ${unknown}`);
    }
    return {success: true, ids};
}

/** 감사 detail 에 남길 변경분(FR-16). */
export function sharedUsersChange(before: readonly string[], after: readonly string[]): {added: string[]; removed: string[]} {
    return {added: after.filter((id) => !before.includes(id)), removed: before.filter((id) => !after.includes(id))};
}
