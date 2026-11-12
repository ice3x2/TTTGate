import type {Options} from '../../controller/Options';
import {i18n, type Translator} from '../../i18n';

// 이슈 367: 터널 목록을 소유자별로 묶는 규칙(순수 함수). 화면은 그리기만 한다.

/** 이전 설정에서 옮긴 터널의 소유자 id. 목록 줄(tunnelRow)과 묶음이 함께 쓴다. */
export const MIGRATED_OWNER_ID = 'system:migrated';
/** 소유자를 찾지 못한 터널은 지워진 사용자가 여럿이어도 한 묶음이다. */
const UNKNOWN_OWNER_KEY = 'owner:unknown';

export type OwnerGroupKind = 'me' | 'user' | 'migrated' | 'unknown';
/**
 * title: 머리글 전체 글자("alice (앨리스)"). name·displayName: 머리글을 두 부분으로 그릴 때의 글자.
 * switchOwner: 스위치 보조 이름에 붙일 소유자. 내 묶음에는 없다.
 */
export type OwnerGroup = {key: string; kind: OwnerGroupKind; title: string; name: string; displayName?: string; switchOwner?: string; options: Options[]};

const KIND_ORDER: Record<OwnerGroupKind, number> = {me: 0, user: 1, migrated: 2, unknown: 3};

const kindOf = (owner: Options['owner'], meId: string): OwnerGroupKind => {
    if(owner?.id === meId) return 'me';
    if(owner?.id === MIGRATED_OWNER_ID) return 'migrated';
    return owner?.username !== undefined ? 'user' : 'unknown';
};

/** FR-4: "{아이디} ({표시 이름})". 표시 이름이 비었거나 아이디와 같으면 아이디만 보인다. */
const headOf = (kind: OwnerGroupKind, owner: Options['owner'], tr: Translator): Pick<OwnerGroup, 'title' | 'name' | 'displayName' | 'switchOwner'> => {
    if(kind === 'migrated' || kind === 'unknown' || owner?.username === undefined) {
        const title = tr.t(kind === 'migrated' ? 'tunnels.groupMigrated' : 'tunnels.groupUnknownOwner');
        return {title, name: title, switchOwner: title};
    }
    const username = owner.username;
    const switchOwner = kind === 'me' ? undefined : username;
    const displayName = owner.displayName?.trim();
    if(!displayName || displayName === username) return {title: username, name: username, switchOwner};
    return {title: tr.t('tunnels.groupOwnerName', {username, displayName}), name: username, displayName, switchOwner};
};

/**
 * FR-2·FR-3: 소유자가 둘 이상이면 소유자별로 묶는다. 순서는 나 → 다른 사용자(아이디 순, 화면 언어) → 업그레이드 전 터널 → 소유자 없음이고,
 * 묶음 안의 순서는 서버 순서다. 소유자가 하나뿐이거나 소유자 정보가 없으면(옛 서버) 묶지 않는다(grouped: false, 묶음 하나).
 */
export function ownerGroups(options: readonly Options[], meId: string, tr: Translator = i18n()): {grouped: boolean; groups: OwnerGroup[]} {
    const byKey = new Map<string, OwnerGroup>();
    for(const option of options) {
        const kind = kindOf(option.owner, meId);
        const key = option.owner === undefined ? '' : kind === 'unknown' ? UNKNOWN_OWNER_KEY : option.owner.id;
        let group = byKey.get(key);
        if(!group) {
            group = {key, kind, ...headOf(kind, option.owner, tr), options: []};
            byKey.set(key, group);
        }
        group.options.push(option);
    }
    const groups = [...byKey.values()];
    const grouped = groups.length > 1 && !byKey.has('');
    if(!grouped) return {grouped: false, groups: [{key: '', kind: 'me', title: '', name: '', options: [...options]}]};
    const collator = new Intl.Collator(tr.intl);
    const sortKey = (group: OwnerGroup) => group.options[0].owner?.username ?? group.key;
    groups.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || collator.compare(sortKey(a), sortKey(b)));
    return {grouped: true, groups};
}
