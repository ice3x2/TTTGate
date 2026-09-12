<script lang="ts">
    import type {Snippet} from 'svelte';
    import Header from './Header.svelte';
    import Drawer from './Drawer.svelte';
    import Toast from '../ui/Toast.svelte';

    let {
        title,
        back,
        children,
    }: {
        title: string;
        back?: string;
        children: Snippet;
    } = $props();

    let drawerOpen = $state(false);
</script>

<Header {title} {back} bind:menuOpen={drawerOpen} />
<Drawer bind:open={drawerOpen} />
<main class="shell-main">{@render children()}</main>
<Toast />

<style>
    .shell-main { width: 100%; max-width: 1024px; margin: 0 auto; padding: var(--s-4) var(--s-4) var(--s-10); }
    @media (min-width: 640px) { .shell-main { padding: var(--s-6) var(--s-6) var(--s-10); } }
</style>
