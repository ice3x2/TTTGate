<script lang="ts">
    let {
        on = $bindable(false),
        disabled = false,
        busy = false,
        size = 'md',
        ariaLabel,
        class: className = '',
        onchange,
        onrequest,
    }: {
        on?: boolean;
        disabled?: boolean;
        /** 이슈 338: 요청 중이다. 누를 수 없고 손잡이에 회전 표시를 그린다. */
        busy?: boolean;
        /** lg 는 휴대폰에서 한 번에 누르기 쉬운 큰 스위치다(이슈 338 터널 목록). */
        size?: 'md' | 'lg';
        ariaLabel: string;
        class?: string;
        onchange?: (on: boolean) => void;
        /**
         * 이슈 338: 주면 스위치가 스스로 바뀌지 않고 바라는 값만 알린다. 상태는 부모가 정한다
         * (확인 창을 거치거나 요청이 끝난 뒤에 바꾸는 경우).
         */
        onrequest?: (next: boolean) => void;
    } = $props();

    const press = () => {
        if(onrequest) {
            onrequest(!on);
            return;
        }
        on = !on;
        onchange?.(on);
    };
</script>

<button type="button" role="switch" aria-checked={on} aria-busy={busy ? 'true' : undefined} aria-label={ariaLabel}
    class="switch {size} {on ? 'on' : ''} {busy ? 'busy' : ''} {className}"
    disabled={disabled || busy} onclick={press}></button>

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
    .switch.lg{ --w: 51px; --h: 31px; }
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
    .switch.lg.on{ background: var(--pulse-fill); border-color: var(--pulse-fill); }
    .switch.lg::after{ background: var(--bg-2); box-shadow: 0 1px 3px rgba(14,18,24,.25); }
    .switch.lg.on::after{ background: var(--bg-2); box-shadow: 0 1px 3px rgba(14,18,24,.25); }
    .switch:disabled{ cursor: default; opacity: .45; }
    .switch.busy{ opacity: 1; cursor: progress; }
    .switch.busy::after{
        border: 2px solid var(--line-1); border-top-color: var(--ink-1);
        animation: switch-spin 800ms linear infinite;
    }
    .switch.busy.on::after{ animation-name: switch-spin-on; }
    @keyframes switch-spin{ to { transform: rotate(360deg); } }
    @keyframes switch-spin-on{
        from { transform: translateX(calc(var(--w) - var(--h))) rotate(0deg); }
        to { transform: translateX(calc(var(--w) - var(--h))) rotate(360deg); }
    }
</style>
