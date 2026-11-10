<script lang="ts">
    // 이슈 344: 표시 전용 원형 시계. fraction 이 있으면 남은 비율만큼 원호를 그리고, 없으면(무제한) 바늘이 계속 돈다.
    let {
        fraction,
        warn = false,
        label,
        class: className = '',
    }: {
        fraction?: number;
        warn?: boolean;
        label: string;
        class?: string;
    } = $props();

    const unlimited = $derived(fraction === undefined);
    const remaining = $derived(Math.max(0, Math.min(1, fraction ?? 0)) * 100);
</script>

<svg class="clock {className}" class:unlimited class:warn viewBox="0 0 24 24" role="img" aria-label={label}>
    <circle cx="12" cy="12" r="10" class="face" />
    {#if unlimited}
        <line class="hand" x1="12" y1="12" x2="12" y2="5" />
    {:else}
        <circle cx="12" cy="12" r="10" class="arc" pathLength="100" stroke-dasharray={`${remaining} 100`} />
    {/if}
</svg>

<style>
    .clock{ width: 18px; height: 18px; flex: 0 0 auto; color: var(--pulse); }
    .clock.warn{ color: var(--warn); }
    .face{ fill: none; stroke: var(--line-2); stroke-width: 2; }
    .arc{ fill: none; stroke: currentColor; stroke-width: 2.5; transform: rotate(-90deg); transform-origin: 12px 12px; }
    .hand{ stroke: currentColor; stroke-width: 2; stroke-linecap: round; transform-origin: 12px 12px; transform-box: view-box; animation: clock-spin 1.2s linear infinite; }
    @keyframes clock-spin{ to{ rotate: 360deg; } }
    @media (prefers-reduced-motion: reduce){
        .hand{ animation: none; }
    }
</style>
