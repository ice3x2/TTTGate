<script lang="ts">
    import type {Snippet} from 'svelte';

    let {
        variant = 'ghost',
        size = 'md',
        disabled = false,
        type = 'button',
        class: className = '',
        id,
        onclick,
        children,
    }: {
        variant?: 'primary' | 'ghost' | 'danger';
        size?: 'sm' | 'md';
        disabled?: boolean;
        type?: 'button' | 'submit';
        class?: string;
        /** U2-10: 화면 테스트·라벨 연결용. 버튼 요소에 그대로 붙는다. */
        id?: string;
        onclick?: (e: MouseEvent) => void;
        children?: Snippet;
    } = $props();
</script>

<button class="btn {variant} {size === 'sm' ? 'sm' : ''} {className}" {id} {type} {disabled} {onclick}>
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
