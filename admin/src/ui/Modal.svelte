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
        (focusable ?? dialog)?.focus();
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
    .modal-overlay{
        position: fixed; inset: 0; z-index: 100;
        display: flex; justify-content: center; align-items: flex-start;
        padding: 80px var(--s-4) var(--s-4);
        overflow-y: auto;
    }
    .modal-overlay::before{
        content: '';
        position: fixed; inset: 0;
        background: var(--ink-0); opacity: .72;
    }
    .modal{
        position: relative;
        width: 100%; max-width: 480px;
        border: 1px solid var(--line-2);
        border-radius: var(--r-3);
        background: linear-gradient(180deg, var(--bg-2), var(--bg-1));
        box-shadow:
            0 24px 60px rgba(16,24,40,.14),
            0 2px 4px rgba(16,24,40,.05);
        overflow: hidden;
    }
    .modal-head{
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
    .modal-body{ padding: var(--s-6); color: var(--ink-1); }
    .modal-foot{
        padding: var(--s-4) var(--s-5);
        border-top: 1px solid var(--line-1);
        display: flex; justify-content: flex-end; gap: var(--s-3);
        background: var(--bg-mute);
    }
</style>
