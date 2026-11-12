<script lang="ts">
    // 이슈 368: "켜 둘 시간" 창. 숫자 입력 세 칸 대신 단위(시간·일) 버튼과 슬라이더 하나로 고른다.
    // 범위는 적용 상한(capSeconds, 없으면 null)으로 정한다. 서버가 같은 상한으로 자르므로 화면 범위가 같아야 말없이 잘리지 않는다.
    import Modal from './Modal.svelte';
    import Button from './Button.svelte';
    import Slider from './Slider.svelte';
    import Switch from './Switch.svelte';
    import {i18n, t} from '../i18n';
    import {formatDays, formatSpan, initialKeepOn, keepOnLimits, keepOnSeconds, stepKeepOn, switchUnit, type KeepOnState, type KeepOnUnit}
        from '../screens/parts/keepOn';
    import {formatEnds} from '../screens/parts/tunnelRow';

    let {
        seconds,
        total,
        capSeconds = null,
        now = Date.now(),
        class: className = '',
        onchange,
    }: {
        /** 지금 남은 시간(초). */
        seconds: number;
        /** 처음 건 전체 시간(초). 0 이면 자동으로 끄지 않는다. */
        total: number;
        /** 적용 상한(초). 없으면 null(기본값). */
        capSeconds?: number | null;
        /** 서버 시각(ms). 꺼질 시각 안내에 쓴다. 기본값은 이 브라우저의 지금 시각이다. */
        now?: number;
        class?: string;
        onchange?: (totalSeconds: number) => void;
    } = $props();

    const uid = $props.id();
    let open = $state(false);
    const limits = $derived(keepOnLimits(capSeconds));
    let keep = $state<KeepOnState>({unit: 'h', minutes: 60, days: 1, noAuto: false});

    $effect(() => {
        if(!open) return;
        keep = initialKeepOn({remainingSeconds: seconds, activeTimeout: total}, limits);
    });

    const timeString = (left: number): string => {
        if(left <= 0) return t('timer.minutesSeconds', {m: 0, s: 0});
        const m = Math.floor(left / 60) % 60;
        const h = Math.floor(left / 3600) % 24;
        const s = Math.floor(left % 60);
        const d = Math.floor(left / 86400);
        if(d > 0) return t('timer.daysHoursMinutes', {d, h, m});
        if(h > 0) return t('timer.hoursMinutesSeconds', {h, m, s});
        return t('timer.minutesSeconds', {m, s});
    };

    const deg = $derived(total <= 0 ? 95 : Math.floor(95 + (total - Math.min(seconds, total)) / total * (440 - 95)));

    const chosenSeconds = $derived(keepOnSeconds(keep, limits));
    /** FR-19: 고를 수 있는 값이 하나뿐이면 슬라이더 대신 값을 고정해 보인다. */
    const fixedDay = $derived(keep.unit === 'd' && limits.dayMax === 1);
    const fixed = $derived(limits.fixedSeconds !== undefined || fixedDay);
    const valueLabel = $derived(limits.fixedSeconds !== undefined ? t('timer.spanSeconds', {s: limits.fixedSeconds})
        : keep.unit === 'd' ? formatDays(keep.days) : formatSpan(keep.minutes));
    const capLabel = $derived(capSeconds === null ? '' : capSeconds < 60 ? t('timer.spanSeconds', {s: capSeconds})
        : capSeconds >= 86_400 && capSeconds % 86_400 === 0 ? formatDays(capSeconds / 86_400) : formatSpan(Math.floor(capSeconds / 60)));
    const atMin = $derived(keep.unit === 'd' ? keep.days <= 1 : keep.minutes <= 1);
    const atMax = $derived(keep.unit === 'd' ? keep.days >= limits.dayMax : keep.minutes >= limits.hourMaxMinutes);
    const off = $derived(keep.noAuto && limits.showNoAuto);

    const setUnit = (unit: KeepOnUnit) => (keep = switchUnit(keep, unit, limits));
    const step = (delta: number) => (keep = stepKeepOn(keep, delta, limits));

    /** FR-13: 값이 바뀌지 않았어도 보낸다("지금부터 다시 센다"). */
    const confirm = () => {
        onchange?.(chosenSeconds);
        open = false;
    };
