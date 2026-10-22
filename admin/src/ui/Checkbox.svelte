<script lang="ts">
    let {
        checked = $bindable(false),
        id,
        label,
        disabled = false,
        class: className = '',
        onchange,
    }: {
        checked?: boolean;
        id?: string;
        label: string;
        disabled?: boolean;
        class?: string;
        onchange?: (checked: boolean) => void;
    } = $props();
</script>

<label class="check {checked ? 'on' : ''} {className}">
    <input type="checkbox" class="box" {id} {disabled} bind:checked onchange={() => onchange?.(checked)}>
    <span>{label}</span>
</label>

<style>
    .check{
        display:inline-flex; align-items:center; gap: var(--s-2);
        font-family: var(--ff-ui); font-size: 13px; color: var(--ink-0);
        cursor: pointer; user-select:none;
    }
    input.box{
        appearance: none;
        margin: 0;
        position: relative;
        width: 16px; height: 16px;
        border: 1px solid var(--line-2);
        background: var(--bg-mute);
        border-radius: var(--r-1);
        display:inline-flex; align-items:center; justify-content:center;
        transition: all var(--dur-2) var(--ease-out);
        cursor: pointer;
    }
    input.box:checked{
        background: var(--signal);
        border-color: var(--signal);
    }
    input.box:checked::after{
        content:''; position: absolute; width: 8px; height: 4px;
        border-left: 2px solid var(--ink-on-signal);
        border-bottom: 2px solid var(--ink-on-signal);
        transform: rotate(-45deg) translate(1px, -1px);
    }
</style>
