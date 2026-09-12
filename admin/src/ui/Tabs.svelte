<script lang="ts">
    let {
        items,
        active = $bindable(''),
        class: className = '',
        onchange,
    }: {
        items: Array<{id: string; label: string}>;
        active?: string;
        class?: string;
        onchange?: (id: string) => void;
    } = $props();
</script>

<div class="tabs {className}" role="tablist">
    {#each items as item (item.id)}
        <button type="button" role="tab" class="tab {active === item.id ? 'active' : ''}"
            aria-selected={active === item.id} onclick={() => { active = item.id; onchange?.(item.id); }}>
            {item.label}
        </button>
    {/each}
</div>

<style>
    .tabs{
        display:flex; gap: var(--s-6);
        border-bottom: 1px solid var(--line-1);
        margin-bottom: var(--s-5);
    }
    .tab{
        background: none; border: 0;
        font-family: var(--ff-ui);
        font-size: 13px; font-weight: 500;
        padding: var(--s-3) 0;
        color: var(--ink-2);
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        cursor: pointer;
        transition: color var(--dur-2) var(--ease-out),
                    border-color var(--dur-2) var(--ease-out);
        display:inline-flex; align-items:center; gap: var(--s-2);
    }
    .tab:hover{ color: var(--ink-0); }
    .tab.active{
        color: var(--ink-0);
        border-bottom-color: var(--signal);
    }
</style>
