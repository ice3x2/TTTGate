<script lang="ts">
    import type {Snippet} from 'svelte';

    let {
        label,
        hint,
        error,
        for: htmlFor,
        class: className = '',
        children,
    }: {
        label: string;
        hint?: string;
        error?: string;
        for?: string;
        class?: string;
        children?: Snippet;
    } = $props();
</script>

<div class="field {className}">
    <label for={htmlFor}>{label}</label>
    {@render children?.()}
    {#if error}
        <div class="err-msg" role="alert">{error}</div>
    {:else if hint}
        <div class="hint">{hint}</div>
    {/if}
</div>

<style>
    .field{ display:flex; flex-direction: column; gap: var(--s-2); }
    .field > label{
        font-family: var(--ff-mono);
        font-size: 10px; letter-spacing: .22em; text-transform: uppercase;
        color: var(--ink-2);
    }
    .field .hint{
        font-family: var(--ff-mono); font-size: 11px; color: var(--ink-2);
    }
    .field .err-msg{
        font-family: var(--ff-mono); font-size: 11px; color: var(--alarm);
        display:flex; align-items:center; gap: 6px;
    }
    .field .err-msg::before{
        content:'!'; display:inline-flex; justify-content:center; align-items:center;
        width: 14px; height: 14px; border: 1px solid var(--alarm); border-radius: 50%;
        font-size: 10px;
    }
</style>
