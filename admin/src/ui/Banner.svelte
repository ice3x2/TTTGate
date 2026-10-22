<script lang="ts">
    import type {Snippet} from 'svelte';
    import type {Tone} from './tone';

    let {
        tone,
        dismissible = false,
        class: className = '',
        children,
        ondismiss,
    }: {
        tone: Tone;
        dismissible?: boolean;
        class?: string;
        children?: Snippet;
        ondismiss?: () => void;
    } = $props();
</script>

<div class="banner {tone} {className}" role="status">
    <div class="banner-body">{@render children?.()}</div>
    {#if dismissible}
        <button type="button" class="banner-close" aria-label="Dismiss" onclick={() => ondismiss?.()}>×</button>
    {/if}
</div>

<style>
    .banner{
        display: flex; align-items: center; gap: var(--s-3);
        padding: var(--s-3) var(--s-4);
        border-bottom: 1px solid var(--line-1);
        border-left: 3px solid var(--line-2);
        background: var(--bg-3);
        font-size: var(--fs-sm);
    }
    .banner.signal{ border-left-color: var(--signal); }
    .banner.pulse{ border-left-color: var(--pulse); }
    .banner.alarm{ border-left-color: var(--alarm); }
    .banner.trace{ border-left-color: var(--trace); }
    .banner.warn{ border-left-color: var(--warn); }
    .banner.neutral{ border-left-color: var(--line-2); }
    .banner-body{ flex: 1; }
    .banner-close{
        background: none; border: 0; color: var(--ink-2);
        font-size: var(--fs-lg); cursor: pointer;
    }
</style>
