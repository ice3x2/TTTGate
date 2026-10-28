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
    let dialog: HTMLDivElement | undefined = $state();

    $effect(() => {
        if(!open) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const focusable = dialog?.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        // 아주 낮은 화면(아래 240px 규칙)에서는 오버레이가 스크롤 영역이 된다. 그때 첫 컨트롤은 대개 화면 밖이므로
        // 대화상자 자체에 초점을 주고 스크롤하지 않는다. 그래야 제목이 보이고, 다음 Tab 에서 컨트롤이 드러난다.
        // 경계값은 CSS 한 곳에만 두고, 여기서는 그 결과(오버레이의 overflow)만 읽는다.
        const overlay = dialog?.parentElement;
        const low = overlay ? getComputedStyle(overlay).overflowY === 'auto' : false;
        (low ? dialog : focusable ?? dialog)?.focus({preventScroll: low});
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
       스크롤이 뒤 페이지로 넘어가지 않게 막는다. 짧은 모달은 가운데에 두고, 넘칠 때만 위에서 시작한다(margin auto).
       초점 규칙은 이 규칙의 결과(오버레이 overflow)를 읽으므로 경계값은 여기 한 곳에만 둔다. */
    @media (max-height: 240px){
        .modal-overlay{ overflow-y: auto; overscroll-behavior: contain; }
        .modal{ max-height: none; margin-block: auto; }
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
