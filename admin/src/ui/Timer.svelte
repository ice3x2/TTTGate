<script lang="ts">
    // 이슈 368: "켜 둘 시간" 창. 숫자 입력 세 칸 대신 단위(시간·일) 버튼과 슬라이더 하나로 고른다.
    // 범위는 적용 상한(capSeconds, 없으면 null)으로 정한다. 서버가 같은 상한으로 자르므로 화면 범위가 같아야 말없이 잘리지 않는다.
    import {tick} from 'svelte';
    import Modal from './Modal.svelte';
    import Button from './Button.svelte';
    import Slider from './Slider.svelte';
    import Switch from './Switch.svelte';
    import {i18n, t} from '../i18n';
    import {endsAtSentence, fixedReasonOf, formatCap, formatDays, formatSpan, initialKeepOn, keepOnLimits, keepOnSeconds, scaleOf, stepKeepOn,
        stepNames, switchUnit, type KeepOnState, type KeepOnUnit} from '../screens/parts/keepOn';

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

    /** FR-12: 처음 값은 창을 연 순간의 남은 시간이다. 열린 동안 남은 시간이 흘러도 고른 값을 다시 잡지 않는다(검토 C-1). */
    const openDialog = () => {
        keep = initialKeepOn({remainingSeconds: seconds, activeTimeout: total}, limits);
        open = true;
    };

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
    /** FR-19: 고를 수 있는 값이 하나뿐이면 슬라이더 대신 값을 고정해 보이고 이유를 적는다. */
    const fixedReason = $derived(fixedReasonOf(keep, limits));
    const valueLabel = $derived(limits.fixedSeconds !== undefined ? formatCap(limits.fixedSeconds)
        : keep.unit === 'd' ? formatDays(keep.days) : formatSpan(keep.minutes));
    const scale = $derived(scaleOf(keep.unit, limits));
    const names = $derived(stepNames(keep.unit));
    const atMin = $derived(keep.unit === 'd' ? keep.days <= 1 : keep.minutes <= 1);
    const atMax = $derived(keep.unit === 'd' ? keep.days >= limits.dayMax : keep.minutes >= limits.hourMaxMinutes);
    const off = $derived(keep.noAuto && limits.showNoAuto);
    const unitChoices: {unit: KeepOnUnit; label: string}[] = [{unit: 'h', label: t('timer.unitHours')}, {unit: 'd', label: t('timer.unitDays')}];
    const sliderId = `${uid}-slider`;
    const endsId = `${uid}-ends`;

    /** 단위 버튼은 radiogroup 이다. 고른 단위로 초점을 옮긴다. */
    const setUnit = async (unit: KeepOnUnit) => {
        keep = switchUnit(keep, unit, limits);
        await tick();
        document.getElementById(`${uid}-unit-${keep.unit}`)?.focus();
    };
    const onUnitKeydown = (event: KeyboardEvent) => {
        if(!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        void setUnit(keep.unit === 'h' ? 'd' : 'h');
    };
    /** FR-18: 끝에 닿아 누른 버튼이 잠기면 초점이 사라지지 않게 슬라이더로 옮긴다. */
    const step = async (delta: number) => {
        keep = stepKeepOn(keep, delta, limits);
        if(!(delta < 0 ? atMin : atMax)) return;
        await tick();
        document.getElementById(sliderId)?.focus();
    };

    /** FR-13: 값이 바뀌지 않았어도 보낸다("지금부터 다시 센다"). */
    const confirm = () => {
        onchange?.(chosenSeconds);
        open = false;
    };
</script>

<div class="timer {className}">
    <button type="button" class="timer-text mono" onclick={openDialog}>{total <= 0 ? '∞' : timeString(seconds)}</button>
    <svg class="clock {total <= 0 ? 'infinite' : ''}" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" class="face" />
        <line class="hand" x1="12" y1="12" x2="12" y2="5" style={`rotate: ${deg}deg`} />
    </svg>
    <Modal bind:open title={t('timer.title')}>
        <div class="keep-on" id={`${uid}-keep-on`}>
            {#if limits.showUnits}
                <div class="units" role="radiogroup" aria-label={t('timer.units')} tabindex="-1" onkeydown={onUnitKeydown}>
                    {#each unitChoices as choice (choice.unit)}
                        <button type="button" class="unit" role="radio" id={`${uid}-unit-${choice.unit}`} aria-checked={keep.unit === choice.unit}
                            tabindex={keep.unit === choice.unit ? 0 : -1} disabled={off} onclick={() => setUnit(choice.unit)}>{choice.label}</button>
                    {/each}
                </div>
            {/if}
            <p class="value" class:off>{off ? t('clock.noLimit') : valueLabel}</p>
            <p class="ends" id={endsId}>{off ? t('timer.stays') : endsAtSentence(valueLabel, now + chosenSeconds * 1000, now, i18n())}</p>
            {#if fixedReason !== undefined}
                <p class="fixed-note">{fixedReason}</p>
            {:else}
                <div class="slider-row">
                    <Button variant="secondary" icon ariaLabel={names.less} disabled={off || atMin} onclick={() => step(-1)}><span aria-hidden="true">−</span></Button>
                    {#if keep.unit === 'd'}
                        <Slider id={sliderId} min={1} max={limits.dayMax} pageStep={1} disabled={off} ariaLabel={t('timer.title')} describedBy={endsId}
                            valueText={formatDays(keep.days)} bind:value={keep.days} />
                    {:else}
                        <Slider id={sliderId} min={1} max={limits.hourMaxMinutes} pageStep={60} disabled={off} ariaLabel={t('timer.title')} describedBy={endsId}
                            valueText={formatSpan(keep.minutes)} bind:value={keep.minutes} />
                    {/if}
                    <Button variant="secondary" icon ariaLabel={names.more} disabled={off || atMax} onclick={() => step(1)}><span aria-hidden="true">＋</span></Button>
                </div>
                <div class="scale" aria-hidden="true"><span>{scale.min}</span><span>{scale.max}</span></div>
            {/if}
            {#if capSeconds !== null}
                <p class="cap-note">{t('timer.capNote', {max: formatCap(capSeconds)})}</p>
            {/if}
            {#if limits.showNoAuto}
                <div class="no-auto">
                    <span aria-hidden="true">{t('timer.noAutoOff')}</span>
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
    .units { display: inline-flex; align-self: center; border: 1px solid var(--line-2); border-radius: var(--r-2); overflow: hidden; }
    .unit { min-height: 44px; min-width: 72px; padding: 0 var(--s-4); border: 0; background: var(--bg-2); color: var(--ink-1); font: inherit; cursor: pointer; }
    .unit + .unit { border-left: 1px solid var(--line-2); }
    .unit[aria-checked='true'] { background: var(--signal); color: var(--ink-on-signal); }
    .unit:disabled { opacity: .42; cursor: not-allowed; }
    .value { margin: 0; text-align: center; font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ink-0); }
    .value.off { font-size: 22px; color: var(--ink-2); }
    .slider-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--s-2); }
    .ends, .cap-note, .fixed-note { margin: 0; text-align: center; font-size: var(--fs-sm); color: var(--ink-2); }
    .ends { margin-top: calc(-1 * var(--s-2)); }
    /* 양 끝 글자는 −/+ 버튼(44px)과 틈만큼 안으로 들여 막대 끝에 맞춘다. */
    .scale { display: flex; justify-content: space-between; padding: 0 calc(44px + var(--s-2)); margin-top: calc(-1 * var(--s-3));
        font-size: var(--fs-xs); color: var(--ink-3); font-variant-numeric: tabular-nums; }
    .no-auto { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-height: 44px;
        padding-top: var(--s-3); border-top: 1px solid var(--line-0); }
</style>