</script>

<div class="timer {className}">
    <button type="button" class="timer-text mono" onclick={() => (open = true)}>{total <= 0 ? '∞' : timeString(seconds)}</button>
    <svg class="clock {total <= 0 ? 'infinite' : ''}" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" class="face" />
        <line class="hand" x1="12" y1="12" x2="12" y2="5" style={`rotate: ${deg}deg`} />
    </svg>
    <Modal bind:open title={t('timer.title')}>
        <div class="keep-on" id={`${uid}-keep-on`}>
            {#if limits.showUnits}
                <div class="units" role="group" aria-label={t('timer.units')}>
                    <button type="button" class="unit" aria-pressed={keep.unit === 'h'} disabled={off} onclick={() => setUnit('h')}>{t('timer.unitHours')}</button>
                    <button type="button" class="unit" aria-pressed={keep.unit === 'd'} disabled={off} onclick={() => setUnit('d')}>{t('timer.unitDays')}</button>
                </div>
            {/if}
            <p class="value" aria-live="polite">{off ? t('clock.noLimit') : valueLabel}</p>
            {#if fixed}
                <p class="fixed-note">{t('timer.fixedReason')}</p>
            {:else}
                <div class="slider-row">
                    <Button variant="secondary" icon ariaLabel={t('timer.decrease')} disabled={off || atMin} onclick={() => step(-1)}><span aria-hidden="true">−</span></Button>
                    {#if keep.unit === 'd'}
                        <Slider id={`${uid}-slider`} min={1} max={limits.dayMax} pageStep={1} disabled={off} ariaLabel={t('timer.title')}
                            valueText={formatDays(keep.days)} bind:value={keep.days} />
                    {:else}
                        <Slider id={`${uid}-slider`} min={1} max={limits.hourMaxMinutes} pageStep={60} disabled={off} ariaLabel={t('timer.title')}
                            valueText={formatSpan(keep.minutes)} bind:value={keep.minutes} />
                    {/if}
                    <Button variant="secondary" icon ariaLabel={t('timer.increase')} disabled={off || atMax} onclick={() => step(1)}><span aria-hidden="true">＋</span></Button>
                </div>
            {/if}
            <p class="ends">{off ? t('timer.stays') : t('timer.endsAt', {duration: valueLabel, time: formatEnds(now + chosenSeconds * 1000, now, i18n())})}</p>
            {#if capSeconds !== null}
                <p class="cap-note">{t('timer.capNote', {max: capLabel})}</p>
            {/if}
            {#if limits.showNoAuto}
                <div class="no-auto">
                    <span id={`${uid}-no-auto`}>{t('timer.noAutoOff')}</span>
                    <Switch ariaLabel={t('timer.noAutoOff')} bind:on={keep.noAuto} />
                </div>
            {/if}
        </div>
        {#snippet footer()}<Button onclick={() => (open = false)}>{t('common.cancel')}</Button><Button variant="primary" onclick={confirm}>{t('common.ok')}</Button>{/snippet}
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
    .keep-on { display: flex; flex-direction: column; gap: var(--s-3); min-width: 0; }
    .units { display: inline-flex; align-self: flex-start; border: 1px solid var(--line-2); border-radius: var(--r-2); overflow: hidden; }
    .unit { min-height: 44px; min-width: 72px; padding: 0 var(--s-4); border: 0; background: var(--bg-2); color: var(--ink-1); font: inherit; cursor: pointer; }
    .unit + .unit { border-left: 1px solid var(--line-2); }
    .unit[aria-pressed='true'] { background: var(--signal); color: var(--ink-on-signal); }
    .unit:disabled { opacity: .42; cursor: not-allowed; }
    .value { margin: 0; font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ink-0); }
    .slider-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--s-2); }
    .ends, .cap-note, .fixed-note { margin: 0; font-size: var(--fs-sm); color: var(--ink-2); }
    .no-auto { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-height: 44px;
        padding-top: var(--s-3); border-top: 1px solid var(--line-0); }
</style>
