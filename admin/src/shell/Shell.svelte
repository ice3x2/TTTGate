<script lang="ts">
    import type {Snippet} from 'svelte';
    import Header from './Header.svelte';
    import Drawer from './Drawer.svelte';
    import Toast from '../ui/Toast.svelte';
    import {isDesktop} from './desktop';

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
    // 데스크탑에서는 서랍을 왼쪽에 늘 열어 두고 본문을 그 오른쪽에 둔다. 메뉴를 숨기는 화면은 예외다.
    const pinned = $derived($isDesktop && !hideMenu);
</script>

<Drawer bind:open={drawerOpen} {pinned} />
<div class="shell-body" class:pinned>
    <Header {title} {back} {hideMenu} menuPinned={pinned} bind:menuOpen={drawerOpen} />
    {@render banner?.()}
    <main class="shell-main">{@render children()}</main>
</div>
<Toast />

<style>
    .shell-body.pinned { margin-left: var(--drawer-w); }
    .shell-main { width: 100%; max-width: 1024px; margin: 0 auto; padding: var(--s-4) var(--s-4) var(--s-10); }
    @media (min-width: 640px) { .shell-main { padding: var(--s-6) var(--s-6) var(--s-10); } }
</style>
