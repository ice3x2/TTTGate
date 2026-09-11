<script lang="ts">
    import type {Snippet} from 'svelte';
    import type {Tone} from './tone';

    let {
        tone,
        class: className = '',
        children,
    }: {
        tone: Tone;
        class?: string;
        children?: Snippet;
    } = $props();
</script>

<span class="badge {tone} {className}">{@render children?.()}</span>

<style>
    .badge{
        display:inline-flex; align-items:center; gap: 6px;
        font-family: var(--ff-mono);
        font-size: 10px; letter-spacing: .18em; text-transform: uppercase;
        color: var(--ink-1);
        padding: 3px 8px;
        border: 1px solid var(--line-2);
        border-radius: var(--r-1);
        background: var(--bg-mute);
    }
    .badge.signal{ color: var(--signal); border-color: var(--signal-dim); background: rgba(232,184,75,.06); }
    .badge.pulse{  color: var(--pulse);  border-color: var(--pulse-dim);  background: rgba(110,207,181,.06); }
    .badge.alarm{  color: var(--alarm);  border-color: var(--alarm-dim);  background: rgba(255,107,91,.06); }
    .badge.trace{  color: var(--trace);  border-color: var(--trace-dim);  background: rgba(122,183,255,.06); }
    .badge.warn { color: var(--warn); border-color: var(--warn); }
    .badge.neutral { color: var(--ink-2); }
</style>
