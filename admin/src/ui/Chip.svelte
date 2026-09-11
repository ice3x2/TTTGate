<script lang="ts">
    import type {Snippet} from 'svelte';
    import type {Tone} from './tone';

    let {
        tone = 'neutral',
        mono = false,
        class: className = '',
        children,
    }: {
        tone?: Tone;
        mono?: boolean;
        class?: string;
        children?: Snippet;
    } = $props();
</script>

<span class="chip {tone} {mono ? 'mono' : ''} {className}">{@render children?.()}</span>

<style>
    .chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border: 1px solid var(--line-1); border-radius: 999px;
        background: var(--bg-3); font-size: var(--fs-xs); line-height: var(--lh-snug); color: var(--ink-1); white-space: nowrap; }
    .chip.mono { font-family: var(--ff-mono); font-variant-numeric: tabular-nums; }
    .chip.signal { color: var(--signal); } .chip.pulse { color: var(--pulse); } .chip.alarm { color: var(--alarm); }
    .chip.trace { color: var(--trace); } .chip.warn { color: var(--warn); } .chip.neutral { color: var(--ink-2); }
</style>
