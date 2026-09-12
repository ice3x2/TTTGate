<script lang="ts">
    let {
        title,
        value,
        max = 100,
        message,
        duration = 900,
        class: className = '',
    }: {
        title: string;
        value: number;
        max?: number;
        message: string;
        duration?: number;
        class?: string;
    } = $props();

    const map = (v: number, inMin: number, inMax: number, outMin: number, outMax: number) =>
        (v - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
    const round = (v: number, digits: number) => {
        const factor = 10 ** digits;
        return Math.round(v * factor) / factor;
    };

    const ARC = Math.PI * 60;
    const safeMax = $derived(max <= 0 ? 1 : max);
    const clamped = $derived(Math.min(Math.max(value, 0), safeMax));
    const percent = $derived(round(map(clamped, 0, safeMax, 0, 100), 1));
    const angle = $derived(map(clamped, 0, safeMax, -90, 90));

    let needle: SVGLineElement | undefined = $state();
    let prevAngle = 0;

    $effect(() => {
        const current = angle;
        if(!needle) return;
        if(duration <= 0) {
            needle.style.transform = `rotate(${current}deg)`;
        }
        else {
            needle.animate([
                {transform: `rotate(${prevAngle}deg)`},
                {transform: `rotate(${current}deg)`},
            ], {duration, easing: 'ease-in-out', fill: 'forwards'});
        }
        prevAngle = current;
    });
</script>

<div class="gauge-wrap {className}">
    <div class="gauge-title">{title}</div>
    <div class="gauge">
        <svg viewBox="0 0 160 100" aria-hidden="true">
            <path class="arc-bg" d="M 20 90 A 60 60 0 0 1 140 90" fill="none" stroke-width="8" />
            <path class="arc-fg" d="M 20 90 A 60 60 0 0 1 140 90" fill="none" stroke-width="8"
                stroke-dasharray={ARC} stroke-dashoffset={ARC * (1 - percent / 100)} />
            <line class="needle" x1="80" y1="90" x2="80" y2="40" stroke-width="2" bind:this={needle} />
            <circle class="needle-dot" cx="80" cy="90" r="4" />
        </svg>
        <div class="gauge-val"><span class="n">{percent}</span><span class="u">%</span></div>
    </div>
    <div class="gauge-msg mono">{message}</div>
</div>

<style>
    .gauge{
        position: relative;
        width: 100%; max-width: 160px;
        aspect-ratio: 160 / 100;
        height: auto;
        margin: 0 auto;
    }
    .gauge svg{ width: 100%; height: 100%; overflow: visible; }
    .gauge .arc-bg{ stroke: var(--line-1); }
    .gauge .arc-fg{
        stroke: var(--signal);
        filter: drop-shadow(0 0 6px var(--signal-glow));
        transition: stroke-dashoffset var(--dur-4) var(--ease-out);
    }
    .gauge .needle{
        stroke: var(--ink-0);
        transform-origin: 80px 90px;
        transform-box: view-box;
    }
    .gauge .needle-dot{
        fill: var(--signal); filter: drop-shadow(0 0 6px var(--signal-glow));
    }
    .gauge-val{
        position: absolute; inset: 0;
        display:flex; flex-direction:column; align-items:center; justify-content: flex-end;
        padding-bottom: 4px;
    }
    .gauge-val .n{
        font-family: var(--ff-display);
        font-variation-settings: "opsz" 96, "wght" 400;
        font-size: var(--fs-2xl); line-height: 1; color: var(--ink-0);
        letter-spacing: -.02em;
    }
    .gauge-val .u{
        font-family: var(--ff-mono); font-size: 10px;
        color: var(--ink-2); letter-spacing: .18em; text-transform: uppercase;
        margin-top: 4px;
    }
    .gauge-title{
        font-family: var(--ff-mono); font-size: var(--fs-xs);
        letter-spacing: .18em; text-transform: uppercase;
        color: var(--ink-2); text-align: center;
    }
    .gauge-msg{
        font-size: var(--fs-xs); color: var(--ink-2); text-align: center;
    }
</style>
