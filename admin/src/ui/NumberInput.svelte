<script lang="ts">
    let {
        value = $bindable<number | null>(null),
        id,
        min,
        max,
        step,
        disabled = false,
        invalid = false,
        class: className = '',
        oninput,
    }: {
        value?: number | null;
        id?: string;
        min?: number;
        max?: number;
        step?: number | 'any';
        disabled?: boolean;
        invalid?: boolean;
        class?: string;
        oninput?: (value: number | null) => void;
    } = $props();
</script>

<input type="number" class="input mono {invalid ? 'err' : ''} {className}" {id} {min} {max} {step} {disabled}
    aria-invalid={invalid || undefined} bind:value oninput={() => oninput?.(value)}>

<style>
    .input{
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
    }
    .input:hover{ border-color: var(--line-2); }
    .input:focus{
        border-color: var(--signal);
        box-shadow: 0 0 0 3px var(--signal-glow);
    }
    .input.err{ border-color: var(--alarm-dim); }
    .input.err:focus{ border-color: var(--alarm); box-shadow: 0 0 0 3px var(--alarm-glow); }
</style>
