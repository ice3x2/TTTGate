<script lang="ts">
    import type {FullAutoFill} from 'svelte/elements';

    let {
        value = $bindable(''),
        id,
        type = 'text',
        placeholder,
        disabled = false,
        autocomplete,
        invalid = false,
        inputmode,
        class: className = '',
        oninput,
        onkeydown,
    }: {
        value?: string;
        id?: string;
        type?: 'text' | 'password';
        placeholder?: string;
        disabled?: boolean;
        autocomplete?: FullAutoFill;
        invalid?: boolean;
        inputmode?: 'text' | 'numeric';
        class?: string;
        oninput?: (value: string) => void;
        onkeydown?: (e: KeyboardEvent) => void;
    } = $props();
</script>

<input class="input {invalid ? 'err' : ''} {className}" {id} {type} {placeholder} {disabled} {autocomplete} {inputmode}
    aria-invalid={invalid || undefined} bind:value oninput={() => oninput?.(value)} {onkeydown}>

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
    .input::placeholder{ color: var(--ink-3); }
    .input:hover{ border-color: var(--line-2); }
    .input:focus{
        border-color: var(--signal);
        box-shadow: 0 0 0 3px var(--signal-glow);
    }
    .input.err{ border-color: var(--alarm-dim); }
    .input.err:focus{ border-color: var(--alarm); box-shadow: 0 0 0 3px var(--alarm-glow); }
</style>
