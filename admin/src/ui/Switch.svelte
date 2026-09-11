<script lang="ts">
    let {
        on = $bindable(false),
        disabled = false,
        ariaLabel,
        class: className = '',
        onchange,
    }: {
        on?: boolean;
        disabled?: boolean;
        ariaLabel: string;
        class?: string;
        onchange?: (on: boolean) => void;
    } = $props();
</script>

<button type="button" role="switch" aria-checked={on} aria-label={ariaLabel} class="switch {on ? 'on' : ''} {className}"
    {disabled} onclick={() => { on = !on; onchange?.(on); }}></button>

<style>
    .switch{
        --w: 38px; --h: 20px;
        position: relative; display:inline-block;
        width: var(--w); height: var(--h);
        background: var(--bg-mute);
        border: 1px solid var(--line-2);
        border-radius: 999px;
        cursor: pointer;
        padding: 0;
        appearance: none;
        transition: background var(--dur-2) var(--ease-out),
                    border-color var(--dur-2) var(--ease-out);
    }
    .switch::before{
        content: '';
        position: absolute; inset: -12px -3px;
    }
    .switch::after{
        content:'';
        position:absolute; top: 2px; left: 2px;
        width: calc(var(--h) - 6px); height: calc(var(--h) - 6px);
        border-radius: 50%;
        background: var(--ink-2);
        box-shadow: 0 0 0 0 transparent;
        transition: transform var(--dur-2) var(--ease-out),
                    background var(--dur-2) var(--ease-out),
                    box-shadow var(--dur-2) var(--ease-out);
    }
    .switch.on{ background: rgba(110,207,181,.14); border-color: var(--pulse-dim); }
    .switch.on::after{
        transform: translateX(calc(var(--w) - var(--h)));
        background: var(--pulse);
        box-shadow: 0 0 10px var(--pulse-glow);
    }
</style>
