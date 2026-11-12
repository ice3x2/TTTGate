<script lang="ts">
    // 이슈 365 FR-6(설계 반영): 일반 사용자의 허용 포트 범위를 누를 수 있는 칩으로 보인다.
    // 칩을 누르면 목록의 터널이 쓰지 않는 그 범위의 가장 작은 포트를 넣는다. 최종 판정은 서버가 한다.
    import {t} from '../../i18n';
    import {rangeChips, type PortRange} from './tunnelPolicy';

    let {
        ranges,
        usedPorts,
        hideNotes = false,
        onpick,
    }: {
        ranges: ReadonlyArray<PortRange>;
        usedPorts: readonly number[];
        /** 포트 칸이 오류를 보일 때 참이다. 오류 문장과 겹치지 않게 안내 글자만 숨기고 칩은 남긴다. */
        hideNotes?: boolean;
        onpick: (port: number) => void;
    } = $props();

    const chips = $derived(rangeChips(ranges, usedPorts));
</script>

<div id="tunnel-port-ranges" class="port-ranges">
    {#if chips.length === 0}
        {#if !hideNotes}<p class="hint">{t('tunnel.noPortsAllowed')}</p>{/if}
    {:else}
        <!-- 다 쓴 범위의 칩은 disabled 대신 aria-disabled 로 잠근다. 키보드로 초점을 옮겨 잠긴 이유(title)를 들을 수 있다. -->
        <div class="chips" role="group" aria-label={t('tunnel.rangeChipsLabel')}
            aria-describedby={hideNotes ? undefined : 'tunnel-port-ranges-note'}>
            <span class="label">{t('tunnel.allowedRangesLabel')}</span>
            {#each chips as chip, i (i)}
                <button type="button" class="port-chip" aria-disabled={chip.port === null ? 'true' : undefined}
                    aria-label={t('tunnel.useFreePort', {range: chip.label})}
                    title={chip.port === null ? t('tunnel.rangeFull') : undefined}
                    onclick={() => { if(chip.port !== null) onpick(chip.port); }}>{chip.label}</button>
            {/each}
        </div>
        {#if !hideNotes}<p class="hint" id="tunnel-port-ranges-note">{t('tunnel.rangeChipsNote')}</p>{/if}
    {/if}
</div>

<style>
    .port-ranges { display: flex; flex-direction: column; gap: var(--s-2); }
    .chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
    .label { font-family: var(--ff-mono); font-size: 11px; color: var(--ink-2); margin-right: 2px; }
    /* 설계 ②: 보이는 높이는 36px, 누르는 영역은 ::before 로 위아래 4px 씩 넓혀 44px 다. */
    .port-chip {
        /* z-index: 넓힌 누름 영역(::before)이 아래 안내 글자에 덮이지 않게 칩을 위에 쌓는다. */
        position: relative; z-index: 1; min-height: 36px; display: inline-flex; align-items: center;
        padding: 0 var(--s-3); border: 1px solid var(--line-2); border-radius: 999px;
        background: var(--bg-2); color: var(--ink-0); font-family: var(--ff-mono); font-size: 12.5px;
        font-variant-numeric: tabular-nums; cursor: pointer;
    }
    .port-chip::before { content: ''; position: absolute; inset: -4px -2px; }
    .port-chip:hover { background: var(--bg-3); }
    .port-chip:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }
    .port-chip[aria-disabled='true'] { opacity: .42; cursor: not-allowed; }
    .port-chip[aria-disabled='true']:hover { background: var(--bg-2); }
    .hint { margin: 0; font-family: var(--ff-mono); font-size: 11px; color: var(--ink-2); }
</style>
