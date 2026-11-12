<script lang="ts">
    // 이슈 365 FR-6(설계 반영): 일반 사용자의 허용 포트 범위를 누를 수 있는 칩으로 보인다.
    // 칩을 누르면 목록의 터널이 쓰지 않는 그 범위의 가장 작은 포트를 넣는다. 최종 판정은 서버가 한다.
    import {t} from '../../i18n';
    import {suggestPort, type PortRange} from './tunnelPolicy';

    let {
        ranges,
        usedPorts,
        onpick,
    }: {
        ranges: ReadonlyArray<PortRange>;
        usedPorts: readonly number[];
        onpick: (port: number) => void;
    } = $props();

    const label = (range: PortRange) => `${range.from}–${range.to}`;
</script>

<div id="tunnel-port-ranges" class="port-ranges">
    {#if ranges.length === 0}
        <p class="hint">{t('tunnel.noPortsAllowed')}</p>
    {:else}
        <span class="label">{t('tunnel.allowedRangesLabel')}</span>
        <div class="chips">
            {#each ranges as range (label(range))}
                {@const free = suggestPort(range, usedPorts)}
                <button type="button" class="port-chip" disabled={free === null}
                    aria-label={t('tunnel.useFreePort', {range: label(range)})}
                    title={free === null ? t('tunnel.rangeFull') : t('tunnel.useFreePort', {range: label(range)})}
                    onclick={() => { if(free !== null) onpick(free); }}>{label(range)}</button>
            {/each}
        </div>
        <p class="hint">{t('tunnel.rangeChipsNote')}</p>
    {/if}
</div>

<style>
    .port-ranges { display: flex; flex-direction: column; gap: var(--s-2); }
    .label { font-family: var(--ff-mono); font-size: 10px; letter-spacing: .22em; text-transform: uppercase; color: var(--ink-2); }
    .chips { display: flex; flex-wrap: wrap; gap: var(--s-2); }
    .port-chip {
        min-height: 44px; padding: 0 var(--s-4); border: 1px solid var(--line-2); border-radius: 999px;
        background: var(--bg-2); color: var(--ink-0); font-family: var(--ff-mono); font-size: 13px;
        font-variant-numeric: tabular-nums; cursor: pointer;
    }
    .port-chip:hover { background: var(--bg-3); border-color: var(--ink-2); }
    .port-chip:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }
    .port-chip[disabled] { opacity: .42; cursor: not-allowed; }
    .hint { margin: 0; font-family: var(--ff-mono); font-size: 11px; color: var(--ink-2); }
</style>
