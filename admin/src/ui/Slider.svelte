<script lang="ts">
    // 이슈 368 FR-16: 값·최소·최대·단계·값 문구만 받는 슬라이더. 브라우저 기본 range 를 써서 키보드와 보조 기술 동작을 그대로 얻는다.
    // PageUp·PageDown 은 pageStep 만큼 움직인다(브라우저 기본은 범위의 10% 라 값 단위와 맞지 않는다).
    let {
        value = $bindable(0),
        min,
        max,
        step = 1,
        pageStep,
        valueText,
        ariaLabel,
        id,
        disabled = false,
        oninput,
    }: {
        value?: number;
        min: number;
        max: number;
        step?: number;
        pageStep?: number;
        valueText: string;
        ariaLabel: string;
        id?: string;
        disabled?: boolean;
        oninput?: (value: number) => void;
    } = $props();

    const set = (next: number) => {
        value = Math.min(max, Math.max(min, next));
        oninput?.(value);
    };

    const onkeydown = (event: KeyboardEvent) => {
        if(pageStep === undefined || (event.key !== 'PageUp' && event.key !== 'PageDown')) return;
        event.preventDefault();
        set(value + (event.key === 'PageUp' ? pageStep : -pageStep));
    };
</script>

<input type="range" class="slider" {id} {min} {max} {step} {disabled} aria-label={ariaLabel} aria-valuetext={valueText}
    bind:value oninput={() => oninput?.(value)} {onkeydown}>

<style>
    /* 손잡이의 누르는 영역은 44px 이다(FR-17). 막대는 얇게, 손잡이는 크게 그린다. */
    .slider { width: 100%; min-width: 0; height: 44px; margin: 0; accent-color: var(--signal); cursor: pointer; }
    .slider:disabled { opacity: .42; cursor: not-allowed; }
    .slider:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }
</style>
