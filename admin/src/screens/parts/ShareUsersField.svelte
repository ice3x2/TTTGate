<script lang="ts">
    import {onDestroy} from 'svelte';
    import InvalidSession from '../../controller/InvalidSession';
    import UsersCtrl from '../../controller/UsersCtrl';
    import {addSharedUser, candidatesOf, moveActive, removeSharedUser, SHARE_SEARCH_DELAY_MS, shareQueryOf, shareStatusMessage, type SharedUser} from './shareUsers';
    import {t} from '../../i18n';

    // 이슈 347 FR-10: 공유할 사용자를 자동 완성으로 고르는 칸. combobox 패턴(role=combobox, aria-expanded, aria-activedescendant)을 따른다.
    // 위·아래 화살표와 Enter, 마우스로 고르고 Esc 로 닫는다. 고른 사용자는 칩이며 칩의 × 버튼으로 뺀다.
    let {users = $bindable([]), ownerId, onsessionout}: {users?: SharedUser[]; ownerId?: string; onsessionout: () => void} = $props();

    const INPUT_ID = 'tunnel-share-input';
    const LIST_ID = 'tunnel-share-list';
    const optionId = (index: number) => `tunnel-share-option-${index}`;

    let input = $state('');
    let results = $state<SharedUser[]>([]);
    let open = $state(false);
    let active = $state(-1);
    let searched = $state(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 늦게 온 앞 검색 결과가 뒤 검색 결과를 덮지 않게 요청마다 번호를 붙인다.
    let sequence = 0;
    let field: HTMLInputElement | undefined;

    const candidates = $derived(candidatesOf(results, users, ownerId));
    const statusMessage = $derived(shareStatusMessage({chosen: users, searched: open && searched, candidates}));

    const close = () => {
        open = false;
        active = -1;
    };

    /** 기다리는 검색과 진행 중인 검색을 버린다. 늦게 온 결과가 닫은 목록을 다시 열지 않게 한다. */
    const cancelSearch = () => {
        clearTimeout(timer);
        sequence++;
    };

    const search = async (query: string) => {
        const mine = ++sequence;
        try {
            const result = await UsersCtrl.instance.lookup(query);
            if(mine !== sequence) return;
            results = result.success ? result.users : [];
            searched = true;
            // 그사이 칸을 벗어났으면 목록을 열지 않는다.
            open = document.activeElement === field;
            active = -1;
        } catch(e) {
            if(mine !== sequence) return;
            if(e instanceof InvalidSession) {
                onsessionout();
                return;
            }
            results = [];
            close();
        }
    };

    const onInput = (e: Event) => {
        input = (e.currentTarget as HTMLInputElement).value;
        clearTimeout(timer);
        const query = shareQueryOf(input);
        if(query === undefined) {
            sequence++;
            results = [];
            searched = false;
            close();
            return;
        }
        timer = setTimeout(() => { void search(query); }, SHARE_SEARCH_DELAY_MS);
    };

    const choose = (user: SharedUser) => {
        cancelSearch();
        users = addSharedUser(users, user);
        input = '';
        results = [];
        searched = false;
        close();
        field?.focus();
    };

    const remove = (user: SharedUser) => {
        users = removeSharedUser(users, user.id);
        field?.focus();
    };

    const onKeydown = (e: KeyboardEvent) => {
        if(e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if(candidates.length === 0) return;
            e.preventDefault();
            open = true;
            active = moveActive(active, e.key, candidates.length);
            return;
        }
        if(e.key === 'Enter') {
            // 폼 제출로 이어지지 않게 막는다. 고른 결과가 없으면 아무 일도 하지 않는다.
            e.preventDefault();
            if(open && active >= 0 && active < candidates.length) choose(candidates[active]);
            return;
        }
        if(e.key === 'Escape' && open) {
            e.preventDefault();
            close();
        }
    };

    onDestroy(() => clearTimeout(timer));
</script>

<div class="share">
    {#if users.length > 0}
        <ul id="tunnel-share-chips" class="share-chips" aria-label={t('share.sharedUsers')}>
            {#each users as user (user.id)}
                <li class="share-chip" data-user-id={user.id}>
                    <span>{user.displayName}</span><span class="share-chip-name">@{user.username}</span>
                    <button type="button" class="share-chip-remove" aria-label={t('share.remove', {username: user.username})} onclick={() => remove(user)}>×</button>
                </li>
            {/each}
        </ul>
    {/if}
    <div class="share-box">
        <input bind:this={field} id={INPUT_ID} class="share-input" type="text" autocomplete="off" placeholder={t('share.search')}
            role="combobox" aria-autocomplete="list" aria-controls={LIST_ID} aria-expanded={open && candidates.length > 0}
            aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
            bind:value={input} oninput={onInput} onkeydown={onKeydown} onblur={() => { cancelSearch(); close(); }}>
        <ul id={LIST_ID} class="share-list" role="listbox" aria-label={t('share.matches')} hidden={!open || candidates.length === 0}>
            {#each candidates as user, index (user.id)}
                <!-- 누르는 동안 입력 칸의 포커스를 잃지 않게 mousedown 을 막는다(blur 가 목록을 닫는다).
                     키보드 선택은 입력 칸이 aria-activedescendant 로 맡으므로 항목에는 키 처리기를 두지 않는다. -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <li id={optionId(index)} role="option" aria-selected={index === active} class:active={index === active}
                    onmousedown={(e) => e.preventDefault()} onclick={() => choose(user)}>
                    <span>{user.displayName}</span><span class="share-chip-name">@{user.username}</span>
                </li>
            {/each}
        </ul>
        <!-- 알림 영역은 늘 두고 문구만 바꾼다. 새로 끼워 넣은 영역은 화면 낭독기가 읽지 않을 수 있다. -->
        <p id="tunnel-share-status" class="share-empty" role="status">{statusMessage}</p>
    </div>
</div>

<style>
    .share { display: flex; flex-direction: column; gap: var(--s-2); }
    .share-chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--s-2); }
    .share-chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px 2px 10px; border: 1px solid var(--line-1); border-radius: 999px;
        background: var(--bg-3); font-size: var(--fs-xs); color: var(--ink-1); }
    .share-chip-name { color: var(--ink-2); font-family: var(--ff-mono); }
    .share-chip-remove { min-width: 28px; min-height: 28px; border: 0; border-radius: 999px; background: transparent; color: var(--ink-2); cursor: pointer; font-size: var(--fs-sm); }
    .share-chip-remove:hover, .share-chip-remove:focus-visible { color: var(--ink-0); background: var(--bg-mute); outline: none; box-shadow: 0 0 0 2px var(--signal-glow); }
    .share-box { position: relative; }
    .share-input { font-family: var(--ff-mono); font-size: 13px; color: var(--ink-0); background: var(--bg-mute); border: 1px solid var(--line-1);
        border-radius: var(--r-1); padding: 10px 12px; outline: none; width: 100%; }
    .share-input:focus { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-glow); }
    .share-list { position: absolute; z-index: 30; left: 0; right: 0; margin: 4px 0 0; padding: var(--s-1) 0; list-style: none;
        background: var(--bg-2); border: 1px solid var(--line-1); border-radius: var(--r-2); max-height: 280px; overflow-y: auto; }
    .share-list li { display: flex; gap: var(--s-2); align-items: center; min-height: 40px; padding: 0 var(--s-3); cursor: pointer; font-size: var(--fs-sm); }
    .share-list li.active, .share-list li:hover { background: var(--bg-3); }
    .share-empty { margin: var(--s-1) 0 0; font-size: var(--fs-xs); color: var(--ink-2); }
    .share-empty:empty { margin: 0; }
</style>
