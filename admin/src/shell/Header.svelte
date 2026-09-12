<script lang="ts">
    import {onMount} from 'svelte';
    import Chip from '../ui/Chip.svelte';
    import ServerStatusCtrl from '../controller/ServerStatusCtrl';
    import {navigate} from '../router';

    const ARROW = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 10H4"/><path d="M9 5l-5 5 5 5"/></svg>';
    const BURGER = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 5h14"/><path d="M3 10h14"/><path d="M3 15h14"/></svg>';

    let {
        title,
        back,
        menuOpen = $bindable(false),
        class: className = '',
    }: {
        title: string;
        back?: string;
        menuOpen?: boolean;
        class?: string;
    } = $props();

    let version = $state('');

    onMount(async () => {
        try {
            const v = await ServerStatusCtrl.getVersion();
            version = `${v.name} ${v.build}`;
        } catch {
            version = '';
        }
    });
</script>

<header class="hdr {className}">
    {#if back}
        <button type="button" class="hdr-btn" aria-label="Back" onclick={() => navigate(back)}>{@html ARROW}</button>
    {:else}
        <button type="button" id="menu-button" class="hdr-btn" aria-label="Open menu" aria-expanded={menuOpen} aria-controls="nav-drawer" onclick={() => (menuOpen = true)}>{@html BURGER}</button>
    {/if}
    <h1 class="hdr-title">{title}</h1>
    {#if version}<Chip mono class="hdr-version">{version}</Chip>{/if}
</header>

<style>
    .hdr { position: sticky; top: 0; z-index: 50; height: 56px; display: flex; align-items: center; gap: var(--s-3);
        padding: 0 var(--s-2) 0 var(--s-1); background: var(--bg-1); border-bottom: 1px solid var(--line-0); }
    .hdr-btn { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center;
        background: none; border: 0; border-radius: var(--r-2); color: var(--ink-0); cursor: pointer; }
    .hdr-title { flex: 1; font-family: var(--ff-display); font-size: var(--fs-xl); font-weight: 500; margin: 0;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hdr-version { color: var(--ink-2); }
</style>
