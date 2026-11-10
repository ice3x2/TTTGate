import {i18n, type Translator} from '../../i18n';

// 이슈 347 FR-10: 터널 편집 화면의 공유 칸(자동 완성) 규칙. 순수 모듈이라 .svelte 를 import 하지 않는다
// (test/admin/shareUsers.test.ts 가 ts-jest 로 직접 부른다). 서버가 최종 판정하므로 여기서는 입력의 모양만 맞춘다.

export type SharedUser = {id: string; username: string; displayName: string};

/** 입력이 멈춘 뒤 검색하기까지의 시간(ms). */
export const SHARE_SEARCH_DELAY_MS = 250;
/** 서버의 공유 상한(src/server/rbac/TunnelSharing.ts 의 MAX_SHARED_USERS)과 같아야 한다. 넘으면 칩을 더하지 않는다. */
export const MAX_SHARED_USERS = 50;
// 검색어 길이는 서버의 사용자 검색(src/server/rbac/UserLookup.ts 의 MIN_QUERY_LENGTH·MAX_QUERY_LENGTH)과 같아야 한다.
const MIN_QUERY = 2;
const MAX_QUERY = 64;

/** 검색할 값. 서버가 받지 않는 길이(2자 미만·64자 초과)면 검색하지 않는다. */
export function shareQueryOf(input: string): string | undefined {
    const query = input.trim();
    const length = Array.from(query).length;
    return length >= MIN_QUERY && length <= MAX_QUERY ? query : undefined;
}

/** 위·아래 화살표로 고른 결과의 위치. 끝에서 처음으로 돈다. 결과가 없으면 -1 이다. */
export function moveActive(current: number, key: 'ArrowDown' | 'ArrowUp', count: number): number {
    if(count === 0) return -1;
    if(key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % count;
    return current <= 0 ? count - 1 : current - 1;
}

/** 목록에 보일 결과. 이미 고른 사용자와 소유자는 다시 고를 이유가 없다. */
export function candidatesOf(results: readonly SharedUser[], chosen: readonly SharedUser[], ownerId?: string): SharedUser[] {
    return results.filter((user) => user.id !== ownerId && !chosen.some((entry) => entry.id === user.id));
}

/** 칩을 더한다. 같은 사용자이거나 상한이 찼으면 받은 목록을 그대로 돌려준다. */
export function addSharedUser(chosen: SharedUser[], user: SharedUser): SharedUser[] {
    if(chosen.length >= MAX_SHARED_USERS || chosen.some((entry) => entry.id === user.id)) return chosen;
    return [...chosen, user];
}

export function removeSharedUser(chosen: readonly SharedUser[], id: string): SharedUser[] {
    return chosen.filter((entry) => entry.id !== id);
}

/**
 * 알림 영역(role=status)의 문구. 영역은 늘 두고 문구만 바꿔 화면 낭독기가 바뀐 문구를 읽게 한다.
 * searched 는 검색 결과를 받아 목록이 열린 상태다.
 */
export function shareStatusMessage(state: {chosen: readonly SharedUser[]; searched: boolean; candidates: readonly SharedUser[]}, tr: Translator = i18n()): string {
    if(state.chosen.length >= MAX_SHARED_USERS) return tr.t('share.limit', {max: MAX_SHARED_USERS});
    if(state.searched && state.candidates.length === 0) return tr.t('share.noMatches');
    return '';
}
