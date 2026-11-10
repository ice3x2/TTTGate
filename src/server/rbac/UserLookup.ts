import {Role, User} from "./IdentityTypes";

// 이슈 347 FR-9 — 터널 공유 칸의 사용자 검색. 저장소를 모르는 순수 함수만 둔다.

/** 한 번에 돌려주는 결과 수의 상한. */
export const LOOKUP_LIMIT = 10;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 64;

/** 검색 결과에 싣는 값. 비밀번호 해시·MFA·패스키·그룹은 싣지 않는다. */
export type LookupUserView = {id: string; username: string; displayName: string};

export function parseLookupQuery(raw: string | null): {success: true; query: string} | {success: false; status: 422; code: string; message: string} {
    const query = (raw ?? '').trim();
    const length = Array.from(query).length;
    if(length < MIN_QUERY_LENGTH || length > MAX_QUERY_LENGTH) {
        return {success: false, status: 422, code: 'query_invalid', message: `q must be ${MIN_QUERY_LENGTH} to ${MAX_QUERY_LENGTH} characters`};
    }
    return {success: true, query};
}

/**
 * 모든 활성 사용자에서 찾는다. 호출자 자신은 빼고, 호출자가 슈퍼유저가 아니면 슈퍼유저도 뺀다
 * (슈퍼유저는 공유 없이 모든 터널을 켜므로 공유할 이유가 없고, 관리자 계정 이름이 드러나지 않게 한다).
 */
export function lookupUsers(users: readonly User[], query: string, caller: {userId: string; role: Role}): LookupUserView[] {
    const needle = query.toLowerCase();
    const startsWith = (user: User) => user.username.toLowerCase().startsWith(needle) || user.displayName.toLowerCase().startsWith(needle);
    return users
        .filter((user) => user.status === 'active' && user.id !== caller.userId)
        .filter((user) => caller.role === 'superuser' || user.role !== 'superuser')
        .filter((user) => user.username.toLowerCase().includes(needle) || user.displayName.toLowerCase().includes(needle))
        .map((user) => ({user, rank: startsWith(user) ? 0 : 1}))
        .sort((left, right) => left.rank - right.rank || left.user.username.localeCompare(right.user.username))
        .slice(0, LOOKUP_LIMIT)
        .map(({user}) => ({id: user.id, username: user.username, displayName: user.displayName}));
}
