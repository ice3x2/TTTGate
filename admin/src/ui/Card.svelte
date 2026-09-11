<script lang="ts">
    import type {Snippet} from 'svelte';

    let {
        label,
        ticked = false,
        compact = false,
        class: className = '',
        children,
        header,
    }: {
        label?: string;
        ticked?: boolean;
        compact?: boolean;
        class?: string;
        children?: Snippet;
        header?: Snippet;
    } = $props();
</script>

<section class="card {ticked ? 'ticked' : ''} {compact ? 'compact' : ''} {className}">
    {#if header}
        {@render header()}
    {:else if label}
        <div class="card-label">{label}</div>
    {/if}
    <div class="card-body">{@render children?.()}</div>
    {#if ticked}
        <div class="tickwrap"></div>
    {/if}
</section>

<style>
    .card{
        position: relative;
        background: linear-gradient(180deg, var(--bg-2), var(--bg-1));
        border: 1px solid var(--line-1);
        border-radius: var(--r-2);
        padding: var(--s-5);
        box-shadow: 0 1px 0 rgba(16,24,40,.02);
        transition: border-color var(--dur-2) var(--ease-out),
                    box-shadow var(--dur-2) var(--ease-out),
                    transform var(--dur-2) var(--ease-out);
    }
    .card.compact{ padding: var(--s-3); }
    .card .card-label{
        font-family: var(--ff-mono);
        font-size: 10px; letter-spacing: .22em; text-transform: uppercase;
        color: var(--ink-2);
        margin-bottom: var(--s-3);
        display:flex; align-items:center; gap: var(--s-2);
    }
    .card .card-body{
        color: var(--ink-1);
        font-size: var(--fs-md);
    }
    .card.ticked{ overflow: visible; }
    .card.ticked::before,
    .card.ticked::after,
    .card.ticked > .tickwrap::before,
    .card.ticked > .tickwrap::after{
        content:'';
        position:absolute; width:10px; height:10px;
        border: 1px solid var(--signal);
        pointer-events:none;
    }
    .card.ticked::before         { top:-1px; left:-1px;  border-right:0; border-bottom:0; }
    .card.ticked::after          { top:-1px; right:-1px; border-left:0;  border-bottom:0; }
    .card.ticked > .tickwrap::before{ bottom:-1px; left:-1px;  border-right:0; border-top:0; }
    .card.ticked > .tickwrap::after { bottom:-1px; right:-1px; border-left:0;  border-top:0; }
</style>
