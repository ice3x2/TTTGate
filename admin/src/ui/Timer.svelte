<script lang="ts">
    import Modal from './Modal.svelte';
    import Field from './Field.svelte';
    import NumberInput from './NumberInput.svelte';
    import Button from './Button.svelte';

    let {
        seconds,
        total,
        class: className = '',
        onchange,
    }: {
        seconds: number;
        total: number;
        class?: string;
        onchange?: (totalSeconds: number) => void;
    } = $props();

    const uid = $props.id();

    let open = $state(false);
    let day: number | null = $state(0);
    let hour: number | null = $state(0);
    let min: number | null = $state(0);

    $effect(() => {
        if(!open) return;
        day = Math.floor(total / 86400);
        hour = Math.floor(total / 3600) % 24;
        min = Math.floor(total / 60) % 60;
    });

    const timeString = (left: number): string => {
        if(left <= 0) return '0m 0s';
        const m = Math.floor(left / 60) % 60;
        const h = Math.floor(left / 3600) % 24;
        const s = Math.floor(left % 60);
        const d = Math.floor(left / 86400);
        if(d > 0) return `${d}d ${h}h ${m}m`;
        if(h > 0) return `${h}h ${m}m ${s}s`;
        return `${m}m ${s}s`;
    };

    const deg = $derived(total <= 0 ? 95 : Math.floor(95 + (total - Math.min(seconds, total)) / total * (440 - 95)));

    const confirm = () => {
        const d = Math.min(day ?? 0, 99999);
        const h = Math.min(hour ?? 0, 23);
        const m = Math.min(min ?? 0, 59);
        const next = d * 86400 + h * 3600 + m * 60;
        if(next !== total) onchange?.(next);
        open = false;
    };
</script>

<div class="timer {className}">
    <button type="button" class="timer-text mono" onclick={() => (open = true)}>{total <= 0 ? '∞' : timeString(seconds)}</button>
    <svg class="clock {total <= 0 ? 'infinite' : ''}" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" class="face" />
        <line class="hand" x1="12" y1="12" x2="12" y2="5" style={`rotate: ${deg}deg`} />
    </svg>
    <Modal bind:open title="Tunneling activity restriction time">
        <div class="timer-fields">
            <Field label="Days" for={`${uid}-day`}><NumberInput id={`${uid}-day`} min={0} max={99999} bind:value={day} /></Field>
            <Field label="Hours" for={`${uid}-hour`}><NumberInput id={`${uid}-hour`} min={0} max={23} bind:value={hour} /></Field>
            <Field label="Minutes" for={`${uid}-min`}><NumberInput id={`${uid}-min`} min={0} max={59} bind:value={min} /></Field>
        </div>
        {#snippet footer()}<Button onclick={() => (open = false)}>Cancel</Button><Button variant="primary" onclick={confirm}>OK</Button>{/snippet}
    </Modal>
</div>

<style>
    .timer{ display: inline-flex; align-items: center; gap: var(--s-2); }
    .timer-text{
        background: none; border: 0; padding: 0;
        text-decoration: underline; cursor: pointer;
        color: var(--ink-0); font-size: var(--fs-md);
    }
    .clock{ width: 24px; height: 24px; }
    .face{ fill: var(--bg-0); stroke: var(--ink-0); stroke-width: 2; }
    .hand{
        stroke: var(--ink-0); stroke-width: 2;
        transform-origin: 12px 12px; transform-box: view-box;
    }
    .clock.infinite .hand{ animation: rotate-hand .5s linear infinite; }
    @keyframes rotate-hand{
        to{ rotate: 360deg; }
    }
    .timer-fields{
        display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s-3);
    }
</style>
