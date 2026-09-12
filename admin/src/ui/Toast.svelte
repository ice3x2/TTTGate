<script lang="ts">
    import {toasts, toast} from './toast';
    import type {Tone} from './tone';

    const GLYPH: Record<Tone, string> = {pulse: '✓', alarm: '!', warn: '!', trace: 'i', signal: '•', neutral: '•'};
</script>

<div class="toasts" aria-live="polite">
    {#each $toasts as item (item.id)}
        <div class="toast {item.tone}" role="status">
            <span class="glyph" aria-hidden="true">{GLYPH[item.tone]}</span>
            <span class="msg">{item.message}</span>
            <button type="button" class="toast-close" aria-label="Dismiss" onclick={() => toast.dismiss(item.id)}>×</button>
        </div>
    {/each}
</div>

<style>
    .toasts{
        position: fixed; z-index: 110;
        left: var(--s-4); right: var(--s-4); bottom: var(--s-4);
        display: flex; flex-direction: column; gap: var(--s-2);
    }
    @media (min-width: 640px){
        .toasts{ left: auto; width: 360px; }
    }
    .toast{
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: var(--s-4); align-items: center;
        padding: var(--s-4) var(--s-5);
        border: 1px solid var(--line-1);
        border-left: 2px solid var(--signal);
        background: linear-gradient(90deg, rgba(232,184,75,.06), transparent 60%), var(--bg-1);
        border-radius: var(--r-2);
    }
    .toast.pulse{ border-left-color: var(--pulse); background: linear-gradient(90deg, rgba(110,207,181,.06), transparent 60%), var(--bg-1); }
    .toast.alarm{ border-left-color: var(--alarm); background: linear-gradient(90deg, rgba(255,107,91,.08), transparent 60%), var(--bg-1); }
    .toast.trace{ border-left-color: var(--trace); background: linear-gradient(90deg, rgba(122,183,255,.06), transparent 60%), var(--bg-1); }
    .toast.warn{ border-left-color: var(--warn); }
    .toast.neutral{ border-left-color: var(--line-2); }
    .toast .glyph{
        width: 28px; height: 28px;
        border: 1px solid var(--line-2);
        border-radius: 50%;
        display:flex; align-items:center; justify-content:center;
        font-family: var(--ff-mono); font-size: 13px;
        color: var(--ink-0);
    }
    .toast.pulse .glyph{ border-color: var(--pulse-dim); color: var(--pulse); }
    .toast.alarm .glyph{ border-color: var(--alarm-dim); color: var(--alarm); }
    .toast.trace .glyph{ border-color: var(--trace-dim); color: var(--trace); }
    .toast.signal .glyph{ border-color: var(--signal-dim); color: var(--signal); }
    .toast .msg{ color: var(--ink-0); }
    .toast-close{ background: none; border: 0; color: var(--ink-2); font-size: var(--fs-lg); cursor: pointer; }
</style>
