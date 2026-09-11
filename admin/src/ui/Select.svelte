<script lang="ts">
    let {
        value = $bindable(''),
        id,
        options,
        disabled = false,
        class: className = '',
        onchange,
    }: {
        value?: string;
        id?: string;
        options: Array<{value: string; label: string}>;
        disabled?: boolean;
        class?: string;
        onchange?: (value: string) => void;
    } = $props();
</script>

<select class="select {className}" {id} {disabled} bind:value onchange={() => onchange?.(value)}>
    {#each options as o (o.value)}
        <option value={o.value}>{o.label}</option>
    {/each}
</select>

<style>
    .select{
        font-family: var(--ff-mono);
        font-size: 13px;
        color: var(--ink-0);
        background: var(--bg-mute);
        border: 1px solid var(--line-1);
        border-radius: var(--r-1);
        padding: 10px 12px;
        outline: none;
        transition: border-color var(--dur-2) var(--ease-out),
                    box-shadow var(--dur-2) var(--ease-out);
        width: 100%;
        appearance: none;
        background-image:
            linear-gradient(45deg, transparent 50%, var(--ink-1) 50%),
            linear-gradient(135deg, var(--ink-1) 50%, transparent 50%);
        background-position: calc(100% - 16px) 50%, calc(100% - 11px) 50%;
        background-size: 5px 5px, 5px 5px;
        background-repeat: no-repeat;
        padding-right: 32px;
    }
    .select:hover{ border-color: var(--line-2); }
    .select:focus{
        border-color: var(--signal);
        box-shadow: 0 0 0 3px var(--signal-glow);
    }
</style>
