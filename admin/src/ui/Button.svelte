<script lang="ts">
    import type {Snippet} from 'svelte';

    let {
        variant = 'ghost',
        size = 'md',
        icon = false,
        disabled = false,
        type = 'button',
        class: className = '',
        id,
        ariaLabel,
        title,
        onclick,
        children,
    }: {
        variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
        size?: 'sm' | 'md';
        /** 이슈 365: 아이콘만 있는 44px 정사각 버튼. 보조 기술용 이름(ariaLabel)을 함께 준다. */
        icon?: boolean;
        disabled?: boolean;
        type?: 'button' | 'submit';
        class?: string;
        /** U2-10: 화면 테스트·라벨 연결용. 버튼 요소에 그대로 붙는다. */
        id?: string;
        /** 이슈 365: 글자가 없거나 줄 문맥이 필요한 버튼의 보조 기술용 이름. */
        ariaLabel?: string;
        title?: string;
        onclick?: (e: MouseEvent) => void;
        children?: Snippet;
    } = $props();
</script>

<button class="btn {variant} {size === 'sm' ? 'sm' : ''} {icon ? 'icon' : ''} {className}" {id} {type} {disabled} {title}
    aria-label={ariaLabel} {onclick}>
    {@render children?.()}
</button>

<style>
    .btn{
        display: inline-flex; align-items: center; gap: var(--s-2);
        font-family: var(--ff-ui);
        font-size: 13px;
        font-weight: 500;
        letter-spacing: .02em;
        color: var(--ink-0);
        background: transparent;
        border: 1px solid var(--line-2);
        padding: 9px 16px;
        border-radius: var(--r-2);
        cursor: pointer;
        transition: background var(--dur-2) var(--ease-out),
                    border-color var(--dur-2) var(--ease-out),
                    color var(--dur-2) var(--ease-out),
                    transform var(--dur-1) var(--ease-out);
        user-select: none;
    }
    .btn:hover{ border-color: var(--ink-2); background: rgba(255,255,255,.02); }
    .btn:active{ transform: translateY(1px); }
    .btn.primary{
        background: var(--signal);
        color: var(--ink-on-signal);
        border-color: var(--signal);
        box-shadow: 0 0 0 0 var(--signal-glow);
    }
    .btn.primary:hover{
        background: var(--signal-fill);
        border-color: var(--signal-fill);
        color: var(--ink-on-signal);
        box-shadow: 0 0 0 4px var(--signal-glow);
    }
    /* 이슈 365: 테두리가 보이는 보조 버튼. 목록에 줄을 더하는 버튼처럼 글자만으로는 버튼으로 읽히지 않는 곳에 쓴다. */
    .btn.secondary{ min-height: 44px; background: var(--bg-2); color: var(--ink-0); border-color: var(--line-2); }
    .btn.secondary:hover{ background: var(--bg-3); border-color: var(--ink-2); }
    .btn.icon{ width: 44px; min-height: 44px; padding: 0; justify-content: center; }
    .btn.ghost{ border-color: transparent; color: var(--ink-1); }
    .btn.ghost:hover{ color: var(--ink-0); background: rgba(255,255,255,.03); }
    .btn.danger{
        color: var(--alarm);
        border-color: var(--alarm-dim);
    }
    .btn.danger:hover{
        background: rgba(255,107,91,.08);
        border-color: var(--alarm);
    }
    .btn.sm{ padding: 5px 10px; font-size: 12px; }
    .btn[disabled]{
        opacity: .42; cursor: not-allowed; transform: none !important;
    }
</style>
