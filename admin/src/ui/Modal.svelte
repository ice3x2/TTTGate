<script lang="ts">
    import type {Snippet} from 'svelte';

    let {
        open = $bindable(false),
        title,
        closeOnOverlay = true,
        class: className = '',
        children,
        footer,
    }: {
        open?: boolean;
        title: string;
        closeOnOverlay?: boolean;
        class?: string;
        children?: Snippet;
        footer?: Snippet;
    } = $props();

    const titleId = $props.id();
    /** 아래 style 의 @media 와 같은 값이다. 이 높이 이하에서는 85% 제한을 풀고 페이지를 스크롤한다. */
    const LOW_VIEWPORT_QUERY = '(max-height: 240px)';
    let dialog: HTMLDivElement | undefined = $state();

    $effect(() => {
        if(!open) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const focusable = dialog?.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        // 보통 화면에서는 초점 대상이 보이게 스크롤한다. 아주 낮은 화면(아래 240px 규칙)에서는 스크롤하면
        // 페이지가 버튼 쪽으로 밀려 제목이 가려지므로 초점만 옮긴다.
        (focusable ?? dialog)?.focus({preventScroll: window.matchMedia(LOW_VIEWPORT_QUERY).matches});
        return () => {
            previouslyFocused?.focus();
        };
    });

    const onkeydown = (e: KeyboardEvent) => {
        if(open && e.key === 'Escape') open = false;
    };
</script>

<svelte:window {onkeydown} />

{#if open}
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={(e) => { if(closeOnOverlay && e.target === e.currentTarget) open = false; }}>
    <div class="modal {className}" role="dialog" aria-modal="true" aria-labelledby={titleId} tabindex="-1" bind:this={dialog}>
        <div class="modal-head"><h2 class="ttl" id={titleId}>{title}</h2></div>
        <div class="modal-body">{@render children?.()}</div>
        {#if footer}<div class="modal-foot">{@render footer()}</div>{/if}
    </div>
</div>
{/if}

<style>
    /* 모달은 화면 가운데에 놓이고 화면 높이의 85% 를 넘지 않는다. 넘치는 내용은 본문 안에서 스크롤한다(이슈 277).
       화면 높이가 240px 이하이면 아래 규칙으로 예외를 둔다. */
    .modal-overlay{
        position: fixed; inset: 0; z-index: 100;
        display: flex; justify-content: center; align-items: center;
        padding: var(--s-4);
    }
    .modal-overlay::before{
        content: '';
        position: fixed; inset: 0;
        background: var(--ink-0); opacity: .72;
    }
    .modal{
        position: relative;
        width: 100%; max-width: 480px;
        max-height: 85vh; max-height: 85dvh;
        display: flex; flex-direction: column;
        border: 1px solid var(--line-2);
        border-radius: var(--r-3);
        background: linear-gradient(180deg, var(--bg-2), var(--bg-1));
        box-shadow:
            0 24px 60px rgba(16,24,40,.14),
            0 2px 4px rgba(16,24,40,.05);
        overflow: hidden;
    }
    .modal-head{
        flex: none;
        padding: var(--s-4) var(--s-5);
        border-bottom: 1px solid var(--line-1);
        display:flex; align-items:center; justify-content: space-between;
    }
    .modal-head .ttl{
        margin: 0;
        font-family: var(--ff-display);
        font-variation-settings: "opsz" 48, "wght" 420;
        font-size: 18px;
    }
    .modal-body{ flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: var(--s-6); color: var(--ink-1); }
    /* 제목줄·본문 여백·버튼줄은 약 170px 이다. 240px 화면의 85%(204px)에서는 본문에 약 34px 만 남아 읽을 수 없고,
       205px 미만에서는 버튼줄이 잘린다. 그래서 240px 이하에서는 높이 제한을 풀고 페이지(오버레이)를 스크롤한다.
       스크롤이 뒤 페이지로 넘어가지 않게 막는다. 위의 LOW_VIEWPORT_QUERY 와 같은 값이다. */
    @media (max-height: 240px){
        .modal-overlay{ align-items: flex-start; overflow-y: auto; overscroll-behavior: contain; }
        .modal{ max-height: none; }
        /* 본문이 스크롤 영역으로 남으면 그 위의 휠이 오버레이로 넘어가지 않는다. */
        .modal-body{ overflow-y: visible; }
    }
    .modal-foot{
        flex: none;
        padding: var(--s-4) var(--s-5);
        border-top: 1px solid var(--line-1);
        display: flex; justify-content: flex-end; gap: var(--s-3);
        background: var(--bg-mute);
    }
</style>
