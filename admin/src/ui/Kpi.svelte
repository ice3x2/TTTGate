<script lang="ts">
    let {
        label,
        value,
        sub,
        accent = false,
        class: className = '',
    }: {
        label: string;
        value: string;
        sub?: string;
        accent?: boolean;
        class?: string;
    } = $props();
</script>

<div class="kpi {accent ? 'accent' : ''} {className}">
    <div class="k">{label}</div>
    <div class="v">{value}</div>
    {#if sub}<div class="sub">{sub}</div>{/if}
</div>

<style>
    .kpi{
        padding: var(--s-5);
        background: linear-gradient(180deg, var(--bg-2), var(--bg-1));
        border: 1px solid var(--line-1);
        border-radius: var(--r-2);
        position: relative;
    }
    .kpi .k{
        font-family: var(--ff-mono);
        font-size: 10px; letter-spacing: .2em; text-transform: uppercase;
        color: var(--ink-2);
    }
    .kpi .v{
        font-family: var(--ff-display);
        font-variation-settings: "opsz" 144, "wght" 380;
        font-size: 56px; line-height: 1; letter-spacing: -.02em;
        color: var(--ink-0);
        margin-top: var(--s-2);
        display: flex; align-items: baseline; gap: var(--s-2);
    }
    .kpi .sub{
        margin-top: var(--s-3);
        display: flex; align-items: center; gap: var(--s-2);
        font-family: var(--ff-mono);
        font-size: 11px; color: var(--ink-2);
        letter-spacing: .04em;
    }
    .kpi.accent{
        border-color: var(--signal);
        border-left-width: 2px;
        background: linear-gradient(180deg, var(--bg-2), var(--bg-1));
    }
    .kpi.accent .v{ color: var(--signal); }
</style>
