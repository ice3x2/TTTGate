<script lang="ts">
    import {NAV, navScreen} from './nav';
    import {route} from '../router';
    import {me} from '../me';
    import Button from '../ui/Button.svelte';
    import {signOut, useSession} from './session';

    let {open = $bindable(false)}: {open?: boolean} = $props();

    const session = useSession();
    // me 가 아직 없으면 아무 항목도 그리지 않는다(권한 없는 섹션 숨김, NFR-USAB-HIDE-001).
    const items = $derived(NAV.filter((item) => $me?.sections.includes(item.section) === true));

    // 열릴 때 첫 항목으로 초점 이동, 닫힐 때 메뉴 버튼으로 복귀.
    $effect(() => {
        if(!open) return;
        (document.querySelector('.drawer-item') as HTMLElement | null)?.focus();
        return () => document.getElementById('menu-button')?.focus();
    });

    // 라우트가 바뀌면 닫는다.
    $effect(() => {
        $route;
        open = false;
    });
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="drawer-overlay" onclick={() => (open = false)}></div>
    <!-- 서랍은 모달 대화상자로 동작하므로 role="dialog" 를 유지한다(#92: 빌드 경고만 막는다). -->
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <nav id="nav-drawer" class="drawer" role="dialog" aria-modal="true" aria-label="Navigation">
        <ul>
            {#each items as item (item.hash)}
                <li><a class="drawer-item" href={item.hash} aria-current={navScreen($route) === item.screen ? 'page' : undefined} onclick={() => (open = false)}>{item.title}</a></li>
            {/each}
        </ul>
        {#if $me}
            <div class="drawer-foot">
                <span id="nav-user" class="mono">{$me.user.username}</span>
                <Button id="nav-sign-out" variant="ghost" onclick={() => { open = false; void signOut(session); }}>Sign out</Button>
            </div>
        {/if}
    </nav>
{/if}
<svelte:window onkeydown={(e) => { if(open && e.key === 'Escape') open = false; }} />

<style>
    .drawer-overlay { position: fixed; inset: 0; z-index: 60; background: var(--ink-0); opacity: .4; }
    .drawer { position: fixed; top: 0; left: 0; bottom: 0; z-index: 61; width: min(320px, 85vw);
        background: var(--bg-1); border-right: 1px solid var(--line-1); padding: var(--s-4) 0;
        display: flex; flex-direction: column;
        animation: drawer-in var(--dur-2) var(--ease-out); }
    @keyframes drawer-in { from { transform: translateX(-100%); } }
    .drawer ul { list-style: none; margin: 0; padding: 0; flex: 1; }
    .drawer-item { display: block; padding: var(--s-3) var(--s-4); border-left: 3px solid transparent;
        color: var(--ink-1); text-decoration: none; }
    .drawer-item[aria-current="page"] { border-left-color: var(--signal); color: var(--ink-0); background: var(--bg-3); }
    .drawer-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3);
        padding: var(--s-3) var(--s-4); border-top: 1px solid var(--line-1); }
    .drawer-foot .mono { font-family: var(--ff-mono); color: var(--ink-2); }
</style>
