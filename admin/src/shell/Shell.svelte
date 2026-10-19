<script lang="ts">
    import type {Snippet} from 'svelte';
    import Header from './Header.svelte';
    import Drawer from './Drawer.svelte';
    import Toast from '../ui/Toast.svelte';

    let {
        title,
        back,
        hideMenu = false,
        banner,
        children,
    }: {
        title: string;
        back?: string;
        /** U3-02: 강제 비밀번호 변경 중에는 메뉴·뒤로 버튼을 숨겨 이동 경로를 없앤다. */
        hideMenu?: boolean;
        /** U3-02: 헤더와 본문 사이에 전체 폭으로 그린다. */
        banner?: Snippet;
        children: Snippet;
    } = $props();

    let drawerOpen = $state(false);
</script>

<Header {title} {back} {hideMenu} bind:menuOpen={drawerOpen} />
<Drawer bind:open={drawerOpen} />
{@render banner?.()}
<main class="shell-main">{@render children()}</main>
<Toast />

<style>
    .shell-main { width: 100%; max-width: 1024px; margin: 0 auto; padding: var(--s-4) var(--s-4) var(--s-10); }
    @media (min-width: 640px) { .shell-main { padding: var(--s-6) var(--s-6) var(--s-10); } }
</style>
