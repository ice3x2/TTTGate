<script lang="ts">
    import {NAV, navScreen} from './nav';
    import {route} from '../router';

    let {open = $bindable(false)}: {open?: boolean} = $props();

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
    <nav id="nav-drawer" class="drawer" role="dialog" aria-modal="true" aria-label="Navigation">
        <ul>
            {#each NAV as item (item.hash)}
                <li><a class="drawer-item" href={item.hash} aria-current={navScreen($route) === item.screen ? 'page' : undefined} onclick={() => (open = false)}>{item.title}</a></li>
            {/each}
        </ul>
    </nav>
{/if}
<svelte:window onkeydown={(e) => { if(open && e.key === 'Escape') open = false; }} />

<style>
    .drawer-overlay { position: fixed; inset: 0; z-index: 60; background: var(--ink-0); opacity: .4; }
    .drawer { position: fixed; top: 0; left: 0; bottom: 0; z-index: 61; width: min(320px, 85vw);
        background: var(--bg-1); border-right: 1px solid var(--line-1); padding: var(--s-4) 0;
        animation: drawer-in var(--dur-2) var(--ease-out); }
    @keyframes drawer-in { from { transform: translateX(-100%); } }
    .drawer ul { list-style: none; margin: 0; padding: 0; }
    .drawer-item { display: block; padding: var(--s-3) var(--s-4); border-left: 3px solid transparent;
        color: var(--ink-1); text-decoration: none; }
    .drawer-item[aria-current="page"] { border-left-color: var(--signal); color: var(--ink-0); background: var(--bg-3); }
</style>
